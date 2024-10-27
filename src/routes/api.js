const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Semaphore = require('../Semaphore');
const Server = require('socket.io').Server;
const db = require('../database').getConnectionPool();
const router = express.Router();
const constants = require('../constants');

let lastUsedModel = ""; // TODO: Check the stable diffusion model loaded on the backend to prefill this value at startup.
const queue = [];
const semaphore = new Semaphore(1); // Current stable diffusion backend only supports 1 concurrent request

const rtPort = Number(process.env.RT_API_PORT) || 3334;

const io = new Server(rtPort);

console.log(`Navigator Realtime is running on port ${rtPort}!`);

if(process.env.I_DO_NOT_LIKE_FUN !== null) {
    io.on("connection", (socket) => {
        console.log(`Charting a course for client ${socket.id}. Steady as she goes!`);
        socket.emit("connected", { message: `Welcome aboard! We're navigating uncharted territories together.` });
        socket.on("disconnect", () => {
            console.log(`Client ${socket.id} has set sail for distant shores. Until we meet again!`);
        });
    });
}

/*
    The goal of this route is to grab a list of models from the SD API, and also compare it to a list of models that we
     have in our database. Our database will include known models that might have certain attributes that we want consumers
     to be aware of, or we might assign it a more user-friendly name, etc.
 */
router.get('/models', async (req, res) => {
    axios.get(`${constants.SD_API_HOST}/sd-models`)
        .then(response => {
            db.query('SELECT * FROM models', (error, results) => {
                if (error) {
                    res.json({ error: error.message });
                } else {
                    const models = response.data.map(model => {
                        const match = results.find(result => result.model_name === model.model_name);
                        if (match) {
                            return {
                                ...model,
                                known: true,
                                ...match
                            }
                        } else {
                            return {
                                ...model,
                                known: false
                            };
                        }
                    });
                    res.json({ models });
                }
            });
            // res.json(response.data);
        })
        .catch(error => {
            res.json({ error: error.message });
        });
});

router.post('/queue/txt2img', async (req, res) => {
     /* For now, we expect the following parameters:
        - model_name
        - prompt (the "positive" prompt)
        - negative_prompt
        - message_id (optional)
        - owner_id
        - job_id (optional, if not present, generate one)
        - width (optional, default to 512)
        - height (optional, default to 512)
        - steps (optional, default to 50)
        - seed (optional, default to null)
      */

    const { model_name, prompt, negative_prompt, message_id, owner_id, job_id, width, height, steps, seed } = req.body;

    if (!model_name || !prompt || !owner_id) {
        res.json({ error: 'Missing required parameters' });
        return;
    }
    // TODO: Check if model_name is valid
    const job = {
        model_name,
        prompt,
        negative_prompt,
        message_id,
        owner_id,
        job_id: job_id || uuidv4().toString().substring(0, 8), //TODO: Check if job_id is unique
        width: width || 512,
        height: height || 512,
        steps: steps || 50,
        seed: seed || -1,
        queue_size: queue.length + 1,
        task_type: 'txt2img',
        status: 'queued'
    };

    let error = await createImageJobInDB(job);

    if (error) {
        res.status(400).json({ error: error});
        return;
    }

    queue.push(job);
    res.json(job);
});

router.get('/images/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    db.query('SELECT image_data FROM images WHERE id = ?', [jobId], (error, results) => {
        if (error) {
            res.json({ error: error.message });
        } else {
            if (results.length > 0) {
                const data = results[0].image_data.toString();
                const decodedImage = Buffer.from(data, 'base64');
                res.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': decodedImage.length});
                res.end(decodedImage);
            } else {
                res.status(404).json({ error: 'Image not found' });
            }
        }
    });
});

router.get('/previews/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    db.query('SELECT preview_data FROM images WHERE id = ?', [jobId], (error, results) => {
        if (error) {
            res.json({ error: error.message });
        } else {
            if (results.length > 0) {
                if(results[0].preview_data === null) {
                    res.status(404).json({ error: 'Preview not found' });
                    return;
                }
                const data = results[0].preview_data.toString();
                const decodedImage = Buffer.from(data, 'base64');
                res.writeHead(200, {'Content-Type': 'image/png', 'Content-Length': decodedImage.length});
                res.end(decodedImage);
            } else {
                res.status(404).json({ error: 'Preview not found' });
            }
        }
    });
});

async function worker() {
    console.log("Navigator Queue Worker started!");
    while(true) {
        await semaphore.acquire();

        if(queue.length > 0) {
            const task = queue.shift();
            task.status = 'started';
            delete task.queue_size;
            try {
                io.sockets.emit('task-started', task);
                await processTxt2ImgTask(task);
            } catch(error) {
                console.error('Error processing task: ', error);
            } finally {
                semaphore.release();
            }
        } else {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            semaphore.release();
        }
    }
}

function createImageJobInDB(job) {
    return new Promise((resolve, reject) => {
        db.query('INSERT INTO images (id, message_id, owner_id) VALUES (?,?, ?)', [job.job_id, job.message_id, job.owner_id], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function writeImageToDB(jobId, image) {
    return new Promise((resolve, reject) => {
        if(image === null || image === undefined) {
            console.error('Image is null or undefined!');
            reject('Image is null or undefined!');
        }

        if(jobId === null || jobId === undefined) {
            console.error('JobId is null or undefined!');
            reject('JobId is null or undefined!');
            return;
        }
        db.execute('UPDATE images SET image_data = ? WHERE id = ?', [image, jobId], function(error) {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function savePreviewToDb(jobId, preview) {
    return new Promise((resolve, reject) => {
        if(preview === null || preview === undefined) {
            console.error('Preview is null or undefined!');
            reject('Preview is null or undefined!');
            return;
        }
        db.execute('UPDATE images SET preview_data = ? WHERE id = ?', [preview, jobId], function(error) {
            if (error) {
                reject(error);
                console.error('Preview failed saved to DB!');
            } else {
                resolve();
                console.log('Preview saved to DB!');
            }
        });
    });
}

async function checkForProgressAndEmit(task) {
    await new Promise((resolve) => {
        axios.get(`${constants.SD_API_HOST}/progress`)
            .then(async response => {
                // console.log('Progress: ', response.data);
                await savePreviewToDb(task.job_id, response.data.current_image);
                io.sockets.emit('task-progress', {
                    ...task,
                    progress: response.data.progress,
                    eta_relative: response.data.eta_relative,
                    current_step: response.data.state.sampling_step,
                    total_steps: response.data.state.sampling_steps,
                    progress_path: "/api/previews/" + task.job_id
                });
                resolve();
            })
            .catch(error => {
                console.error('Error checking for progress: ', error);
                resolve();
            });
    });
}

async function processTxt2ImgTask(task) {
    console.log('Processing txt2img task: ', task);
    task.status = 'processing';
    let hasQueued = false;
    await new Promise((resolve) => {
        const interval = setInterval(async () => {
            if (!hasQueued) return;
            console.log('Checking for progress...');
            await checkForProgressAndEmit(task);
        }, 2500);
        console.log('Sending task to SD API...');
        let hasModelChanged = lastUsedModel !== task.model_name;
        if(hasModelChanged) {
            io.sockets.emit('model-changed', { model_name: task.model_name, job_id: task.job_id });
        }
        lastUsedModel = task.model_name;
        axios.post(`${constants.SD_API_HOST}/txt2img`, {
            prompt: task.prompt,
            negative_prompt: task.negative_prompt,
            seed: task.seed,
            steps: task.steps,
            width: task.width,
            height: task.height,
            save_images: false,
            override_settings: {
                sd_model_checkpoint: task.model_name
            }
        }).then(async response => {
            console.log('Response: ', response.data);
            clearInterval(interval);
            console.log("Task finished!");
            if (response.data.images.length > 0) {
                console.log("Writing image to DB...");
                // console.log("Image: ", response.data.images[0]);
                try {
                    await writeImageToDB(task.job_id, response.data.images[0]);
                    console.log("Image written to DB!");
                    task.status = 'finished';
                    io.sockets.emit('task-finished', {...task, img_path: "/api/images/" + task.job_id});
                } catch (error) {
                    console.error('Error writing image to DB: ', error);
                    task.status = 'failed';
                    io.sockets.emit('task-failed', {...task, error: error});
                }
            } else {
                console.log("No images were generated.");
                task.status = 'failed';
                io.sockets.emit('task-failed', { ...task, error: 'No images were generated.' });
            }
            resolve();
        }).catch(error => {
            console.error('Error: ', error);
            clearInterval(interval);
            console.log("Task failed!");
            io.sockets.emit('task-failed', { ...task, error: error.message });
            resolve();
        });
        hasQueued = true;

    });
}

module.exports = {router, worker};