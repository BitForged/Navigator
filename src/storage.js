const {createWriteStream} = require("node:fs");
const fsp = require('fs').promises;
const axios = require('axios');

async function getAvailableStorage(path) {
    const { bfree, blocks } = await fsp.statfs(path);

    return bfree / blocks * 100;
}

function downloadFileToPath(url, path) {
    return new Promise(async (resolve, reject) => {
        const file = createWriteStream(path);
        try {
            const resp = await axios.get(url, {
                responseType: 'stream'
            })
            const stream = resp.data.pipe(file);

            stream.on('finish', () => {
                resolve();
            });

            stream.on('error', (err) => {
                reject(err);
            });
        }
        catch (err) {
            reject(err);
        }


    });
}

module.exports = {
    getAvailableStorage,
    downloadFileToPath
}