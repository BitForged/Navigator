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

router.delete('/image/:imageId', security.isAuthenticated, (req, res) => {
    db.query('DELETE FROM images WHERE id = ? AND owner_id = ?', [req.params.imageId, req.user.discord_id], (err, results) => {
        if(err) {
            console.error(err);
            res.status(500).json({ message: 'Internal Server Error' });
            return;
        }
        // TODO: Socket emit to instruct downstream bots to delete image from known channels.
        res.status(204).json({ message: 'Image deleted' });
    });
});

module.exports = router;