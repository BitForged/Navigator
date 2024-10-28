const router = require('express').Router();
const db = require('../database').getConnectionPool();

const EMBED_HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <title>Job Embed</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Job Embed">
    <meta name="author" content="BitJourney Navigator">
    <meta name="robots" content="noindex, nofollow">
    <meta name="theme-color" content="#0095ff">
    <meta property="og:title" content="BitJourney Image">
    <meta property="og:description" content="%description%">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="BitJourney Navigator">
    <meta property="og:image" content="%JOB_IMAGE_URL%">
    <meta name="twitter:card" content="summary_large_image">
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
        }
        .job {
            padding: 1em;
            border-bottom: 1px solid #ccc;
        }
        .job h2 {
            margin: 0;
        }
        
        .job p {
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="job">
        <h2>%title%</h2>
        <p>%description%</p>
        <img src="%JOB_IMAGE_URL%" alt="Job Image"/>
        <br/><sub>This page is primarily intended for Discord Embeds.</sub>
    </div>
</body>
</html>
`

router.get('/embed/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    db.query('SELECT * FROM images WHERE id = ?', [jobId], (err, rows) => {
        if (err) {
            res.status(500).json({ message: 'Internal Server Error' });
            console.error(err);
        } else if (rows.length === 0) {
            res.status(404).json({ message: 'Job not found' });
        } else {
            const job = rows[0];
            let html = EMBED_HTML_TEMPLATE;
            html = html.replace(/%title%/g, "BitJourney Job");
            html = html.replace(/%description%/g, "Served by BitJourney Navigator");
            // We enforce https for the image URL, as Discord requires it.
            html = html.replace(/%JOB_IMAGE_URL%/g, `https://${req.headers.host}/api/images/${jobId}`);
            res.send(html);
        }
    });
});

module.exports = router;