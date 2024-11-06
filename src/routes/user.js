const router = require('express').Router();

const security = require('../security');

router.get('/me', security.isAuthenticated, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;