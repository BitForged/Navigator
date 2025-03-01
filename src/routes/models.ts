import {Request, Response, Router} from 'express';
import {isAuthenticated} from '@/security';
import {getLorasFromForge} from '@/thirdparty/forge';
import {CivitAi} from '@/thirdparty/civitai';
import {ForgeLora} from "@/types/thirdparty/forge";
import {convertForgeAndCivitaiLoraToNavigator, NavigatorLora} from "@/types/models";
import {RequestBody, RequestParams, ResponseBody} from "@/types/express";
import {CivitAiModelType} from "@/types/thirdparty/civitai";

export const modelRouter = Router();

const civitai = new CivitAi();

interface LorasRequestQuery {
    forge_only: boolean
}

modelRouter.get('/loras', isAuthenticated, async (req: Request<RequestParams, ResponseBody, RequestBody, LorasRequestQuery>, res: Response) => {
    const loras: ForgeLora[] = await getLorasFromForge()
    const mergedLoras: NavigatorLora[] = []
    const unmatchedLoras: ForgeLora[] = []
    if(req.query.forge_only) {
        res.json(loras)
        return
    }
    // Grab the hash from each lora, ask CivitAI for the data on each lora that it matched
    for(const lora of loras) {
        if(!lora.metadata?.sshs_model_hash) {
            console.log("Lora has no SSHS model hash! Name: ", lora)
            unmatchedLoras.push(lora)
            continue;
        }
        try {
            const matchedModel = await civitai.getModelVersionByHash(lora.metadata.sshs_model_hash.slice(0, 12))
            if(matchedModel?.model?.type !== CivitAiModelType.LORA) {
                console.warn(`Unexpected model type found for ${lora.metadata.sshs_model_hash}: ${matchedModel?.model?.type} (Expected: LORA)`)
                continue;
            }
            if(matchedModel) {
                delete lora.metadata;
                mergedLoras.push(convertForgeAndCivitaiLoraToNavigator(matchedModel, lora))
            }
        } catch(error) {
            console.error(`An error occurred when checking for matching model version for ${lora.metadata?.sshs_model_hash}: ${error}`)
        }
    }
    if(unmatchedLoras.length > 0) {
        console.warn("The following loras had no matching model: ", unmatchedLoras.map(l => l.name))
    }

    res.json(mergedLoras)
})

