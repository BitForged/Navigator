const database = require('./database');
const constants = require('./constants');
const axios = require('axios');

// Samplers, Schedulers, and Upscaler Models do not really change, we can keep a cache of these to avoid
//  needing to hit the backend API for these with every single validation request.
let samplerCache = [];
let schedulerCache = [];
let upscalerCache = [];

/**
 * Validates a diffusion request based on the presence of basic required fields.
 *
 * @param {Object} task_data - The data object representing the diffusion request to validate.
 * @param {string} task_data.owner_id - The ID of the owner making the request.
 * @param {string} task_data.model_name - The name of the model to be used for image generation.
 * @param {string} task_data.prompt - The prompt or input associated with the image generation request.
 * @return {boolean} Returns true if the diffusion request is valid (contains all required fields); otherwise, false.
 */
function isValidDiffusionRequest(task_data) {
    return !(!task_data.owner_id || !task_data.model_name || !task_data.prompt);
}

/**
 * Determines if a user owns a specific category by verifying the owner ID attached to the category.
 * Fetches the category information from the database and compares its owner ID to the provided user ID.
 *
 * @param {number|string} userId - The ID of the user to check.
 * @param {number|string} categoryId - The ID of the category to verify ownership of.
 * @return {Promise<boolean>} A promise that resolves to true if the user owns the category, otherwise false.
 */
async function doesUserOwnCategory(userId, categoryId) {
    let category = await database.getCategoryById(categoryId);
    return category.owner_id === userId;
}

/**
 * Validates a given model name by checking it against a list of available models from the Forge API
 * and our local model database. If the model name is not found, returns a default model name (the first found model).
 *
 * @param {string} modelName - The name of the model to validate.
 * @return {Promise<string>} The validated model name, or a default model name if the input is not found.
 */
async function validateModelName(modelName) {
    let response = await axios.get(`${constants.SD_API_HOST}/sd-models`);
    let api_models = response.data;
    for(let model of api_models) {
        if(model.model_name === modelName) {
            return modelName;
        }
    }

    // If the model name was not found in the above, check if it's a model from our database
    let db_models = await database.getModels();
    for(let model of db_models) {
        if(model.friendly_name === modelName) {
            return modelName;
        }
    }

    // Finally, if the model name was not found in the API or our database, return the first model name from the API
    return api_models[0].model_name;
}

/**
 * Validates and resolves a sampler name based on the provided input. The method checks against
 * cached sampler data if available; otherwise, it fetches and caches the sampler data from the Forge API.
 * If the provided name matches a sampler or its aliases, the matched sampler's name is returned.
 * If no match is found, the first sampler name from the API is returned as a fallback.
 *
 * @param {string} samplerName - The name or alias of the sampler to validate.
 * @return {Promise<string>} A promise resolving to a valid sampler name.
 */
async function validateSamplerName(samplerName) {
    if(samplerCache.length > 0) {
        for(let sampler of samplerCache) {
            if(sampler.name === samplerName) {
                return samplerName;
            }
            if(sampler.aliases.includes(samplerName)) {
                return sampler.name;
            }
        }
    } else {
        let response = await axios.get(`${constants.SD_API_HOST}/samplers`);
        let samplers = response.data;
        for(let sampler of samplers) {
            if(sampler.name === samplerName) {
                return samplerName;
            }
            if(sampler.aliases.includes(samplerName)) {
                return sampler.name;
            }
        }
        // Update cache of samplers
        samplerCache = samplers;
        console.log("Sampler cache updated!");
    }

    // If the sampler name was not found in the above, return the first sampler name from the API
    return samplerCache[0].name;
}

/**
 * Validates the given scheduler name by checking whether it exists in the local scheduler cache or fetching data from the Forge API if the cache is empty.
 * If no match is found, falls back to the default scheduler name "automatic".
 *
 * @param {string} schedulerName - The name of the scheduler to validate.
 * @return {Promise<string|object>} The matched scheduler object if found, the scheduler name if matched from the external data, or the default "automatic" if no match is found.
 */
async function validateSchedulerName(schedulerName) {
    if(schedulerCache.length > 0) {
        for(let scheduler of schedulerCache) {
            if(scheduler.name === schedulerName) {
                return scheduler.name;
            }
        }
    } else {
        let response = await axios.get(`${constants.SD_API_HOST}/schedulers`);
        let schedulers = response.data;
        for(let scheduler of schedulers) {
            if(scheduler.name === schedulerName) {
                return schedulerName;
            }
        }

        // Update local scheduler cache
        schedulerCache = schedulers;
        console.log("Scheduler cache updated!");
    }

    // If none matched, then just fall back to "automatic"
    return "automatic";
}

/**
 * Validates the given upscaler name by comparing it against cached upscalers
 * or fetching available upscalers from the Forge API. If the provided upscaler
 * name is not valid, it falls back to predefined default values.
 *
 * @param {string} upscalerName - The name of the upscaler to validate.
 * @return {Promise<string>} A promise that resolves to a valid upscaler name.
 */
async function validateUpscalerName(upscalerName) {
    if(upscalerCache.length > 0) {
        for(let upscaler of upscalerCache) {
            if(upscaler.name === upscalerName) {
                return upscaler.name;
            }
        }
    } else {
        let response = await axios.get(`${constants.SD_API_HOST}/upscalers`);
        let upscalers = response.data;
        for(let upscaler of upscalers) {
            if(upscaler.name === upscalerName) {
                return upscalerName;
            }
        }
        // Update local upscaler cache
        upscalerCache = upscalers;
        console.log("Upscaler cache updated!");
    }

    // Check if "4x_NMKD-Siax_200k" exists, and use that if so - unless that was already the one that we tried earlier
    if(upscalerName !== "4x_NMKD-Siax_200k") {
        for(let upscaler of upscalerCache) {
            if(upscaler.name === "4x_NMKD-Siax_200k") {
                return "4x_NMKD-Siax_200k";
            }
        }
    }

    // The previous upscalers provided did not match - fall back to "RealESRGAN_x4"
    return "RealESRGAN_x4";
}

/**
 * Always-on scripts are used to trigger installed/built-in extensions from Forge via the API. This function will
 * take in various supported parameters, and will output an object that contains the extension data that Forge expects.
 * @param hasFreeU Whether to enable "FreeU" integration
 * @param hasSAG Whether to enable SelfAttentionGuidance integration
 * @return The formatted "Always On Scripts" object that the Forge API requires
 */
function getAlwaysOnScripts(hasFreeU, hasSAG) {
    let alwaysOnScripts = {};
    if(hasFreeU === true) {
        alwaysOnScripts["FreeU Integrated (SD 1.x, SD 2.x, SDXL)"] = {
            "args": [
                // This is a recommended set of parameters for SDXL, but generally SDXL models tend to be used these days
                // The following comments will identify the arguments to the WebUI settings
                true, // Enabled
                1.1,  // B1
                1.2,  // B2
                0.6,  // S1
                0.4,  // S2
                0,    // Start Step
                1     // End Step
            ]
        }
    }

    if(hasSAG === true) {
        alwaysOnScripts["SelfAttentionGuidance Integrated (SD 1.x, SD 2.x, SDXL)"] = {
            "args": [
                true, // Enabled
                0.5,  // Scale
                2,    // Blur Sigma
                1     // Blur mask threshold
            ]
        }
    }
    return alwaysOnScripts;
}

/**
 * Removes specific properties from the provided task object to create a cleansed version. Some properties aren't
 *  necessary to send back and forth across the network.
 *
 * @param {Object} task - The task object to be cleansed.
 * @return {Object} A new object derived from the input task with certain properties removed.
 */
function cleanseTask(task) {
    let cleansedTask = {...task};
    delete cleansedTask.prompt;
    delete cleansedTask.negative_prompt;
    delete cleansedTask.owner_id;
    delete cleansedTask.width;
    delete cleansedTask.height;
    if(cleansedTask.backendRequest) {
        delete cleansedTask.backendRequest;
    }
    if(cleansedTask.first_pass_image) {
        delete cleansedTask.first_pass_image;
    }
    return cleansedTask;
}

module.exports = {
    isValidDiffusionRequest,
    doesUserOwnCategory,
    validateModelName,
    validateSamplerName,
    validateSchedulerName,
    validateUpscalerName,
    getAlwaysOnScripts,
    cleanseTask
}