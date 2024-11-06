const jwt = require('jsonwebtoken');

const SECRET_KEY = process.env.SECRET_KEY

function isAuthenticated(req, res, next) {
    if(req.headers.authorization === undefined) {
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }
    const token = req.headers.authorization.split(' ')[1];
    jwt.verify(token, SECRET_KEY, (err, user) => {
        if(err) {
            res.status(401).json({ message: 'Unauthorized', error: err.message });
            return;
        }
        req.user = user;
        next();
    });
}

module.exports = {
    isAuthenticated,
}