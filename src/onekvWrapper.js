const axios = require('axios');
const moment = require('moment');
const ChainData = require('./chaindata');
const CacheData = require('./cachedata');
const keys = require('./config/keys');

const KUSAMA_DECIMAL = 1000000000000;
const POLKADOT_DECIMAL = 10000000000;
const NODE_RPC_URL = keys.API_1KV_KUSAMA;

module.exports = class OnekvWrapper {
  constructor(handler) {
    this.handler = handler
    this.chaindata = new ChainData(handler);
    this.cachedata = new CacheData();
  }

  valid = async () => {
    const [activeEra, error] = await this.chaindata.getActiveEraIndex();
    if (error !== null) {
      console.log(error);
      return [];
    }

    const validCache = await this.cachedata.fetch(activeEra, 'valid');
    if (validCache !== null) {
      return validCache;
    }
    
    const res = await axios.get(`${NODE_RPC_URL}/valid`);
    if (res.status !== 200 && res.data.length === 0) {
      console.log(`no data`)
      return {
        errorCode: 1000,
        errorMsg: 'Failed to fetch 1kv validators.' 
      };
    }

    let valid = res.data;
    const [, activeStash] = await this.chaindata.getValidators();
    let electedCount = 0;
    valid = valid.map((candidate) => {
      candidate.discoveredAt = moment(candidate.discoveredAt).format();
      candidate.nominatedAt = moment(candidate.nominatedAt).format();
      candidate.onlineSince = moment(candidate.onlineSince).format();
      if (activeStash.indexOf(candidate.stash) !== -1) {
        candidate.elected = true;
        electedCount++;
      } else {
        candidate.elected = false;
      }
      return candidate;
    })

    valid = {
      activeEra,
      validatorCount: valid.length,
      electedCount,
      electionRate: (electedCount / valid.length),
      valid,
    }

    await this.cachedata.update('valid', valid);
    return valid;
  }

  nominators = async () => {
    // retrive active era
    const [activeEra, err] = await this.chaindata.getActiveEraIndex();
    // check cache data to retive data
    const data = await this.cachedata.fetch(activeEra, 'nominators');
    if (data !== null) {
      return data;
    }

    let res = await axios.get(`${NODE_RPC_URL}/nominators`);
    if (res.status === 200) {
      let nominators = res.data;

      let validCandidates = await this.valid();

      nominators = nominators.map((nominator, index, array) => {
        const current = nominator.current.map((stash, index, array) => {
          let candidate = validCandidates.valid.find((c, index, array) => {
            return stash === c.stash;
          });
          if (candidate === undefined) {
            return {
              stash,
              name: null,
              elected: null
            }
          } else {
            return {
              stash: stash,
              name: candidate.name,
              elected: candidate.elected
            }
          }
        });
        return {
          current,
          lastNomination: moment(nominator.lastNomination).format(),
          createdAt: moment(nominator.createdAt).format(),
          _id: nominator._id,
          address: nominator.address,
          __v: nominator.__v,
        }
      });

      nominators = {
        activeEra: parseInt(activeEra),
        nominators
      }

      await this.cachedata.update('nominators', nominators);

      return nominators;
    } else {
      // this.cachedata.update('nominators', []);
      console.log(`no data`)
      return {
        errorCode: 2000,
        errorMsg: 'Failed to fetch 1kv nominators.' 
      };
    }
  }

  statistic = async (network, stash) => {
    let list = [];
    let page = 0;
    let res;
    do {
      res = await this.chaindata.getRewardSlashFromSubscan(network, stash, page);

      if (res === null) {
        return [];
      }

      list = [...list, ...res.data.list];
      page++;
    } while (res.data.list.length > 0);

    if (list.length === 0) {
      return list;
    }

    let amounts = list.map((item) => {
      return parseInt(item.amount, 10);
    })
    
    const to = moment.unix(list[0].block_timestamp);
    const from = moment.unix(list[list.length-1].block_timestamp);

    if (network === 'polkadot') {
      let totalReward = amounts.reduce((a, c) => {
        return a + c
      })/POLKADOT_DECIMAL;
      list = {
        stash,
        totalReward_DOT: totalReward,
        firstReward: from,
        latestReward: to,
      }
  
      return list;
    }

    let totalReward = amounts.reduce((a, c) => {
      return a + c
    })/KUSAMA_DECIMAL;

    const stakerPoints = await this.chaindata.getStakerPoints(stash);
    let electedCount = 0;
    stakerPoints.forEach((era) => {
      if (parseInt(era.points) !== 0) {
        electedCount++;
      }
    });

    list = {
      stash,
      totalReward_KSM: totalReward,
      firstReward: from,
      latestReward: to,
      electedRate: electedCount / stakerPoints.length,
      stakerPoints
    }

    return list;
  }

  falseNominator = async () => {
    let nominators = await this.nominators();
    nominators = nominators.nominators;
    const activeStash = await this.chaindata.getValidators();
    let res = await axios.get(`${NODE_RPC_URL}/candidates`);
    if (res.status !== 200 || res.data.length === 0) {
      console.log(`no data`)
      return {
        errorCode: 3000,
        errorMsg: 'Failed to fetch 1kv candidates.' 
      };
    }
    const candidates = res.data;
    res = await axios.get(`${NODE_RPC_URL}/invalid`);
    if (res.status !== 200 || res.data.length === 0) {
      console.log(`no data`)
      return {
        errorCode: 4000,
        errorMsg: 'Failed to fetch 1kv invalid.' 
      };
    }
    let invalid = res.data;
    invalid = invalid.split(/\n/);

    // collect false nominations. only valid candidate should be nominated by 1kv.
    let falseNominator = [];
    nominators.forEach(nominator => {
      nominator.current.forEach(stash => {
        if (stash.name === null || stash.elected === null) {
          stash.nominatorAddress = nominator.address;

          // get name of candidate
          const candidate = candidates.find((c) => {
            return c.stash === stash.stash;
          });

          if (activeStash.indexOf(stash) !== -1) {
            stash.elected = true;
          } else {
            stash.elected = false;
          }

          stash.name = candidate.name;
          const reason = invalid.find((i) => {
            return i.indexOf(stash.name) !== -1;
          })
          stash.reason = reason;
          falseNominator.push(stash);
        }
      });
    });
    return falseNominator;
  }

  getValidators = async () => {
    const [activeEra, error] = await this.chaindata.getActiveEraIndex();
    if (error !== null) {
      console.log(error);
      return [];
    }

    const validatorsCache = await this.cachedata.fetch(activeEra, 'validators');
    if (validatorsCache !== null) {
      return validatorsCache;
    }


    let data = await this.valid();
    if (data.valid.length === 0) {
      return [];
    }
    // sorted by rank
    let valid = data.valid.sort((a, b) => {
      return parseInt(b.rank) - parseInt(a.rank);
    });
    data.valid = await this.chaindata.getValidatorInfo(valid);

    await this.cachedata.update('validators', data);

    return data;
  }

  getNominators = async () => {
    const data = await this.chaindata.getNominators();
    return data;
  }

  getValidDetail = async (option = '1kv') => {
    console.log(`option = ${option}`);
    const [activeEra, err] = await this.chaindata.getActiveEraIndex();
    if (err !== null) {
      console.log(err);
      return [];
    }

    if (option === 'all') {
      const validDetailAllCache = await this.cachedata.fetch(activeEra, 'validDetailAll');
      if (validDetailAllCache !== null) {
        return validDetailAllCache;
      }
    } else {
      const validDetailCache = await this.cachedata.fetch(activeEra, 'validDetail');
      if (validDetailCache !== null) {
        return validDetailCache;
      }
    }

    const startTime = new Date().getTime();

    // fetch 1kv validators first.
    if (option !== 'all') {
      const res = await axios.get(`${NODE_RPC_URL}/valid`);
      if (res.status !== 200 || res.data.length === 0) {
        console.log(`no data`)
        return {
          errorCode: 1000,
          errorMsg: 'Failed to fetch 1kv validators.' 
        };
      }
    }
    
    let {validators, nominations} = await this.chaindata.getValidatorWaitingInfo();
    const dataCollectionEndTime = new Date().getTime();
    const dataCollectionTime = dataCollectionEndTime - startTime
    // eslint-disable-next-line
    console.log(
      `data collection time: ${(dataCollectionTime / 1000).toFixed(3)}s`
    )
    
    const dataProcessStartTime = new Date().getTime();
    let electedCount = 0;
    let valid;
    if (option === 'all') {
      valid = validators.map((validator) => {
        const nominators = nominations.filter((nomination) => {
          return nomination.targets.some((target) => {
            return target === validator.accountId.toString();
          })
        })
        validator.totalNominators = nominators.length;
        validator.nominators = nominators.map((element) => {
          return {
            address: element.accountId,
            balance: element.balance,
          }
        })
        if (validator.active){
          electedCount++;
        } 
        return validator;
      });
      valid = {
        activeEra,
        validatorCount: valid.length,
        electedCount,
        electionRate: (electedCount / valid.length),
        valid: valid,
      }
      await this.cachedata.update('validDetailAll', valid);
    } else {
      valid = res.data;
      let electedCount = 0;
      valid = await Promise.all(valid.map(async (candidate) => {
        const stakingInfo = validators.find((validator) => {
          return validator.accountId.toString() === candidate.stash;
        });
        if (stakingInfo === undefined) {
          candidate.missing = true;
          candidate.elected = false;
          candidate.activeNominators = 0;
          candidate.totalNominators = 0;
          candidate.stakingInfo = null;
        } else {
          candidate.elected = stakingInfo.active;
          candidate.activeNominators = candidate.elected ? stakingInfo.exposure.others.length : 0;
          const nominators = nominations.filter((nomination) => {
            return nomination.targets.some((target) => {
              return target === candidate.stash;
            })
          })
          candidate.totalNominators = nominators.length;
          stakingInfo.nominators = nominators.map((element) => {
            return {
              address: element.accountId,
              balance: element.balance,
            }
          })
          candidate.stakingInfo = stakingInfo;
          if (candidate.elected) {
            electedCount++;
          }

          const stakerPoints = await this.chaindata.getStakerPoints(candidate.stash);
          let count = 0;
          stakerPoints.forEach((era) => {
            if (parseInt(era.points) !== 0) {
              count++;
            }
          });
          candidate.electedRate = count / stakerPoints.length;
          candidate.stakerPoints = stakerPoints;

        }
        return candidate;
      }))
      
      valid = {
        activeEra,
        validatorCount: valid.length,
        electedCount,
        electionRate: (electedCount / valid.length),
        valid: valid,
      }

      await this.cachedata.update('validDetail', valid);
    }
    const dataProcessEndTime = new Date().getTime();
    const dataProcessTime = dataProcessEndTime - dataProcessStartTime;
    // eslint-disable-next-line
    console.log(
      `data process time: ${(dataProcessTime / 1000).toFixed(3)}s`
    )
    return valid;
  }
}

