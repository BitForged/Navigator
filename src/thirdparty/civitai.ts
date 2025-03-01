import axios, {isAxiosError} from "axios";
import {CivitAiModelResponse, CivitAiModelVersion, isCivitAiModelVersion} from '@/types/thirdparty/civitai';
import * as database from '@/database'
import {ModelMetadataProvider} from "@/types/enums";

export class CivitAi {
    apiKey: string | undefined = "";
    CIVIT_AI_API_URL = "https://civitai.com/api/v1";
    constructor() {
        this.apiKey = process.env.CIVITAI_API_KEY;
    }

    getApiKey() {
        return this.apiKey || process.env.CIVITAI_API_KEY;
    }

    /**
     * Constructs the full URL for a given endpoint by appending it to the base API URL.
     *
     * @param {string} endpoint - The specific API endpoint to be appended to the base URL.
     * @return {string} The full URL constructed by combining the base API URL and the provided endpoint.
     */
    getEndpoint(endpoint: string): string {
        return `${this.CIVIT_AI_API_URL}/${endpoint}`;
    }

    /**
     * Checks if the current session is authenticated by making a test API request.
     *
     * @return {Promise<boolean>} Returns a promise that resolves to true if the response status is 200, indicating successful authentication, otherwise false.
     */
    async isAuthenticated(): Promise<boolean> {
        let resp = await axios.get(`${this.getEndpoint('models')}?hidden=1&limit=1`, {
            headers: {
                Authorization: "Bearer " + this.apiKey || ""
            }
        })

        return resp.status === 200;
    }

    /**
     * Retrieves the latest download URL for a specified model based on its ID.
     * The method also considers certain conditions, such as environment support for specific models.
     *
     * @param {number} modelId - The unique identifier of the model to retrieve the download URL for.
     * @return {Promise<string | undefined>} A promise that resolves to the download URL of the model if found and accessible, or undefined if the model is not available or the user is not authenticated.
     */
    async getModelDownloadUrl(modelId: number): Promise<string | undefined> {
        if(!await this.isAuthenticated()) {
            return;
        }

        try {
            let resp = await axios.get<CivitAiModelResponse>(`${this.getEndpoint('models')}/${modelId}`, {
                headers: {
                    Authorization: "Bearer " + this.apiKey
                }
            })

            if(resp.status !== 200) {
                console.error("Error getting model data: ", )
                return;
            }

            const data = resp.data;

            for(let modelVersion of data.modelVersions) {
                if(modelVersion.baseModel.indexOf("Flux") !== -1 && process.env.SUPPORTS_FLUX !== true) {
                    // Skip this model version if it is a Flux model and the environment does not support it.
                    continue;
                }
                console.log(modelVersion.files);
                return modelVersion.files[0].downloadUrl;
                // TODO: Expand this to possibly include other data, such as the SHA256 hash of the model.
            }
            return;
        } catch(error) {
            if(isAxiosError(error)) {
                console.error(error.response?.data);
            } else {
                console.error("Unknown error occurred when checking for matching model version: ", error);
            }
            return;
        }
    }

    /**
     * Fetches a model version based on the provided hash.
     * Makes a request to the API to retrieve the model version associated with the given hash,
     * if the user is authenticated.
     *
     * @param {string} hash - The hash value of the model version to be retrieved.
     * @return {Promise<CivitAiModelVersion | undefined>} A promise that resolves to the
     * CivitAiModelVersion object if found, or undefined if the user is not authenticated or
     * the model version is not found.
     */
    async getModelVersionByHash(hash: string): Promise<CivitAiModelVersion | undefined> {
        // Check to see if we've already cached the metadata (and it's not older than 7 days)
        const metadata = await database.asyncQuery("SELECT id, hash, FROM_BASE64(metadata_cache) AS metadata_cache, metadata_updated_at FROM model_metadata WHERE hash = ? AND metadata_provider = ? LIMIT 1", [hash, ModelMetadataProvider.CIVITAI])
        if(metadata.length > 0) {
            if(metadata[0].metadata_updated_at > Date.now() - 1000 * 60 * 60 * 24 * 7 /* Ensure cache is not more than 7 days old */) {
                const metadataObj = JSON.parse(metadata[0].metadata_cache.toString('utf8'));
                if(isCivitAiModelVersion(metadataObj)) {
                    return metadataObj;
                } else {
                    console.error("Invalid metadata found in database: ", metadataObj);
                }
            } else {
                console.warn(`Metadata for ${hash} cache is older than 7 days, fetching new metadata from API.`)
            }
        }

        if(!await this.isAuthenticated()) {
            console.error("Not authenticated and and therefore unable to fetch model version (not in cache)!")
            return;
        }

        try {
            let resp = await axios.get<CivitAiModelVersion>(`${this.getEndpoint(`model-versions/by-hash/${hash}`)}`, {
                headers: {
                    Authorization: "Bearer " + this.apiKey
                }
            })
            delete resp.data.images;
            // Update metadata cache in database
            await database.asyncQuery("INSERT INTO model_metadata (hash, metadata_cache, metadata_provider, metadata_updated_at) VALUES (?, TO_BASE64(?), ?, ?) ON DUPLICATE KEY UPDATE metadata_cache = TO_BASE64(?), metadata_updated_at = ?, metadata_provider = ?",
                [hash, JSON.stringify(resp.data), ModelMetadataProvider.CIVITAI, new Date(), JSON.stringify(resp.data), new Date(), ModelMetadataProvider.CIVITAI])
            console.log(
                "Updated metadata cache for model version with hash " + hash + " in database."
            )
            return resp.data;
        } catch(error) {
            if(isAxiosError(error)) {
                console.error(error.response?.data);
            } else {
                console.error("Unknown error occurred when checking for matching model version: ", error);
            }
            return;
        }
    }
}

// module.exports = CivitAi;