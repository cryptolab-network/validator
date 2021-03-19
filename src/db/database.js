const mongoose = require('mongoose');
const { Schema } = mongoose;

module.exports = class DatabaseHandler {
  constructor() {
    this.__initSchema();
  }

  connect(name, pass, ip, port, dbName) {
    const self = this;
    this.validators = mongoose.model('Validators', this.validatorSchema_);
    mongoose.connect(`mongodb://${name}:${pass}@${ip}/${dbName}`, {
      useNewUrlParser: true, 
      useUnifiedTopology: true,
      poolSize: 10
    });
    const db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:'));
    db.once('open', async function() {
      console.log('DB connected');
    });
  }

  __initSchema() {
    this.validatorSchema_ = new Schema({
      id:  String,
      identity: {
        display: String
      },
      info: [{
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
      }],
      statusChange: {
        commission: Number, // 0: no change, 1: up, 2: down
      }
    }, {toObject: {
      transform: function(doc, ret) {
        delete ret._id;
        delete ret.__v;
      }
    }})
  }

  async getValidatorStatusOfEra(id, era) {
    const startTime = Date.now();
    let validator = await this.validators.aggregate([
        {$match: {
          id: id,
          'info.era': era
        }},
        {$project: {
          info: {
            $filter: {
              input: '$info',
              as: 'info',
              cond: { $eq: ['$$info.era', era]}
            }
          }
        }}
    ]).exec();
    if(validator.length > 0) {
      validator = validator[0];
    }
    // console.log('Executed query getValidatorStatusOfEra in', Date.now() - startTime, 'ms');
    return {
      validator: validator,
    };
  }

  async getValidatorStatus(id) {
    const startTime = Date.now();
    const validator = await this.validators.find({ id: id }).exec();
    const result = this.__validatorSerialize(validator);
    // console.log('Executed query in', Date.now() - startTime, 'ms');
    return {
      validator: validator,
      objectData: result
    };
  }

  async getValidators(era, size, page) {
    const startTime = Date.now();
    const validatorCollection = await this.validators.aggregate([
      {$unwind: {path: '$info', preserveNullAndEmptyArrays: true}},
      {$redact: 
        {$cond: {
          if: {$eq:['$info.era', era]},
          then: '$$KEEP',
          else: '$$PRUNE',
        }}
      },
      {$skip: page * size},
      {$limit: size}
    ]);
    console.log('Executed query in', Date.now() - startTime, 'ms');
    console.log(`validator size = ${validatorCollection.length}`);
    return {
      validator: validatorCollection
    }
  }

  async saveValidatorNominationData(id, data) {
    const isDataValid = this.__validateNominationInfo(id, data);
    if(!isDataValid) {
      return false;
    }
    const { validator, objectData } = await this.getValidatorStatus(id);
    if(validator === undefined || validator.length === 0) {
      await this.validators.create({
        id: id,
        identity: data.identity,
        info: [
          data
        ],
        statusChange: {
          commission: 0,
        }
      })
    } else {
      const eraData = await this.validators.findOne({id: id}, {'info': {$elemMatch: {era: data.era}}}, {}).exec();
      validator[0].identity = data.identity;
      validator[0].statusChange.commission = data.commissionChanged;
      await validator[0].save();
      if(eraData.info !== undefined && eraData.info?.length > 0) { // the data of this era exist, dont add a new one
        this.validators.findOneAndUpdate({
          id: id, 'info': {$elemMatch: {era: data.era}},
        }, {
          'info.$': data,
        }, ).exec();
        return true;
      }
      await validator[0].info.push(data);
      await validator[0].save();
    }
    return true;
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
    validator.forEach((v)=>{
      const obj = v.toObject();
      obj.info.forEach(element => {
        delete element._id;
        element.exposure.others.forEach((e)=>{
          delete e._id;
        });
      });
      result.push(obj);
    });
    return result;
  }
}
