require('module-alias/register')
require('source-map-support').install();
const express = require('express');
const childProcess = require('child_process');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const embedRouter = require('./routes/embed');
const userRouter = require('./routes/user');
const migrations = require('./migrations');
const worker = require('./processing/queueWorker').worker;
const socketManager = require('./processing/socketManager');

import {modelRouter} from './routes/models';
import {thirdPartyRouter} from './thirdparty/router'
const app = express();
const port = process.env.HTTP_API_PORT || 3333;

const SD_API_HOST = process.env.SD_API_HOST || "http://192.168.2.165:7860/sdapi/v1";

// Grab current version information (commit SHA / branch) if found
let versionInfo = {};
if(process.env.BRANCH !== undefined) {
    versionInfo.branch = process.env.BRANCH;
} else {
    // Try to execute git to get the current branch
    try {
        versionInfo.branch = childProcess.execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    } catch(err) {
        versionInfo.branch = 'unknown';
    }
}
if(process.env.COMMIT_SHA !== undefined) {
    versionInfo.commit = process.env.COMMIT_SHA;
} else {
    // Try to execute git to get the current commit SHA
    try {
        versionInfo.commit = childProcess.execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
    } catch(err) {
        versionInfo.commit = 'unknown';
    }
}

console.log(`Starting Navigator - Revision: ${versionInfo.commit} (${versionInfo.branch})`);

(async () => {
    await migrations.runMigrations();
    console.log('Migrations Completed');
})();

app.get('/', (req, res) => {
    res.json({ message: 'Hello World!', status: 'online' });
});

app.set('trust proxy', true);

app.use(express.json({ limit: '50mb' })); // Limit increased to 50mb due to large image (Img2Img) uploads
app.use(allowCors);
app.use('/api', apiRouter.router);
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/3papi', thirdPartyRouter);
app.use('/api/models', modelRouter);
app.use(embedRouter)

app.listen(port, () => {
    console.log(`Navigator HTTP is running on port ${port}`);
});

socketManager.startWsServer();
// noinspection JSIgnoredPromiseFromCall
worker();

function allowCors(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    next();
}

module.exports = {
    SD_API_HOST
}