const express = require('express');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const embedRouter = require('./routes/embed');
const thirdpartyRouter = require('./thirdparty/router');
const userRouter = require('./routes/user');

const app = express();
const port = process.env.HTTP_API_PORT || 3333;

const SD_API_HOST = process.env.SD_API_HOST || "http://192.168.2.165:7860/sdapi/v1"

app.get('/', (req, res) => {
    res.json({ message: 'Hello World!', status: 'online' });
});

app.set('trust proxy', true);

app.use(express.json({ limit: '50mb' })); // Limit increased to 50mb due to large image (Img2Img) uploads
app.use(allowCors);
app.use('/api', apiRouter.router);
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/3papi', thirdpartyRouter);
app.use(embedRouter)

app.listen(port, () => {
    console.log(`Navigator HTTP is running on port ${port}`);
});

apiRouter.worker();

function allowCors(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    next();
}

/**
 * Returns a number whose value is limited to the given range.
 *
 * Example: limit the output of this computation to between 0 and 255
 * (x * 255).clamp(0, 255)
 *
 * @param {Number} min The lower boundary of the output range
 * @param {Number} max The upper boundary of the output range
 * @returns A number in the range [min, max]
 * @type Number
 */
Number.prototype.clamp = function(min, max) {
    return Math.min(Math.max(this, min), max);
};

module.exports = {
    SD_API_HOST
}