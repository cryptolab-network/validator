const keys = require('./config/keys');
const CronJob = require('cron').CronJob;
const axios = require('axios');
const moment = require('moment');
const CacheData = require('./cachedata');
const BigNumber = require('bignumber.js');

const KUSAMA_DECIMAL = 1000000000000;
module.exports = class Scheduler {
  constructor(oneKvWrapper, chainData, database, cacheData) {
    this.oneKvWrapper = oneKvWrapper;
    this.database = database;
    this.chainData = chainData;
    this.cacheData = cacheData
    this.isCaching = false;
     // request api every 1 hour to trigger the data cache
     this.job_ = new CronJob('50 */1 * * *', async () => {
      if(this.isCaching) {
        return;
      }
      this.isCaching = true;
      console.log('retrieving validator detail @ ' + moment());
      await axios.get(`http://localhost:${keys.PORT}/api/validDetail?option=all`);
      console.log(`http://localhost:${keys.PORT}/api/validDetail?option=all`);
      await axios.get(`http://localhost:${keys.PORT}/api/validDetail`);
      console.log(`http://localhost:${keys.PORT}/api/validDetail`);
      await this.__collectValidatorStatus();
      // await this.__collectNominatorBalances();
      this.isCaching = false;
    }, null, true, 'America/Los_Angeles', null, true);
    
  }

  start() {
    console.log('start cronjob');
    this.job_.start();
  }

  async __collectValidatorStatus() {
    console.log('Collecting validator status');
    const info = await this.oneKvWrapper.getValidDetail('all');
    const validators = info.valid;
    if(!Array.isArray(validators)) {
      console.error('validator detail does not contain info of validators');
      return;
    }

    const eraReward = await this.chainData.getEraTotalReward(validators[0].info.era - 1);
    const validatorCount = await this.chainData.getCurrentValidatorCount();
    for(let i = 0; i < validators.length; i++) {
      const v = validators[i];
      const activeKSM = new BigNumber(v.info.exposure.total).toNumber()/KUSAMA_DECIMAL;
      const commission = v.info.commission;
      // console.log('-------');
      // console.log(era, eraReward, validatorCount, commission, activeKSM);
      const apy = (((eraReward / KUSAMA_DECIMAL) / validatorCount) * (1 - commission / 100) * 365) / activeKSM * 4;
      v.apy = apy;
      
      const result = await this.database.saveValidatorNominationData(v.stashId.toString(), {
        era: info.activeEra,
        exposure: v.exposure,
        nominators: v.nominators,
        commission: v.validatorPrefs?.commission / 10000000,
      });
      if (result) {
        console.log(`${v.stashId.toString()} is stored. (${i+1}/${validators.length})`);
      }
    }
  }
}
