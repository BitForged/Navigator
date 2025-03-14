import {Request, Response, Router} from 'express';
import {isAdministrator, isAuthenticated} from '@/security';
import {getLorasFromForge} from '@/thirdparty/forge';
import {ForgeLora} from "@/types/thirdparty/forge";
import {getLoraMetadata, isLocalOverrideLora, NavigatorLora, setModelMetadata} from "@/types/models";
import {RequestBody, RequestParams, ResponseBody} from "@/types/express";
import {ModelMetadata} from "@/types/database";
import {ModelMetadataProvider, ModelType} from "@/types/enums";

export const modelRouter = Router();

interface LorasRequestQuery {
    forge_only: boolean
}

// @ts-ignore
modelRouter.get('/loras', isAuthenticated, async (req: Request<RequestParams, ResponseBody, RequestBody, LorasRequestQuery>, res: Response) => {
    const loras: ForgeLora[] = await getLorasFromForge()
    const mergedLoras: NavigatorLora[] = []
    const unmatchedLoras: ForgeLora[] = []
    if(req.query.forge_only) {
        res.json(loras)
        return
    }
    for(const lora of loras) {
        const match = await getLoraMetadata(lora)
        if(match === undefined) {
            unmatchedLoras.push(lora)
            continue
        }
        mergedLoras.push(match)
    }
    if(unmatchedLoras.length > 0) {
        console.warn("The following loras had no matching model: ", unmatchedLoras.map(l => l.name))
    }

    res.json(mergedLoras)
})

modelRouter.post('/loras/override/:hash', isAuthenticated, isAdministrator, async (req: Request<RequestParams, ResponseBody, RequestBody>, res: Response) => {
    if(req.params['hash'] !== undefined) {
        const hash = req.params['hash']
        // Make sure the request body actually conforms to the override format
        const override = req.body
        if(isLocalOverrideLora(override) && typeof hash === 'string') {
           let metadata: ModelMetadata = {
               hash,
               model_type: ModelType.LORA,
               metadata_cache: JSON.stringify(override),
               metadata_provider: ModelMetadataProvider.LOCAL,
               metadata_id: 0,
               metadata_updated_at: new Date(),
               updates_disabled: false
           }

           try {
               await setModelMetadata(hash, metadata)
               res.status(200).json(
                   {
                       message: `Successfully set local override for lora ${override.name} (${hash})`
                   }
               )
           } catch (e) {
               console.error(`Failed to set local override for lora ${override.name} (${hash}): `, e)
               res.status(500).json({error: 'Internal Server Error'})
           }
        } else {
            res.status(400).json({error: 'Invalid override format!'})
        }
    } else {
        res.status(400).json({error: 'Missing required route parameter: hash'})
    }
})