const keys = require('./config/keys');
const CronJob = require('cron').CronJob;
const axios = require('axios');
const moment = require('moment');
const CacheData = require('./cachedata');
const BigNumber = require('bignumber.js');

const POLKADOT_DECIMAL = 10000000000;
module.exports = class DotScheduler {
  constructor(oneKvWrapper, chainData, database, cacheData) {
    this.oneKvWrapper = oneKvWrapper;
    this.database = database;
    this.chainData = chainData;
    this.cacheData = cacheData
    this.isCaching = false;
  }

  start() {
    // request api every 1 hour to trigger the data cache
    this.job_ = new CronJob('30 */1 * * *', async () => {
      if(this.isCaching) {
        return;
      }
      this.isCaching = true;
      try {
        console.log('retrieving validator detail @ ' + moment());
        await axios.get(`http://localhost:${keys.PORT}/api/dot/validDetail?option=all`);
        console.log(`http://localhost:${keys.PORT}/api/dot/validDetail?option=all`);
        await this.__collectValidatorStatus();
      } catch (err){
        console.log(err);
        console.log('schedule retrieving data error');
      }
      this.isCaching = false;
    }, null, false, 'America/Los_Angeles', null, true);
    
    console.log('start cronjob');
    this.job_.start();
  }

  async __collectValidatorStatus() {
    console.log('Collecting validator status');
    const info = await this.oneKvWrapper.getValidDetail({target: 'all', useChainData: false});
    if(info === undefined) {
      console.error('info is undefined');
      return;
    }
    const validators = info.valid;
    if(!Array.isArray(validators)) {
      console.error('validator detail does not contain info of validators');
      return;
    }

    const eraReward = await this.chainData.getEraTotalReward(info.activeEra - 1);
    const validatorCount = await this.chainData.getCurrentValidatorCount();
    console.log('Start to store validator status to db');
    const startTime = Date.now();
    for(let i = 0; i < validators.length; i++) {
      const v = validators[i];
      const activeKSM = new BigNumber(v.exposure.total).toNumber()/POLKADOT_DECIMAL;
      const commission = v.validatorPrefs.commission / 10000000;
      const apy = activeKSM === 0 ? 0 : (((eraReward / POLKADOT_DECIMAL) / validatorCount) * (1 - commission/100) * 365) / activeKSM;
      v.apy = apy;
      if (isNaN(apy)) {
        v.apy = 0;
      }
      let display = v.stashId;
      if(v.identity !== undefined) {
        if(v.identity.displayParent !== undefined) {
          display = v.identity.displayParent + '/' + v.identity.display; 
        } else {
          display = v.identity.display; 
        }
      } else {
        display = v.stashId;
      }
      let commissionChanged = 0;
      const commissionPct =  v.validatorPrefs?.commission / 10000000;
      const data = await this.database.getValidatorStatusOfEra(v.stashId.toString(), info.activeEra - 1);
      const lastValidatorData = data.validator;
      if(lastValidatorData !== null && lastValidatorData.info !== undefined) {
        const info = lastValidatorData.info[0];
        if(info !== undefined) {
          if(info.commission != commissionPct) {
            console.log(info.commission, commissionPct);
            if(commissionPct > info.commission) {
              console.log('commission up');
              commissionChanged = 1;
            } else if(commissionPct < info.commission) {
              console.log('commission down');
              commissionChanged = 2;
            } else {
              commissionChanged = 0;
            }
          }
        }
      }
      const result = await this.database.saveValidatorNominationData(v.stashId.toString(), {
        era: info.activeEra,
        exposure: v.exposure,
        nominators: v.nominators,
        commission: commissionPct,
        apy: v.apy,
        identity: {display: display},
        commissionChanged: commissionChanged,
      });
      // if (result) {
      //   console.log(`${v.stashId.toString()} is stored. (${i+1}/${validators.length})`);
      // }
    }
    console.log('done.');
    console.log('Executed query in', Date.now() - startTime, 'ms');
  }
}