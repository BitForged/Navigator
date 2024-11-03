const axios = require('axios');

class CivitAi {
    apiKey = "";
    CIVIT_AI_API_URL = "https://civitai.com/api/v1";
    constructor() {
        this.apiKey = process.env.CIVITAI_API_KEY;
    }

    getEndpoint(endpoint) {
        return `${this.CIVIT_AI_API_URL}/${endpoint}`;
    }

    async isAuthenticated() {
        let resp = await axios.get(`${this.getEndpoint('models')}?hidden=1&limit=1`, {
            headers: {
                Authorization: "Bearer " + this.apiKey
            }
        })

        return resp.status === 200;
    }

    // Will return the URL to download the model, specifically the latest version of the model.
    async getModelDownloadUrl(modelId) {
        let resp = await axios.get(`${this.getEndpoint('models')}/${modelId}`, {
            headers: {
                Authorization: "Bearer " + this.apiKey
            }
        })

        if(resp.status !== 200) {
            return null;
        }

        const modelData = {};

        modelData.type = resp.data.type;

        const data = resp.data;

        for(let modelVersion of data.modelVersions) {
            if(modelVersion.baseModel.indexOf("Flux") !== -1 && process.env.SUPPORTS_FLUX !== true) {
                // Skip this model version if it is a Flux model and the environment does not support it.
                continue;
            }
            console.log(modelVersion.files);
            modelData.file = modelVersion.files[0];
            // TODO: Expand this to possibly include other data, such as the SHA256 hash of the model.
            break;
        }
        return modelData;
    }
}

module.exports = CivitAi;