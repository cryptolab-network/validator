const Koa = require('koa');
const logger = require('koa-logger');
const bodyparser = require('koa-bodyparser');
const cors = require('koa2-cors');
const Router = require('koa-router');

const ApiHandler = require('./ApiHandler');
const OnekvWrapper = require('./onekvWrapper');
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
  validatorTrend: API_PREFIX + '/validator/:stash/trend',
}

const db = new DatabaseHandler();
db.connect('127.0.0.1', '27017', 'test');

const app = new Koa();
app.use(logger());
app.use(cors());
app.use(bodyparser());

(async() => {
  try {
    
    const handler = await ApiHandler.create(keys.KUSAMA_WSS);
    const onekvWrapper = new OnekvWrapper(handler);
    const polling = new Scheduler(onekvWrapper, db);
    const router = new Router();
    
    router.get('/', async (ctx) => {
      ctx.body = 'Welcome validators.';
    });

    router.get(API.ValidCandidates, async (ctx) => {
      const valid = await onekvWrapper.valid();
      ctx.body = valid;
    });

    router.get(API.Nominators, async (ctx) => {
      const nominators = await onekvWrapper.nominators();
      ctx.body = nominators;
    });

    router.get(API.Statistic, async (ctx) => {
      const { stash } = ctx.params;
      console.log(stash);
      const statistic = await onekvWrapper.statistic('kusama', stash);
      ctx.body = statistic;
    });

    router.get(API.FalseNominations, async (ctx) => {
      const falseNominator = await onekvWrapper.falseNominator();
      ctx.body = falseNominator;
    });

    router.get(API.Validators, async (ctx) => {
      const validators = await onekvWrapper.getValidators();
      ctx.body = validators;
    });

    router.get(API.validatorTrend, async (ctx) => {
      const { stash } = ctx.params;
      const { validator, objectData } = await db.getValidatorStatus(stash);
      ctx.body = objectData;
    });

    router.get(API.onekvlist, async (ctx) => {
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
      ctx.body = list;
    })

    router.get(API.ValidDetail, async (ctx) => {
      const valid = await onekvWrapper.getValidDetail();
      ctx.body = valid;
    });

    router.get(API.polkadot, async (ctx) => {
      const { stash } = ctx.params;
      console.log(stash);
      const statistic = await onekvWrapper.statistic('polkadot', stash);
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


 