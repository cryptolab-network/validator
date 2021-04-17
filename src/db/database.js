const mongoose = require('mongoose');
const { Schema } = mongoose;

module.exports = class DatabaseHandler {
  constructor() {
    this.__initSchema();
  }

  connect(name, pass, ip, port, dbName) {
    const self = this;
    let url = `mongodb://`;
    if(process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') {
      url = url + `${name}:${pass}@`;
    }
    url += `${ip}:${port}/${dbName}`;
    const db = mongoose.createConnection(url, {
      useNewUrlParser: true, 
      useUnifiedTopology: true,
      poolSize: 10
    });
    this.Validator = db.model('Validator_' + dbName, this.validatorSchema_);
    this.Nomination = db.model('Nomination_' + dbName, this.nominationSchema_);
    this.ChainInfo = db.model('ChainInfo_' + dbName, this.chainInfoSchema_);
    // this.Nominator = db.model('Nominator_' + dbName, this.nominatorSchema_);
    
    db.on('error', console.error.bind(console, 'connection error:'));
    db.once('open', async function() {
      console.log('DB connected');
    });
  }

  __initSchema() {
    this.chainInfoSchema_ = new Schema({
      activeEra: Number,
    }, { collection: 'chainInfo' });
    this.validatorSchema_ = new Schema({
      id:  String,
      identity: {
        display: String
      },
      statusChange: {
        commission: Number, // 0: no change, 1: up, 2: down
      },
    }, { collection: 'validator' });

    this.nominationSchema_ = new Schema({
      era: Number,
      exposure:{
        total: String,
        own: Number,
        others: [
          {
            who: String,
            value: Number,
          }
        ]
      },
      nominators: [Object],
      commission: Number,
      apy: Number,
      validator: String
    }, { collection: 'nomination' });

    // this.nominatorSchema_ = new Schema({
    //   era: Number,
    //   validator: String,
    //   nominator: {
    //     address: String,
    //     balance: {
    //       lockedBalance: String,
    //       freeBalance: String
    //     }
    //   }
    // }, { collection: 'nominator' });
  }

  async getValidatorStatusOfEra(id, era) {
    let validator = await this.Validator.findOne({
      id: id
    }).exec();

    if (validator === null) {
      return {
        validator
      }
    }
    
    const nomination = await this.Nomination.findOne({
      era: era,
      validator: id
    }).exec();

    if (nomination !== null) {
      validator.info = [nomination];
    }

    return {
      validator
    }
  }

  async getValidatorStatus(id) {
    const validator = await this.Validator.aggregate([
      {$match: {
        'id': id
      }},
      {$lookup: {
        from: 'nomination',
        localField: 'id',
        foreignField: 'validator',
        as: 'info'
      }}
    ]).exec();

    const result = this.__validatorSerialize(validator);
    return {
      validator: validator,
      objectData: result
    };
  }

  async getValidators(era, size, page) {
    const startTime = Date.now();
    const nominations = await this.Nomination.aggregate([
      {$match: {
        era: era
      }},
      {$lookup: {
        from: 'validator',
        localField: 'validator',
        foreignField: 'id',
        as: 'data'
      }},
      {$skip: page * size},
      {$limit: size}
    ]).exec();

    const validators = nominations.map((nomination) => {
      return {
        id: nomination.data[0].id,
        identity: nomination.data[0].identity,
        statusChange: nomination.data[0].statusChange,
        info: {
          nominators: nomination.nominators,
          era: nomination.era,
          exposure: nomination.exposure,
          commission: nomination.commission,
          apy: nomination.apy
        }
      }
    });
    console.log('Executed query in', Date.now() - startTime, 'ms');
    return {
      validator: validators
    }
  }

  async saveValidatorNominationData(id, data) {
    try {
      const isDataValid = this.__validateNominationInfo(id, data);
      if(!isDataValid) {
        return false;
      }
      const { validator, objectData } = await this.getValidatorStatus(id);
      if(validator === undefined || validator.length === 0) {
        await this.Validator.create({
          id: id,
          identity: data.identity,
          statusChange: {
            commission: 0,
          }
        });
        await this.Nomination.create({
          era: data.era,
          exposure: data.exposure,
          nominators: data.nominators,
          commission: data.commission,
          apy: data.apy,
          validator: id
        });
      } else {
        await this.Validator.findOneAndUpdate({
          id: id
        }, {
          identity: data.identity,
          'statusChange.commission': data.commissionChanged
        }).exec();
        const nomination = await this.Nomination.findOne({era: data.era, validator: id}).exec();
        if(nomination !== null) { // the data of this era exist, dont add a new one
          await this.Nomination.findOneAndUpdate({
            era: data.era, validator: id,
          }, {
            exposure: data.exposure,
            nominators: data.nominators,
            commission: data.commission,
            apy: data.apy,
          }, ).exec();
          return true;
        }
        await this.Nomination.create({
          era: data.era,
          exposure: data.exposure,
          nominators: data.nominators,
          commission: data.commission,
          apy: data.apy,
          validator: id
        });
      }
      return true;
    } catch (err) {
      console.log(err);
      return false;
    }
  }

  async saveActiveEra(era) {
    console.log('save active era');
    const result = await this.ChainInfo.updateOne({}, {$set: {activeEra: era}}, {upsert: true}).exec().catch((err)=>{
      console.error(err);
    });
    console.log(result);
  }

  __validateNominationInfo(id, data) {
    if(!Number.isInteger(data.era)) {
      console.error('data.era is not an integer');
      console.error(id);
      console.error(data);
      return false;
    }
    if(!Array.isArray(data.exposure.others)) {
      console.error('data.exposure is not an array');
      console.error(id);
      console.error(data);
      return false;
    }
    if(!Array.isArray(data.nominators)) {
      console.error('data.nominators is not an array');
      console.error(id);
      console.error(data);
      return false;
    }
    for(let i = 0; i < data.exposure.others.length; i++) {
      if(data.exposure.others[i] !== undefined) {
        if(data.exposure.others[i].who === undefined || data.exposure.others[i].value === undefined) {
          console.error('incorrect exposure format');
          console.error(id);
          console.error(data);
          return false;
        }
      }
    }
    return true;
  }

  __validatorSerialize(validator) {
    const result = [];

    for (let i=0; i<validator.length; i++) {
      let info = [];
      for (let j=0; j<validator[i].info.length; j++) {
        info.push({
          nominators: validator[i].info[j].nominators,
          era: validator[i].info[j].era,
          exposure: validator[i].info[j].exposure,
          commission: validator[i].info[j].commission,
          apy: validator[i].info[j].apy
        })
        
      }
      result.push({
        id: validator[i].id,
        identity: validator[i].identity,
        statusChange: validator[i].statusChange,
        info: info
      })
    }
    return result;
  }
}
