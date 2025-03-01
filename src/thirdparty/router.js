import {CivitAi} from './civitai';
import {getAvailableStorage, downloadFileToPath} from '@/storage';
import {Router} from "express";

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
