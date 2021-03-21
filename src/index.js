const compress = require('koa-compress')
const Koa = require('koa');
const logger = require('koa-logger');
const koaCash = require('koa-cash');
const bodyparser = require('koa-bodyparser');
const Router = require('koa-router');

const ApiHandler = require('./ApiHandler');
const OnekvWrapper = require('./onekvWrapper');
const ChainData = require('./chaindata');
const CacheData = require('./cachedata');
const keys = require('./config/keys');

const DatabaseHandler = require('./db/database');
const Scheduler = require('./scheduler');

const API_PREFIX = '/api';
const ONEKV_PREFIX = '/1kv';

const API = {
  ValidCandidates: API_PREFIX + '/valid',
  OnekvNominators: API_PREFIX + ONEKV_PREFIX + '/nominators',
  Nominators: API_PREFIX + '/nominators',
  Statistic: API_PREFIX + '/statistic/:stash',
  FalseNominations: API_PREFIX + '/falseNominations',
  Validators: API_PREFIX + '/validators',
  onekvlist: API_PREFIX + '/onekvlist',
  ValidDetail: API_PREFIX + '/validDetail',
  test: API_PREFIX + '/test',
  polkadot: API_PREFIX + '/polkadot/:stash',
  kusama: API_PREFIX + '/kusama/:stash',
  validatorTrend: API_PREFIX + '/validator/:stash/trend',

  AllValidators: API_PREFIX + '/allValidators',
}

const db = new DatabaseHandler();
db.connect(keys.MONGO_ACCOUNT, keys.MONGO_PASSWORD, keys.MONGO_URL, keys.MONGO_PORT, keys.MONGO_DBNAME);

const app = new Koa();
app.use(logger());
app.use(bodyparser());

class Cache {
  constructor() {
    this.cache = {};
  }
  get(key, maxAge) {
    const data = this.cache[key];
    if(data === undefined) {
      return;
    }
    if(new Date() - data.timestamp > maxAge) {
      console.log('cache expired');
      return;
    }
    console.log('cache hit');
    return data.value;
  }
  set(key, value) {
    console.log('cache set 2');
    this.cache[key] = {
      value: value,
      timestamp: new Date(),
    }
  }
}
const cache = new Cache();

app.use(compress({
  filter: function (content_type) {
     return /text/i.test(content_type)
  },
  threshold: 2048,
  gzip: {
    flush: require('zlib').constants.Z_SYNC_FLUSH
  },
  deflate: {
    flush: require('zlib').constants.Z_SYNC_FLUSH,
  },
  br: false,
}));


app.use(koaCash({
  compression: true,
  setCachedHeader: true,
  get(key, maxAge) {
    return new Promise((resolve, reject)=>{
      resolve(cache.get(key, maxAge));
    }); 
  },
  set(key, value) {
    console.log('cache set');
    return new Promise((resolve, reject)=>{
      cache.set(key, value);
      resolve();
    });
    
  },
}));

(async() => {
  try {
    console.log(keys.KUSAMA_WSS);
    const handler = await ApiHandler.create(keys.KUSAMA_WSS);
    const cacheData = new CacheData();
    const onekvWrapper = new OnekvWrapper(handler);
    const chainData = new ChainData(handler);
    const polling = new Scheduler(onekvWrapper, chainData, db, cacheData);
    const router = new Router();
    
    router.get('/', async (ctx) => {
      ctx.body = 'Welcome validators.';
    });

    router.get(API.ValidCandidates, async (ctx) => {
      try {
        const valid = await onekvWrapper.valid();
        ctx.compress = true;
        ctx.body = valid;
      } catch (err) {
        if (err.response.status === 503) {
          ctx.body = {
            errorCode: 503, // server error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        } else {
          ctx.compress = true;
          ctx.body = {
            errorCode: 9999, // unknown error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        }
      }
    });

    router.get(API.OnekvNominators, async (ctx) => {
      try {
        const nominators = await onekvWrapper.onekvNominators();
        ctx.compress = true;
        ctx.body = nominators;
      } catch (err) {
        if (err.response.status === 503) {
          ctx.body = {
            errorCode: 503, // server error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        } else {
          ctx.compress = true;
          ctx.body = {
            errorCode: 9999, // unknown error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        }
      }
    });

    router.get(API.Nominators, async (ctx) => {
      if (await ctx.cashed(300000)) {
        return;
      }
      try {
        const nominators = await onekvWrapper.nominators();
        ctx.compress = true;
        ctx.body = nominators;
      } catch (err) {
        console.log(err);
        ctx.compress = true;
        ctx.body = {
          errorCode: 9999, // unknown error
          errorMsg: `Failed to fetch nominators from chaindata`,
        }
      }
    });

    router.get(API.Statistic, async (ctx) => {
      const { stash } = ctx.params;
      console.log(stash);
      const statistic = await onekvWrapper.statistic('kusama', stash);
      ctx.compress = true;
      ctx.body = statistic;
    });

    router.get(API.FalseNominations, async (ctx) => {
      try {
        const falseNominator = await onekvWrapper.falseNominator();
        ctx.compress = true;
        ctx.body = falseNominator;
      } catch (err) {
        if (err.response.status === 503) {
          ctx.body = {
            errorCode: 503, // server error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        } else {
          ctx.compress = true;
          ctx.body = {
            errorCode: 9999, // unknown error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        }
      }
    });

    router.get(API.AllValidators, async (ctx) => {
      try {
        if (await ctx.cashed(300000)) {
          return;
        }
      } catch(err) {
        console.log('get data from koa cash failed');
        console.log(err);
      }
      try {
        const size = parseInt(ctx.request.query.size);
        const page = parseInt(ctx.request.query.page);
        const [era, err] = await chainData.getActiveEraIndex();
        if ((size < 1 || size > keys.PAGE_SIZE) && (page < 0)) {
          ctx.status = 400;
          ctx.body = {
            error: `Invalid parameter. size must be >= 1 and <=${keys.PAGE_SIZE}. page must be >=0`
          }
          return;
        }
        console.log(`era=${era}`);
        const { validator } = await db.getValidators(era, size, page);
        ctx.compress = true;
        ctx.body = validator;
      } catch (err) {
        if (err.response.status === 503) {
          ctx.body = {
            errorCode: 503, // server error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        } else {
          ctx.compress = true;
          ctx.body = {
            errorCode: 9999, // unknown error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        }
      }
    });

    router.get(API.Validators, async (ctx) => {
      try {
        const validators = await onekvWrapper.getValidators();
        ctx.compress = true;
        ctx.body = validators;
      } catch (err) {
        if (err.response.status === 503) {
          ctx.body = {
            errorCode: 503, // server error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        } else {
          ctx.compress = true;
          ctx.body = {
            errorCode: 9999, // unknown error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        }
      }
    });

    router.get(API.validatorTrend, async (ctx) => {
      const { stash } = ctx.params;
      const { validator, objectData } = await db.getValidatorStatus(stash);
      ctx.compress = true;
      ctx.body = objectData;
    });

    router.get(API.onekvlist, async (ctx) => {
      if (await ctx.cashed(300000)) {
        return;
      }
      try {
        const rate = (ctx.request.query.rate/100) || 1;
        const validators = await onekvWrapper.getValidators();
        let list = [];
        validators.valid.forEach((validator) => {
          if (validator.electedRate <= rate) {
            list.push({
              stash: validator.stash,
              name: validator.name,
              rank: validator.rank,
              electedRate: validator.electedRate,
              eras: `from ${validator.stakerPoints[0].era} to ${validator.stakerPoints[validator.stakerPoints.length - 1].era}`,
              stakerPoints: validator.stakerPoints,
            })
          }
        })
        ctx.compress = true;
        ctx.body = list;
      } catch (err) {
        if (err.response.status === 503) {
          ctx.body = {
            errorCode: 503, // server error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        } else {
          ctx.compress = true;
          ctx.body = {
            errorCode: 9999, // unknown error
            errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
          }
        }
      }
    })

    router.get(API.ValidDetail, async (ctx) => {
      try {
        if (await ctx.cashed(300000)) {
          return;
        }
      } catch(err) {
        console.log('get data from koa cash failed');
        console.log(err);
      }
      try {
        const { option } = ctx.request.query;
        const valid = await onekvWrapper.getValidDetail({target: option});
        ctx.compress = true;
        ctx.body = valid;
      } catch (err) {
        if(err.response !== undefined) {
          if (err.response.status === 503) {
            ctx.body = {
              errorCode: 503, // server error
              errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
            }
          } else {
            ctx.compress = true;
            ctx.body = {
              errorCode: 9999, // unknown error
              errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
            };
          }
        } else {
          ctx.compress = true;
            ctx.body = {
              errorCode: 9999, // unknown error
              errorMsg: err,
            };
        }
      }
    });

    router.get(API.polkadot, async (ctx) => {
      const { stash } = ctx.params;
      console.log(stash);
      const statistic = await onekvWrapper.statistic('polkadot', stash);
      ctx.compress = true;
      ctx.body = statistic;
    });

    router.get(API.kusama, async (ctx) => {
      const { stash } = ctx.params;
      console.log(stash);
      const statistic = await onekvWrapper.statistic('kusama', stash);
      ctx.compress = true;
      ctx.body = statistic;
    });

    router.get(API.test, async (ctx) => {
      try {
        // const { option } = ctx.request.query;
        // const valid = await onekvWrapper.getValidDetailTest(option);
        // ctx.compress = true;
        // ctx.body = valid;
        ctx.body = [];
      } catch (err) {
        console.log(err);
        ctx.body = [];
      }
    });

    app.use(router.routes());
    polling.start();
    app.listen(keys.PORT);
  } catch (e) {
    console.log(e);
  }
  return;
})();


 