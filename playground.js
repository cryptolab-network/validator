const axios = require('axios');

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  })
}

const test = async () => {
  try {
    const result = await axios.get(`https://polkadot.w3f.community/valid`);
    await sleep(600000);
  } catch (err) {
    console.log(`err`);
    console.log(err);
  }
}

test();