const router = require('express').Router();

const security = require('../security');
const db = require('../database').getConnectionPool();

router.get('/me', security.isAuthenticated, (req, res) => {
    res.json({ user: req.user });
});

router.get('/jobs', security.isAuthenticated, (req, res) => {
    db.query('SELECT id FROM images WHERE owner_id = ?', [req.user.discord_id], (err, results) => {
        if(err) {
            console.error(err);
            res.status(500).json({ message: 'Internal Server Error' });
            return;
        }
        res.json(results);
    });
});

module.exports = router;