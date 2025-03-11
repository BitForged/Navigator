import {CivitAi} from './civitai';
import {getAvailableStorage, downloadFileToPath} from '@/storage';
import {Router} from "express";
import {isAuthenticated} from "@/security";
import axios from "axios";

const civitai = new CivitAi();
export const thirdPartyRouter = new Router();

thirdPartyRouter.get('/test_civitai', async (req, res) => {
    let isAuthenticated = await civitai.isAuthenticated().catch(_ => {
        console.error("Request to CivitAI failed");
        return false;
    })
    res.json({isAuthenticated});
});

thirdPartyRouter.get('/civitai/download/:modelId', async (req, res) => {
    let modelId = req.params.modelId;
    if (!await civitai.isAuthenticated()) {
        res.status(500).json({message: 'CivitAI authentication failed'});
        return;
    }
    let modelData = await civitai.getModelDownloadUrl(modelId).catch(_ => {
        console.error("Request to CivitAI failed");
        return null;
    })
    let storagePercentage = await getAvailableStorage("/home");

    if (storagePercentage < 10) {
        res.status(500).json({message: 'Low storage space'});
        return
    }

    if (modelData) {
        switch (modelData.type) {
            case "Checkpoint": {
                if (process.env.MODEL_CKPT_DIR === undefined) {
                    res.status(500).json({message: 'Model checkpoint directory not set'});
                    return;
                }
                downloadFileToPath(`${modelData.file.downloadUrl}?token=${civitai.getApiKey()}`, `${process.env.MODEL_CKPT_DIR}/${modelData.file.name}`).then(() => {
                    res.json({message: 'Model downloaded'});
                }).catch(err => {
                    console.error(err);
                    res.status(500).json({message: 'Internal Server Error'});
                });
                return;
            }

            default: {
                res.status(400).json({message: 'Unsupported model type'});
                return;
            }
        }
    } else {
        res.status(404).json({message: 'Model not found'});
    }
});

thirdPartyRouter.get('/civitai/api-proxy/*', isAuthenticated, async (req, res) => {
    // Proxies API requests from downstream clients to CivitAI with our API key (and to bypass CORS)
    try {
        const requestedPath = req.params[0]
        const queryParams = req.query
        console.log('Found request to forward to CivitAI API: ', requestedPath, queryParams)
        const upstreamUrl = `https://civitai.com/api/v1/${requestedPath}`
        let upstreamResponse = await axios.get(upstreamUrl, {
            params: queryParams,
            headers: {
                Authorization: `Bearer ${civitai.getApiKey()}`,
                "User-Agent": "Navigator"
            }
        })
        res.status(upstreamResponse.status).json(upstreamResponse.data);
    } catch (error) {
        if (error.response) {
            // The upstream API returned an error status code
            res.status(error.response.status).json(error.response.data);
        } else if (error.request) {
            // The request was made, but no response was received
            res.status(500).send('Upstream API did not respond');
        } else {
            // Something happened in setting up the request that triggered an Error
            res.status(500).send('An error occurred');
            console.error(error);
        }
    }
})
