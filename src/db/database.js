const mongoose = require('mongoose');
const { Schema } = mongoose;

module.exports = class DatabaseHandler {
  constructor() {
    this.__initSchema();
  }

  connect(name, pass, ip, port, dbName) {
    const self = this;
    this.validators = mongoose.model('Validators', this.validatorSchema_);
    mongoose.connect(`mongodb+srv://${name}:${pass}@${ip}/${dbName}`, {useNewUrlParser: true, useUnifiedTopology: true});
    const db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:'));
    db.once('open', async function() {
      console.log('DB connected');
    });
  }

  __initSchema() {
    this.validatorSchema_ = new Schema({
      id:  String,
      info: [{
        era: Number,
        exposure: [
          {
            who: String,
            value: Number,
          }
        ],
        nominators: [Object],
        commission: Number,
      }],
    }, {toObject: {
      transform: function(doc, ret) {
        delete ret._id;
        delete ret.__v;
      }
    }})
  }

  async getValidatorStatus(id) {
    const validator = await this.validators.find({ id: id }).exec();
    const result = [];
    validator.forEach((v)=>{
      const obj = v.toObject();
      obj.info.forEach(element => {
        delete element._id;
        element.exposure.forEach((e)=>{
          delete e._id;
        });
      });
      result.push(obj);
    });
    return {
      validator: validator,
      objectData: result
    };
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
        info: [
          data
        ]
      })
    } else {
      const eraData = await this.validators.findOne({id: id}, {'info': {$elemMatch: {era: data.era}}}, {}).exec();
      if(eraData.info !== undefined && eraData.info?.length > 0) { // the data of this era exist, dont add a new one
        // console.log(`duplicated data of era ${data.era}`);
        return true;
      }
      await validator[0].info.push(data);
      validator[0].save();
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
    if(!Array.isArray(data.exposure)) {
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
    for(let i = 0; i < data.exposure.length; i++) {
      if(data.exposure[i] !== undefined) {
        if(data.exposure[i].who === undefined || data.exposure[i].value === undefined) {
          console.error('incorrect exposure format');
          console.error(id);
          console.error(data);
          return false;
        }
      }
    }
    return true;
  }
}
