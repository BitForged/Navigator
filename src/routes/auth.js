const router = require('express').Router();
const discord = require('../thirdparty/discord').Discord;
const jwt = require('jsonwebtoken');

const Discord = new discord();

const SECRET_KEY = process.env.SECRET_KEY

if(!SECRET_KEY) {
    console.error("Error: SECRET_KEY is not set!");
    process.exit(1);
}

router.post('/login', async (req, res) => {
    if(req.body.code === undefined) {
        res.status(400).json({ message: 'Code is required' });
        return;
    }
    Discord.exchangeCodeForToken(req.body.code).then(async response => {
        const token = response.data.access_token;
        const user = await Discord.getUser(token);
        const jwtToken = jwt.sign({ discord_id: user.data.id }, SECRET_KEY, { expiresIn: '6h' });
        res.json({ token: jwtToken, user: user.data });
    }).catch(err => {
        console.error(err);
        res.status(401).json({ message: 'Authentication failed' });
    });
})

module.exports = router;