const keys = require('./config/keys');
const CronJob = require('cron').CronJob;
const axios = require('axios');
const moment = require('moment');
const CacheData = require('./cachedata');

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
      await axios.get(`http://localhost:${keys.PORT}/api/validDetail`);
      console.log(`http://localhost:${keys.PORT}/api/validDetail`);
      await this.__collectValidatorStatus();
      await this.__collectNominatorBalances();
      this.isCaching = false;
    }, null, true, 'America/Los_Angeles', null, true);
    
  }

  start() {
    console.log('start cronjob');
    this.job_.start();
  }

  async __collectNominatorBalances() {
    const startTime = new Date().getTime();
    const info = await this.chainData.getValidatorWaitingInfo();
    const nominators = info.nominations;
    for(let i = 0; i < nominators.length; i++) {
      const nominator = nominators[i].nominator;
      const balance = await this.chainData.getNominatorBalance(nominator);
      if(balance !== undefined && balance.length > 0) {
        this.cacheData.updateBalance(nominator, balance);
        console.log(`${i + 1}/${nominators.length}: Balance of ${nominator} is updated: ${balance[0].amount}`);
      }
      if(i % 100 === 0) {
        let tmpTime = new Date().getTime();
        console.log(
          `data collection time in progress: ${((tmpTime - startTime) / 1000).toFixed(3)}s`
        )
      }
    }
    const endTime = new Date().getTime();
    const dataCollectionTime = endTime - startTime
    // eslint-disable-next-line
    console.log(
      `data collection time for nominator balances: ${(dataCollectionTime / 1000).toFixed(3)}s`
    )
  }

  async __collectValidatorStatus() {
    console.log('Collecting validator status');
    const info = await this.oneKvWrapper.getValidDetail();
    const validators = info.valid;
    if(!Array.isArray(validators)) {
      console.error('validator detail does not contain info of validators');
      return;
    }
    for(let i = 0; i < validators.length; i++) {
      const v = validators[i];
      const result = await this.database.saveValidatorNominationData(v.stash, {
        era: info.activeEra,
        exposure: v.stakingInfo?.exposure.others,
        nominators: v.stakingInfo?.nominators,
        commission: v.stakingInfo?.validatorPrefs?.commission / 10000000,
      });
      if (result) {
        console.log(`${v.stash} is stored.`)
      }
    }
  }
}
