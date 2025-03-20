const { createWriteStream, existsSync } = require("node:fs");
const fsp = require("fs").promises;
const axios = require("axios");

async function getAvailableStorage(path) {
  const { bfree, blocks } = await fsp.statfs(path);

  return Math.floor((bfree / blocks) * 100);
}

function downloadFileToPath(url, path) {
  return new Promise(async (resolve, reject) => {
    try {
      const file = createWriteStream(path);
      const resp = await axios.get(url, {
        responseType: "stream",
      });
      const stream = resp.data.pipe(file);

      stream.on("finish", () => {
        console.log("Download complete");
        resolve();
      });

      stream.on("error", (err) => {
        reject(err);
        console.error("Failed to complete download: ", err);
      });
    } catch (err) {
      reject(err);
      console.error("Failed to process download: ", err);
    }
  });
}

function doesFileExist(path) {
  return existsSync(path);
}

module.exports = {
  getAvailableStorage,
  downloadFileToPath,
  doesFileExist,
};
