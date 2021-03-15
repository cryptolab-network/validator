const compress = require('koa-compress')
const Koa = require('koa');
const logger = require('koa-logger');
const koaCash = require('koa-cash');
const bodyparser = require('koa-bodyparser');
const cors = require('koa2-cors');
const Router = require('koa-router');

const ApiHandler = require('./ApiHandler');
const OnekvWrapper = require('./onekvWrapper');
const ChainData = require('./chaindata');
const CacheData = require('./cachedata');
const keys = require('./config/keys');

const DatabaseHandler = require('./db/database');
const Scheduler = require('./scheduler');

const API_PREFIX = '/api';

const API = {
  ValidCandidates: API_PREFIX + '/valid',
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
  get(key) {
    return this.cache[key];
  }
  set(key, value) {
    this.cache[key] = value;
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

app.use(cors({
  origin: function(ctx) {
    return '*';
  },
  exposeHeaders: ['WWW-Authenticate', 'Server-Authorization'],
  maxAge: 600,
}));

app.use(koaCash({
  compression: true,
  get(key, maxAge) {
    return cache.get(key);
  },
  set(key, value) {
    cache.set(key, value);
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
      const valid = await onekvWrapper.valid();
      ctx.compress = true;
      ctx.body = valid;
    });

    router.get(API.Nominators, async (ctx) => {
      const nominators = await onekvWrapper.nominators();
      ctx.compress = true;
      ctx.body = nominators;
    });

    router.get(API.Statistic, async (ctx) => {
      const { stash } = ctx.params;
      console.log(stash);
      const statistic = await onekvWrapper.statistic('kusama', stash);
      ctx.compress = true;
      ctx.body = statistic;
    });

    router.get(API.FalseNominations, async (ctx) => {
      const falseNominator = await onekvWrapper.falseNominator();
      ctx.compress = true;
      ctx.body = falseNominator;
    });

    router.get(API.AllValidators, async (ctx) => {
      if (await ctx.cashed(300000)) {
        return;
      }
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
    });

    router.get(API.Validators, async (ctx) => {
      const validators = await onekvWrapper.getValidators();
      ctx.compress = true;
      ctx.body = validators;
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
    })

    router.get(API.ValidDetail, async (ctx) => {
      if (await ctx.cashed(300000)) {
        console.log(ctx.response.headers);
        return;
      }
      const { option } = ctx.request.query;
      const valid = await onekvWrapper.getValidDetail(option);
      ctx.compress = true;
      ctx.body = valid;
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
      ctx.body = [];
    });

    app.use(router.routes());
    polling.start();
    app.listen(keys.PORT);
  } catch (e) {
    console.log(e);
  }
  return;
})();


 