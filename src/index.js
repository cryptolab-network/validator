const compress = require('koa-compress')
const Koa = require('koa');
const logger = require('koa-logger');
const koaCash = require('koa-cash');
const bodyparser = require('koa-bodyparser');

const keys = require('./config/keys');

const KusamaHandler = require('./handlers/kusama');
const PolkadotHandler = require('./handlers/polkadot');

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
    const kusamaHandler = new KusamaHandler();
    await kusamaHandler.initialize();
    app.use(kusamaHandler.routes());
    const polkadotHandler = new PolkadotHandler();
    await polkadotHandler.initialize();
    app.use(polkadotHandler.routes());
    kusamaHandler.start();
    polkadotHandler.start();
    app.listen(keys.PORT);
  } catch (e) {
    console.log(e);
  }
  return;
})();


 