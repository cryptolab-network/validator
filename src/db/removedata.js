const mongoose = require('mongoose');
const { Schema } = mongoose;
const keys = require('../config/keys');

const nominationSchema_ = new Schema({
  era: Number,
  exposure:{
    total: String,
    own: String,
    others: [
      {
        who: String,
        value: String,
      }
    ]
  },
  nominators: [Object],
  commission: Number,
  apy: Number,
  validator: String,
  total: String
}, { collection: 'nomination' });

const newNominationSchema_ = new Schema({
  era: Number,
  exposure:{
    total: String,
    own: String,
    others: [
      {
        who: String,
        value: String,
      }
    ]
  },
  nominators: [String],
  commission: Number,
  apy: Number,
  validator: String
}, { collection: 'nomination_new' });

const Nomination = mongoose.model('Nomination', nominationSchema_);
const NewNomination = mongoose.model('Nomination_new', newNominationSchema_);


(async() => {
  try {
    console.log(keys.MONGO_URL);
    await mongoose.connect(`mongodb://${keys.MONGO_ACCOUNT}:${keys.MONGO_PASSWORD}@${keys.MONGO_URL}:${keys.MONGO_PORT}/${keys.MONGO_DBNAME}`, {
      useNewUrlParser: true, 
      useUnifiedTopology: true,
      poolSize: 10
    });
    const db = mongoose.connection;
    db.on('error', console.error.bind(console, 'connection error:'));
    db.once('open', async function() {
      console.log('DB connected');
    });
    // find all old nominations
    const count = await Nomination.countDocuments();
    console.log(`count = ${count}`);

    let eraSet = new Set();
    const offset = 5000;

    for (let x=0; x < count; x+= offset) {
      const data = await Nomination.find().skip(x).limit(offset).exec();
      if (data.length === 0) {
        break;
      }
      for (let i=0; i < data.length; i++) {
        const nomination = data[i];
        eraSet.add(nomination.era);
      }
      if (x % offset === 0) {
        console.log(`${x}/${count}`);
      }
    }

    console.log(`eraSet`);
    console.log(eraSet);

    let duplicateArray = []

    let temp = 0;
    for (let era of eraSet) {
      let validatorSet = new Set();
      let duplicateSet = new Set();
      const data = await Nomination.find({
        era: era
      }).exec();

      for (let n of data) {
        if (validatorSet.has(n.validator) === true) {
          console.log(`has`);
          duplicateSet.add(n.validator);
        } else {
          validatorSet.add(n.validator);
        }
      }

      duplicateArray.push({
        era,
        duplicateSet
      })

      console.log(`era ${era} = ${data.length}`);
      console.log(`duplicateSet = ${duplicateSet.length}`);
      temp += data.length;
    }
    console.log(`temp = ${temp}`);

    // let removeCount = 0;
    // for (let x=0; x < count; x += offset) {
    //   const data = await Nomination.find().skip(x).limit(offset).exec();
    //   if (data.length === 0) {
    //     break;
    //   }

    //   let bulkOps = [];

    //   for (let i=0; i < data.length; i++) {
    //     const nomination = data[i];

    //     if (nomination.total === undefined) {
    //       // console.log(`no total, id = ${nomination._id}`);

    //       bulkOps.push({
    //         'deleteOne': {
    //           'filter': {_id: nomination._id}
    //         }
    //       })
    //     }
    //   }
    //   removeCount += bulkOps.length;
    //   // console.log(JSON.stringify(bulkOps, undefined, 1));
      

    //   // console.log(`bulkOps count = ${bulkOps.length}`);

    //   // const result = await Nomination.bulkWrite(bulkOps);
    //   // console.log(result);
  
    //   if (x % offset === 0) {
    //     console.log(`${x}/${count}`);
    //   }

    // }
    console.log(`total count: ${count}`)
    // console.log(`remove count: ${removeCount}`);

    db.close();
    console.log(`done`);
  } catch (err) {
    console.log(err);
  }
})();