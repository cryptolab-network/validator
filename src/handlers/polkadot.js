const ApiHandler = require('../ApiHandler');
const OnekvWrapper = require('../onekvWrapper');
const ChainData = require('../chaindata');
const CacheData = require('../cachedata');
const keys = require('../config/keys');
const Router = require('koa-router');

const DatabaseHandler = require('../db/database');
const Scheduler = require('../dotScheduler');

const API_PREFIX = '/api';
const DOT_PREFIX = '/dot';
const ONEKV_PREFIX = '/1kv';

const API = {
  ValidCandidates: API_PREFIX + DOT_PREFIX + '/valid',
  Nominators: API_PREFIX + DOT_PREFIX + '/nominators',
  Statistic: API_PREFIX + DOT_PREFIX + '/statistic/:stash',
  Validators: API_PREFIX + DOT_PREFIX + '/validators',
  ValidDetail: API_PREFIX + DOT_PREFIX + '/validDetail',
  validatorTrend: API_PREFIX + DOT_PREFIX + '/validator/:stash/trend',
  AllValidators: API_PREFIX + DOT_PREFIX + '/allValidators',
}

class Kusama {
    constructor() {
        this.db = new DatabaseHandler();
        this.db.connect(keys.MONGO_ACCOUNT, keys.MONGO_PASSWORD, keys.MONGO_URL, keys.MONGO_PORT, keys.MONGO_DBNAME_POLKADOT);
    }

    async initialize() {
        const db = this.db;
        console.log(keys.POLKADOT_WSS);
        const handler = await ApiHandler.create(keys.POLKADOT_WSS);
        const cacheData = new CacheData('data/data_polkadot.json');
        const onekvWrapper = new OnekvWrapper(handler, cacheData);
        const chainData = new ChainData(handler);
        this.polling = new Scheduler(onekvWrapper, chainData, db, cacheData);
        const router = new Router();

        router.get(API.Nominators, async (ctx) => {
        if (await ctx.cashed(300000)) {
            return;
        }
        try {
            const nominators = await chainData.getNominators();
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
            if (err.response !== undefined && err.response.status === 503) {
            ctx.compress = true;
            ctx.body = {
                errorCode: 503, // server error
                errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
            }
            } else if (err.response !== undefined) {
            ctx.compress = true;
            ctx.body = {
                errorCode: 9999, // unknown error
                errorMsg: `${err.response.status}: Failed to fetch ${err.response.config.url}`,
            } 
            } else {
            ctx.compress = true;
            ctx.body - {
                errorCode: 99999999
            }
            console.log(err);
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

        this.router = router;
    }

    routes() {
        return this.router.routes();
    }

    start() {
        this.polling.start();
    }
}

module.exports = Kusama;