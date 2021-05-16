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
  validator: String
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

    for (let x=0; x < count; x++) {
      const data = await Nomination.find().skip(x).limit(1).exec();
      if (data.length === 0) {
        break;
      }

      const nomination = data[0];
      // console.log(JSON.stringify(nomination,undefined, 1));

      if (nomination.nominators.address === undefined) {
        console.log(`continue`);
        continue;
      }

      const new_nomination = {
        era: nomination.era,
        exposure: nomination.exposure,
        commission: nomination.commission,
        nominators: [],
        apy: nomination.apy,
        validator: nomination.validator
      }

      for (const nominator of nomination.nominators) {
        new_nomination.nominators.push(nominator.address);
      }

      // console.log(JSON.stringify(new_nomination, undefined, 1));

      const result = await Nomination.findOneAndReplace(
        {_id: nomination._id},
        new_nomination
      )

      // const result = await NewNomination.create(new_nomination);
      // console.log(result);

      if (x % 10 === 0) {
        console.log(`${x}/${count}`);
      }
      

    }

    db.close();


    // for (let x=0; x < 2000; x++) {
    //   const oldValidators = await Validators.find().skip(x).limit(1).exec();  
    //   if (oldValidators.length === 0) {
    //     break;
    //   }
    //   console.log(`old validators length = ${oldValidators.length}`);
    //   console.log(oldValidators[0]);

    //   // insert into new validator and nomination collections
    //   for(let i=0; i<oldValidators.length; i++) {
    //     await Validator.create({
    //       id: oldValidators[i].id,
    //       identity: oldValidators[i].identity,
    //       statusChange: oldValidators[i].statusChange
    //     });

    //     for(let j=0; j<oldValidators[i].info.length; j++) {
    //       let nomination = {
    //         era: oldValidators[i].info[j].era,
    //         exposure: oldValidators[i].info[j].exposure,
    //         nominators: [],
    //         commission: oldValidators[i].info[j].commission,
    //         apy: oldValidators[i].info[j].apy,
    //         validator: oldValidators[i].id
    //       }
    //       for(let k=0; k<oldValidators[i].info[j].nominators.length; k++) {
    //         nomination.nominators.push({
    //           address: oldValidators[i].info[j].nominators[k].address,
    //           balance: {
    //             lockedBalance: oldValidators[i].info[j].nominators[k].balance.lockedBalance,
    //             freeBalance: oldValidators[i].info[j].nominators[k].balance.freeBalance
    //           }
    //         })
    //       }
    //       await Nomination.create(nomination);
    //     }
    //   }
    // }
    console.log(`done`);
  } catch (err) {
    console.log(err);
  }
})();