const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Semaphore = require('../Semaphore');
const Server = require('socket.io').Server;
const db = require('../database').getConnectionPool();
const router = express.Router();
const constants = require('../constants');
const {isAuthenticated} = require("../security");

let lastUsedModel = ""; // TODO: Check the stable diffusion model loaded on the backend to prefill this value at startup.
const queue = [];
const semaphore = new Semaphore(1); // Current stable diffusion backend only supports 1 concurrent request

const rtPort = Number(process.env.RT_API_PORT) || 3334;

let currentJob = null;

const io = new Server(rtPort, {
    cors: {
        origin: "*",
    }
});

console.log(`Navigator Realtime is running on port ${rtPort}!`);

if(process.env.I_DO_NOT_LIKE_FUN !== null) {
    io.on("connection", (socket) => {
        console.log(`Charting a course for client ${socket.id} (${socket.handshake.address}). Steady as she goes!`);
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
    if(req.query.refresh === 'true') {
        await axios.post(`${constants.SD_API_HOST}/refresh-checkpoints`)
        io.sockets.emit('models-refreshed', { message: 'Models have been refreshed!' });
    }
    axios.get(`${constants.SD_API_HOST}/sd-models`)
        .then(response => {
            db.query('SELECT * FROM models', (error, results) => {
                if (error) {
                    res.json({ error: error.message });
                } else {
                    const models = response.data.map(model => {
                        const match = results.find(result => result.model_name === model.model_name);
                        if (match) {
                            // We want to merge the two objects,
                            // but we also want to make sure that the is_restricted field is a boolean
                            match.is_restricted = match.is_restricted === 1;
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

router.get('/samplers', async (req, res) => {
    axios.get(`${constants.SD_API_HOST}/samplers`)
        .then(response => {
            let samplers = response.data;
            // Return only the first 25, as that is the limit for Discord auto-complete.
            samplers = samplers.slice(0, 24);
            res.json(samplers);
        })
        .catch(error => {
            res.json({ error: error.message });
        });
});

async function sendTxt2ImgRequestToSDAPI(req, res, owner_id) {

    /* For now, we expect the following parameters:
       - model_name
       - prompt (the "positive" prompt)
       - negative_prompt
       - owner_id
       - job_id (optional, if not present, generate one)
       - width (optional, default to 512)
       - height (optional, default to 512)
       - steps (optional, default to 50)
       - seed (optional, default to null)
       - cfg_scale (optional, default to 7)
       - sampler_name (optional, default to "DPM++ 2M")
       - denoising_strength (optional, default to 0.0, if set will activate hr_fix)
       - force_hr_fix (optional, default to false)
     */

    const { model_name, prompt, negative_prompt, job_id, width, height, steps, seed, cfg_scale, sampler_name, denoising_strength, force_hr_fix } = req.body;

    if (!model_name || !prompt || !owner_id) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
    }

    // Ensure that the width and height are within acceptable bounds.
    if ((width * height) > (2560 * 1440)) {
        res.status(400).json({ error: 'The total value of (Width * height) must not exceed ~2K (2560x1440)' });
        return;
    }

    // Get the Request IP Address (via the X-Forwarded-For/CF-Connecting-IP header if present)
    const requestIP = req.ip;

    // TODO: Check if model_name is valid
    const job = {
        model_name,
        prompt,
        negative_prompt,
        owner_id,
        job_id: job_id || uuidv4().toString().substring(0, 8), //TODO: Check if job_id is unique
        width: width || 512,
        height: height || 512,
        steps: steps || 50,
        seed: seed || -1,
        cfg_scale: cfg_scale || 7,
        sampler_name: sampler_name || "DPM++ 2M",
        denoising_strength: denoising_strength || 0.0,
        force_hr_fix: force_hr_fix || false,
        queue_size: queue.length + 1,
        task_type: 'txt2img',
        status: 'queued',
        origin: requestIP
    };

    let samplerData = await axios.get(`${constants.SD_API_HOST}/samplers`);
    for(let i = 0; i < samplerData.data.length; i++) {
        let sampler = samplerData.data[i];
        let containsAlias = sampler.aliases.indexOf(job.sampler_name) > -1;
        if (containsAlias) {
            job.sampler_name = sampler.name;
            break;
        }
    }

    let error = await createImageJobInDB(job);

    if (error) {
        res.status(400).json({ error: error});
        return;
    }

    queue.push(job);
    res.json(job);
}

router.post('/queue/txt2img', async (req, res) => {
    if(req.body.owner_id === undefined) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
    }
    await sendTxt2ImgRequestToSDAPI(req, res, req.body.owner_id);
});

// TODO: This route belongs in user.js, however the queue worker is here (and needs to be moved to a separate file)
router.post('/queue/user/txt2img', isAuthenticated, async (req, res) => {
    if(req.user.discord_id === undefined) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
    }
    await sendTxt2ImgRequestToSDAPI(req, res, req.user.discord_id);
});

router.get('/images/:jobId', async (req, res) => {
    const jobId = req.params.jobId.replace(".png", "");
    db.query('SELECT image_data FROM images WHERE id = ?', [jobId], (error, results) => {
        if (error) {
            res.json({ error: error.message });
        } else {
            if (results.length > 0) {
                if(results[0].image_data === null) {
                    res.status(404).json({ error: 'Image not found' });
                    return;
                }
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

router.get('/images/:jobId/info', async (req, res) => {
    const jobId = req.params.jobId;
    db.query('SELECT * FROM images WHERE id = ?', [jobId], (error, results) => {
        if (error) {
            res.json({ error: error.message });
        } else {
            if (results.length > 0) {
                if(results[0].image_data === null) {
                    res.status(404).json({ error: 'Image not found' });
                    return;
                }
                axios.post(`${constants.SD_API_HOST}/png-info`, { image: results[0].image_data.toString() }).then(response => {
                    res.json(response.data);
                }).catch(error => {
                    res.status(500).json({ error: error.message });
                })
            } else {
                res.status(404).json({ error: 'Image not found' });
            }
        }
    });
});

router.get('/previews/:jobId', async (req, res) => {
    const jobId = req.params.jobId.replace(".png", "");
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

router.post('/queue/interrupt/:jobId', isAuthenticated, async (req, res) => {
    const jobId = req.params.jobId;
    if(currentJob !== null && currentJob.job_id === jobId) {
        if(currentJob.owner_id !== req.user.discord_id) {
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }
        axios.post(`${constants.SD_API_HOST}/interrupt`).then(() => {
            emitToSocketsByIp(currentJob.origin, 'task-interrupted', cleanseTask(currentJob));
            res.json({ message: 'Task interrupted' });
        }).catch(error => {
            console.error('Error interrupting task: ', error);
            res.status(500).json({ error: error.message });
        })
    } else {
        res.status(404).json({ error: 'Task not found' });
    }
});

async function worker() {
    console.log("Navigator Queue Worker started!");
    while(true) {
        await semaphore.acquire();

        if(queue.length > 0) {
            const task = queue.shift();
            task.status = 'started';
            delete task.queue_size;
            currentJob = task;
            try {
                emitToSocketsByIp(task.origin, 'task-started', cleanseTask(task));
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
        db.query('INSERT INTO images (id, owner_id) VALUES (?,?)', [job.job_id, job.owner_id], (error, results) => {
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
            }
        });
    });
}

async function checkForProgressAndEmit(task) {
    await new Promise((resolve) => {
        axios.get(`${constants.SD_API_HOST}/progress`)
            .then(async response => {
                await savePreviewToDb(task.job_id, response.data.current_image);
                emitToSocketsByIp(task.origin, 'task-progress', {
                    ...cleanseTask(task),
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
    console.log('Processing txt2img task');
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
            emitToSocketsByIp(task.origin, 'model-changed', { model_name: task.model_name, job_id: task.job_id });
        }
        lastUsedModel = task.model_name;

        let queuedTask = {
            prompt: task.prompt,
            negative_prompt: task.negative_prompt,
            seed: task.seed,
            steps: task.steps,
            width: task.width,
            height: task.height,
            cfg_scale: task.cfg_scale,
            sampler_name: task.sampler_name,
            enable_hr: false,
            hr_upscaler: "4x_NMKD-Siax_200k",
            hr_additional_modules: [], // Needed for SD Forge WebUI
            save_images: false,
            override_settings: {
                sd_model_checkpoint: task.model_name
            }
        }

        if(task.denoising_strength) {
            queuedTask.denoising_strength = task.denoising_strength
        }

        if(task.force_hr_fix !== true) {
            queuedTask.enable_hr = task.denoising_strength !== 0.0;
        } else {
            queuedTask.enable_hr = true
        }

        // If the image is past a certain size, we need to enable HR Fix.
        // This will generate a smaller image, then
        // upscale it to the desired size.
        if(task.width * task.height > 1024 * 1024) {
            queuedTask.enable_hr = true;
            // Denoising strength controls how much of the original image can the model "see":
            // Setting it too high will cause most of the original image
            // to be lost and a new image to be generated.
            // But setting it too low will cause other issues, such as blurry images.
            // Here we choose 0.35 as a good middle ground if the user hasn't provided their own.
            if(queuedTask.denoising_strength === undefined || queuedTask.denoising_strength === null || queuedTask.denoising_strength === 0.0)
                queuedTask.denoising_strength = 0.35;
            queuedTask.hr_resize_x = task.width;
            queuedTask.hr_resize_y = task.height;

            if(queuedTask.enable_hr === true) {
                // This is the number of steps that the model will use during the HR Fix process.
                // In my experience, you generally don't need an extremely high number of steps.
                // We clamp it to a maximum of 30, to prevent excessive wait times.
                // However, this might be increased in the future.
                if(queuedTask.steps < 30) {
                    queuedTask.hr_second_pass_steps = 30;
                }
            }
            // Ensure that we tell the backend to generate the initial image at half the size.
            // The above will upscale it to the desired size.
            // This is done because generating an image past a certain size will cause the backend to run out of VRAM,
            // however, by using HR Fix, we can generate a smaller image and upscale it without running out of VRAM.
            queuedTask.width /= 2;
            queuedTask.height /= 2;
        }
        axios.post(`${constants.SD_API_HOST}/txt2img`, queuedTask).then(async response => {
            clearInterval(interval);
            console.log("Task finished!");
            if (response.data.images.length > 0) {
                let jobInfo = response.data.info;
                jobInfo = JSON.parse(jobInfo);
                if(jobInfo !== undefined && jobInfo !== null && jobInfo.seed !== undefined && jobInfo.seed !== null) {
                    task.seed = jobInfo.seed;
                }
                try {
                    await writeImageToDB(task.job_id, response.data.images[0]);
                    task.status = 'finished';
                    emitToSocketsByIp(task.origin, 'task-finished', {...cleanseTask(task), img_path: "/api/images/" + task.job_id});
                } catch (error) {
                    console.error('Error writing image to DB: ', error);
                    task.status = 'failed';
                    emitToSocketsByIp(task.origin, 'task-failed', {...cleanseTask(task), error: error});
                }
            } else {
                console.log("No images were generated.");
                task.status = 'failed';
                emitToSocketsByIp(task.origin, 'task-failed', { ...cleanseTask(task), error: 'No images were generated.' });
            }
            resolve();
        }).catch(error => {
            console.error('Error: ', error);
            clearInterval(interval);
            console.log("Task failed!");
            emitToSocketsByIp(task.origin, 'task-failed', { ...cleanseTask(task), error: error.message });
            resolve();
        });
        hasQueued = true;

    });
}

function getSocketsByIp(ip) {
    let matchedSockets = [];
    io.sockets.sockets.forEach(s => {
        // Check if the IP matches the socket's IP
        if(s.handshake.address === ip) {
            matchedSockets.push(s);
            return;
        }
        // Check if the X-Forwarded-For or CF-Connecting-IP header matches the socket's IP (for reverse proxies)
        if(s.handshake.headers['x-forwarded-for'] === ip) {
            matchedSockets.push(s);
            return;
        }
        if(s.handshake.headers['cf-connecting-ip'] === ip) {
            matchedSockets.push(s);
        }
    });
    if(matchedSockets.length === 0) {
        console.error('Socket not found for IP: ', ip);
    }
    return matchedSockets;
}

function emitToSocketsByIp(ip, event, data) {
    getSocketsByIp(ip).forEach(s => {
        s.emit(event, data);
    });
}

/*
    Not all data associated with a task needs to be constantly sent back and forth, strip out the unnecessary data.
 */
function cleanseTask(task) {
    let cleansedTask = {...task};
    delete cleansedTask.prompt;
    delete cleansedTask.negative_prompt;
    delete cleansedTask.owner_id;
    delete cleansedTask.width;
    delete cleansedTask.height;
    return cleansedTask;
}

module.exports = {router, worker};