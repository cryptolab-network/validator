const axios = require('axios');

const test = async () => {
  try {
    const result = await axios.get(`https://polkadot.w3f.community/valid`);
  } catch (err) {
    console.log(`err`);
    console.log(err);
  }
}

test();