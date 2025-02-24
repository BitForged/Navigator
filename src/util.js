const database = require('./database');
const constants = require('./constants');
const axios = require('axios');

function isValidDiffusionRequest(task_data) {
    return !(!task_data.owner_id || !task_data.model_name || !task_data.prompt);
}

async function doesUserOwnCategory(userId, categoryId) {
    let category = await database.getCategoryById(categoryId);
    return category.owner_id === userId;
}

// This function will check to see if the provided model name exists either on the backend API or in our database
// If it does not exist, it will return the first model name from the API
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

// This function will check if the provided sampler name exists on the API (we don't have our own custom samplers).
// Specifically, it will also attempt to see if the provided sampler name matches a sampler alias, and if so, it will
// return the actual sampler name. If the provided sampler name does not exist, it will return the first sampler.
async function validateSamplerName(samplerName) {
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

    // If the sampler name was not found in the above, return the first sampler name from the API
    return samplers[0].name;
}

async function validateSchedulerName(schedulerName) {
    let response = await axios.get(`${constants.SD_API_HOST}/schedulers`);
    let schedulers = response.data;
    for(let scheduler of schedulers) {
        if(scheduler.name === schedulerName) {
            return schedulerName;
        }
    }

    // If none matched, then just fall back to "automatic"
    return "automatic";
}

async function validateUpscalerName(upscalerName) {
    let response = await axios.get(`${constants.SD_API_HOST}/upscalers`);
    let upscalers = response.data;
    for(let upscaler of upscalers) {
        if(upscaler.name === upscalerName) {
            return upscalerName;
        }
    }

    // Check if "4x_NMKD-Siax_200k" exists, and use that if so - unless that was already the one that we tried earlier
    if(upscalerName !== "4x_NMKD-Siax_200k") {
        for(let upscaler of upscalers) {
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

module.exports = {
    isValidDiffusionRequest,
    doesUserOwnCategory,
    validateModelName,
    validateSamplerName,
    validateSchedulerName,
    validateUpscalerName,
    getAlwaysOnScripts
}