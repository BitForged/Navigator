const express = require('express');
const apiRouter = require('./routes/api');

const app = express();
const port = process.env.HTTP_API_PORT || 3333;

const SD_API_HOST = process.env.SD_API_HOST || "http://192.168.2.165:7860/sdapi/v1"

app.get('/', (req, res) => {
    res.json({ message: 'Hello World!', status: 'online' });
});

app.use(express.json());
app.use('/api', apiRouter.router);

app.listen(port, () => {
    console.log(`Navigator HTTP is running on port ${port}`);
});

apiRouter.worker();

module.exports = {
    SD_API_HOST
}