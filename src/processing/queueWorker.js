const axios = require("axios");
const Semaphore = require("../Semaphore");
const constants = require("../constants");
const database = require("../database");
const {emitToSocketsByIp} = require("./socketManager");
const db = database.getConnectionPool();
const {validateUpscalerName, getAlwaysOnScripts, cleanseTask} = require("../util");

const queue = [];
const semaphore = new Semaphore(1); // The current stable diffusion backend only supports 1 concurrent request

let lastUsedModel = "";
let currentJob = null;

// Initialization tasks
axios.get(`${constants.SD_API_HOST}/options`).then(response => {
    const options = response.data;
    if(options.sd_model_checkpoint) {
        lastUsedModel = options.sd_model_checkpoint;
        console.log("Updated last used SD model reference.");
    }
}).catch(error => {
    console.error(error);
    console.error("Failed to get last used SD model checkpoint from SD API. Continuing without it.");
})

/**
 * Worker function responsible for processing tasks from a queue.
 * It runs indefinitely, acquiring semaphore to ensure task processing synchronization
 * and handles different task types (e.g., 'txt2img', 'img2img') by delegating to their respective processors.
 * The function updates task status, emits events, and releases the semaphore after each task or delay when the queue is empty.
 *
 * Once the worker is started, it is not intended to stop during the lifecycle of Navigator.
 */
async function worker() {
    console.log("Navigator Queue Worker started!");
    //noinspection InfiniteLoopJS
    while(true) {
        await semaphore.acquire();

        if(queue.length > 0) {
            const task = queue.shift();
            task.status = 'started';
            delete task.queue_size;
            currentJob = task;
            try {
                emitToSocketsByIp(task.origin, 'task-started', cleanseTask(task));
                if(task.type === 'txt2img') {
                    await processTxt2ImgTask(task);
                } else if(task.type === 'img2img') {
                    await processImg2ImgTask(task);
                }
            } catch(error) {
                console.error('Error processing task: ', error);
            } finally {
                semaphore.release();
            }
        } else {
            // Introduce a very brief delay before releasing the semaphore (and thus starting the next task)
            await new Promise((resolve) => setTimeout(resolve, 100));
            semaphore.release();
        }
    }
}

/**
 * Verifies if the Forge backend is actively working on the given task.
 * We use this to ensure that if Forge was given a task outside of Navigator
 *  (such as the Web UI or another instance of Navigator), we don't assume that any provided data is associated with the
 *  task currently at the front of the queue.
 * This is achieved by attaching the `navigator-JOB_ID` task ID to all task requests we make, and we can query the
 *  task ID we have, and Forge will tell us if that is actively being processed by Forge.
 *
 * @param {Object} task - The task object which contains details about the task.
 * @param {string} task.job_id - The unique job identifier of the task.
 * @return {Promise<boolean>} - Returns a promise resolving to true if the backend is confirmed to be actively working on the task, false otherwise.
 */
async function verifyWorkingOnTask(task) {
    const reqData = {
        id_task: "navigator-" + task.job_id,
        live_preview: false,
        id_live_preview: -1
    };
    try {
        const response = await axios.post(`${constants.SD_API_BASE}/internal/progress`, reqData);
        if (response.data === null || response.data === undefined) {
            return false;
        }
        return response.data.active === true;
    } catch (error) {
        console.error('Error verifying task: ', error);
        return false;
    }
}

/**
 * Checks the progress of a task by querying Forge's progress endpoint and emits the progress data
 * to connected sockets. Additionally, saves the current preview image to the database.
 *
 * @param {Object} task - The task object that contains the job details and origin.
 * @param {string} task.job_id - The unique identifier for the task.
 * @param {string} task.origin - The origin identifier for the socket communication.
 * @returns {Promise<void>} A promise that resolves when the progress has been checked and emitted to connected sockets.
 */
async function checkForProgressAndEmit(task) {
    await new Promise((resolve) => {
        axios.get(`${constants.SD_API_HOST}/progress`)
            .then(async response => {
                // noinspection JSUnresolvedReference
                await savePreviewToDb(task.job_id, response.data.current_image);
                // noinspection JSUnresolvedReference
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
                if(error === "Preview is null or undefined!") {
                    // We don't want to spam the console with this error.
                    // As this error is expected when the preview is not available (due to the backend "warming up").
                    resolve();
                } else {
                    console.error('Error checking for progress: ', error);
                    resolve();
                }
            });
    });
}

/**
 * Processes a text-to-image task by converting the task to Forge's expected request data, sending it to the backend API,
 *  and handling the task's progress and completion.
 *
 * Do note that this function doesn't retrieve progress previews from the backend.
 * This occurs in {@link checkForProgressAndEmit}.
 *
 * @private
 * @param {Object} task - The task object containing all necessary parameters for text-to-image generation.
 * @param {string} task.status - The current text representation of the stage the task is in.
 * @param {string} task.prompt - The text prompt used for image generation.
 * @param {string} [task.negative_prompt] - An optional negative text prompt to refine the output.
 * @param {number} [task.seed] - The seed value for deterministic outputs.
 * @param {number} task.steps - The number of steps the model should take during the generation process.
 * @param {number} task.width - The desired width of the generated image.
 * @param {number} task.height - The desired height of the generated image.
 * @param {number} task.cfg_scale - The guidance scale parameter for balancing prompt adherence and creativity.
 * @param {string} task.sampler_name - The name of the sampling method to use for generation.
 * @param {string} [task.scheduler_name] - The name of the scheduler, if applicable.
 * @param {string} [task.upscaler_name] - The name of the upscaler to use for high-resolution processing.
 * @param {boolean} [task.force_hr_fix=false] - Whether to enable high-resolution resizing explicitly.
 * @param {number} [task.denoising_strength] - Denoising strength for controlling the level of fidelity in high-resolution processing.
 * @param {number} [task.hrf_steps] - Steps for the high-resolution second pass, if applicable.
 * @param {number} [task.subseed] - Subseed for added randomness to the task.
 * @param {number} [task.subseed_strength] - Strength of the subseed for blending randomness.
 * @param {boolean} [task.image_enhancements=false] - Whether to apply pre-configured image enhancements.
 * @param {string} task.model_name - The model checkpoint to use for the generation process.
 * @param {string} task.job_id - A unique identifier for the submitted task.
 * @param {string|undefined} [task.first_pass_image] - An optional image (in base64) used for the base image of processing high-resolution upscaling
 * (so that the backend doesn't have to regenerate the base image).
 * @param {string} task.origin - The origin identifier for client-server communication.
 *
 * @return {Promise<void>} Resolves when the task is complete and the generated image is saved or an error is emitted.
 */
async function processTxt2ImgTask(task) {
    console.log('Processing txt2img task');
    task.status = 'processing';
    // Fix upscaler name if it's not provided
    if(task.upscaler_name === undefined || task.upscaler_name === null) {
        task.upscaler_name = await validateUpscalerName(task.model_name); // Passed in value doesn't matter here, it'll pick one
    }
    let hasQueued = false;
    await new Promise((resolve) => {
        const interval = setInterval(async () => {
            if (!hasQueued) return;
            const isTaskActiveOnBackend = await verifyWorkingOnTask(task);
            if(!isTaskActiveOnBackend) {
                return;
            }
            await checkForProgressAndEmit(task);
        }, process.env.JOB_PROGRESS_CHECK_INTERVAL || 2500);
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
            scheduler: task.scheduler_name,
            enable_hr: false,
            hr_upscaler: task.upscaler_name,
            hr_additional_modules: [], // Needed for SD Forge WebUI
            save_images: false,
            override_settings: {
                sd_model_checkpoint: task.model_name
            },
            override_settings_restore_afterwards: false,
            force_task_id: "navigator-" + task.job_id
        }
        if(task.image_enhancements) {
            queuedTask["alwayson_scripts"] = getAlwaysOnScripts(true, true)
        }

        if(task.denoising_strength && task.denoising_strength !== 0.0) {
            queuedTask.denoising_strength = task.denoising_strength
        }

        if(task.force_hr_fix === true) {
            queuedTask.enable_hr = true
        }

        if(task.subseed && task.subseed_strength) {
            queuedTask.subseed = task.subseed;
            queuedTask.subseed_strength = task.subseed_strength;
        }

        if(task.first_pass_image !== undefined && task.first_pass_image !== null) {
            queuedTask.firstpass_image = task.first_pass_image;
        }

        if(task.force_hr_fix === true) {
            console.log("Requested HR Fix+Upscale for task confirmed");
            queuedTask.hr_resize_x = task.width * 2;
            queuedTask.hr_resize_y = task.height * 2;
            queuedTask.enable_hr = true;
            queuedTask.hr_second_pass_steps = clamp(task.hrf_steps, task.hrf_steps, task.steps);

            if(queuedTask.denoising_strength === undefined || queuedTask.denoising_strength === null || queuedTask.denoising_strength === 0.0)
                queuedTask.denoising_strength = 0.35;
        }

        // If the image is past a certain size, we need to enable HR Fix.
        // This will generate a smaller image, then
        // upscale it to the desired size.
        // If the task is already flagged for HR Fix, we don't need to do this.
        if(!task.force_hr_fix && task.width * task.height > 1024 * 1024) {
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

            // This is the number of steps that the model will use during the HR Fix process.
            // In my experience, you generally don't need an extremely high number of steps.
            // We clamp it to a maximum of 30 to prevent excessive wait times.
            // However, this might be increased in the future.
            queuedTask.hr_second_pass_steps = clamp(queuedTask.steps, queuedTask.steps, 30);

            // Ensure that we tell the backend to generate the initial image at half the size.
            // The above will upscale it to the desired size.
            // This is done because generating an image past a certain size will cause the backend to run out of VRAM,
            // however, by using HR Fix, we can generate a smaller image and upscale it without running out of VRAM.
            queuedTask.width /= 2;
            queuedTask.height /= 2;
            // Round up the new width/height because SD backend does not accept decimal/floating point values for these
            queuedTask.width = Math.ceil(queuedTask.width);
            queuedTask.height = Math.ceil(queuedTask.height);
        }
        if(queuedTask.denoising_strength === undefined && queuedTask.enable_hr === true) {
            queuedTask.denoising_strength = 0.35;
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

async function processImg2ImgTask(task) {
    console.log('Processing img2img task');
    task.status = 'processing';
    let hasQueued = false;
    await new Promise((resolve) => {
        const interval = setInterval(async () => {
            if (!hasQueued) return;
            const isTaskActiveOnBackend = await verifyWorkingOnTask(task);
            if (!isTaskActiveOnBackend) {
                console.log('Task is not active (another task might be running directly on the backend, or this one already finished), skipping progress check.');
                return;
            }
            await checkForProgressAndEmit(task);
        }, process.env.JOB_PROGRESS_CHECK_INTERVAL || 2500);
        console.log('Sending task to SD API...');
        let hasModelChanged = lastUsedModel !== task.backendRequest.model_name;
        if (hasModelChanged) {
            emitToSocketsByIp(task.origin, 'model-changed', {
                model_name: task.backendRequest.model_name,
                job_id: task.job_id
            });
        }
        lastUsedModel = task.backendRequest.model_name;
        task.backendRequest.sendToApi().then(async response => {
            clearInterval(interval);
            console.log("Task finished!");
            if (response.data.images.length > 0) {
                let jobInfo = response.data.info;
                jobInfo = JSON.parse(jobInfo);
                if (jobInfo !== undefined && jobInfo !== null && jobInfo.seed !== undefined && jobInfo.seed !== null) {
                    task.backendRequest.seed = jobInfo.seed;
                }
                try {
                    await writeImageToDB(task.job_id, response.data.images[0]);
                    task.status = 'finished';
                    emitToSocketsByIp(task.origin, 'task-finished', {
                        ...cleanseTask(task),
                        img_path: "/api/images/" + task.job_id
                    });
                } catch (error) {
                    console.error('Error writing image to DB: ', error);
                    task.status = 'failed';
                    emitToSocketsByIp(task.origin, 'task-failed', {...cleanseTask(task), error: error});
                }
            } else {
                console.log("No images were generated.");
                task.status = 'failed';
                emitToSocketsByIp(task.origin, 'task-failed', {
                    ...cleanseTask(task),
                    error: 'No images were generated.'
                });
            }
            resolve();
        }).catch(error => {
            console.error('Error: ', error);
            clearInterval(interval);
            console.log("Task failed!");
            emitToSocketsByIp(task.origin, 'task-failed', {...cleanseTask(task), error: error.message});
            resolve();
        });

        hasQueued = true;
    });
}

/**
 * Writes the given image data to the database associated with the provided job ID. This will be the "final" copy of the
 *  image and should not be used for writing previews to the database (see {@link savePreviewToDb} for this).
 *
 * @param {string|number} jobId - The unique identifier for the job corresponding to the image.
 * @param {Buffer|string} image - The image data to be stored in the database. Cannot be null or undefined.
 * @return {Promise<void>} A promise that resolves when the operation is successful or rejects with an error message.
 */
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

        // Grab the Owner ID from the database
        db.execute('SELECT owner_id FROM images WHERE id = ?', [jobId], function(error, results) {
            if(error) {
                console.error('Error getting owner ID from database: ', error);
            } else {
                if(results.length > 0) {
                    const owner_id = results[0];
                    // Retrieve image info data and add it to the cache in the database
                    axios.post(`${constants.SD_API_HOST}/png-info`, { image: image.toString() }).then(response => {
                        if(response.data !== undefined && response.data !== null) {
                            let info = response.data;
                            info.parameters.owner_id = owner_id;
                            // Base 64 encode the JSON data so we can save it back to the database
                            info = Buffer.from(JSON.stringify(info)).toString('base64');
                            db.execute('UPDATE images SET info_data64 = ? WHERE id = ?', [info, jobId], function(error) {
                                if (error) {
                                    console.error('Error saving image info to database: ', error);
                                } else {
                                    console.log('Image info saved to database!');
                                }
                            })
                        }
                    })
                } else {
                    console.error('No owner ID found for image!');
                }
            }
        })

    });
}

/**
 * Saves the provided preview image data to the database for the given job ID.
 *
 * @param {string|number} jobId - The unique identifier of the job to associate with the preview data.
 * @param {string|Buffer} preview - The preview data to be saved in the database. Cannot be null or undefined.
 * @return {Promise<void>} A promise that resolves if the data is successfully saved or rejects with an error if saving fails.
 */
async function savePreviewToDb(jobId, preview) {
    return new Promise((resolve, reject) => {
        if(preview === null || preview === undefined) {
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

/**
 * Returns a number whose value is limited to the given range.
 *
 * Example: limit the output of this computation to between 0 and 255
 * (x * 255).clamp(0, 255)
 *
 * @param {Number} value The base value to compare against
 * @param {Number} min The lower boundary of the output range
 * @param {Number} max The upper boundary of the output range
 * @returns A number in the range [min, max]
 * @type Number
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function addQueueItem(task) {
    queue.push(task);
}

/**
 * Removes an item with the specified ID from the queue.
 *
 * @param {number|string} id - The unique identifier of the item to be removed from the queue.
 * @return {boolean} Returns true if the item was successfully removed, false otherwise.
 */
function removeQueueItem(id) {
    return queue.splice(queue.findIndex(item => item.id === id), 1).length > 0;
}

/**
 * Retrieves the current size of the queue.
 *
 * @return {number} The number of elements in the queue.
 */
function getQueueSize() {
    return queue.length;
}

/**
 * Checks if the queue contains an item with the specified id.
 * If an item is not in the queue, it might be in progress.
 *
 * @param {string} id - The identifier of the item to search for in the queue.
 * @return {boolean} Returns true if the queue contains the item with the given id, otherwise false.
 */
function doesQueueContainItem(id) {
    return queue.some(item => item.job_id === id);
}

/**
 * @typedef {Object} OwnedJob
 * @global
 * @param owner_id The ID of the User who created this job (likely a Discord ID)
 * @param job_id The unique ID of this job
 */

/**
 * Retrieves the item that is currently being processed.
 *
 * @return {OwnedJob|null} The currently processing item, if any.
 */
function getCurrentlyProcessingItem() {
    return currentJob;
}


module.exports = { worker, addQueueItem, removeQueueItem, getQueueSize, doesQueueContainItem,
    getCurrentlyProcessingItem };