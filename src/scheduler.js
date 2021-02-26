const keys = require('./config/keys');
const CronJob = require('cron').CronJob;
const axios = require('axios');
const moment = require('moment');

module.exports = class Scheduler {
  constructor(oneKvWrapper, database) {
    this.oneKvWrapper = oneKvWrapper;
    this.database = database;
     // request api every 1 hour to trigger the data cache
     this.job_ = new CronJob('50 */1 * * *', async () => {
      console.log('retrieving validator detail @ ' + moment());
      await axios.get(`http://localhost:${keys.PORT}/api/validDetail`);
      console.log(`http://localhost:${keys.PORT}/api/validDetail`);
      await this.__collectValidatorStatus();
    }, null, true, 'America/Los_Angeles', null, true);
    
  }

  start() {
    console.log('start cronjob');
    this.job_.start();
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
      });
      if (result) {
        console.log(`${v.stash} is stored.`)
      }
    }
  }
}
