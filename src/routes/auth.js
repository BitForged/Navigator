const router = require('express').Router();
const {exchangeCodeForToken, getUser} = require('../thirdparty/discord');
const jwt = require('jsonwebtoken');

import {getPermissionRole, PermissionRole} from "@/security";

const SECRET_KEY = process.env.SECRET_KEY
const TOKEN_EXPIRATION_TIME = process.env.TOKEN_EXPIRATION_TIME || '72h';

if (!SECRET_KEY) {
    console.error("Error: SECRET_KEY is not set!");
    process.exit(1);
}

if (TOKEN_EXPIRATION_TIME === '-1') {
    console.warn("Warning: TOKEN_EXPIRATION_TIME is set to -1, which means authentication tokens will never expire!");
}

router.post('/login', async (req, res) => {
    if (req.body.code === undefined) {
        res.status(400).json({message: 'Code is required'});
        return;
    }
    exchangeCodeForToken(req.body.code).then(async response => {
        const token = response.data.access_token;
        const user = await getUser(token);

        // Ensure the user's permission role allows them to be eligible to authenticate via the API
        const role = await getPermissionRole(user.data.id);
        if (role < PermissionRole.APPRENTICE) {
            res.status(403).json({error: 'This user does not have API access yet. Please contact an Administrator to get access.'});
            return;
        }

        // Set expiration unless TOKEN_EXPIRATION_TIME is -1 (no expiration)
        let jwtToken;
        if (TOKEN_EXPIRATION_TIME !== '-1') {
            jwtToken = jwt.sign({discord_id: user.data.id, role}, SECRET_KEY, {expiresIn: TOKEN_EXPIRATION_TIME});
        } else {
            jwtToken = jwt.sign({discord_id: user.data.id, role}, SECRET_KEY);
        }
        res.json({token: jwtToken, user: user.data});
    }).catch(err => {
        console.error(err);
        res.status(401).json({error: 'Authentication through Discord failed'});
    });
})

module.exports = router;