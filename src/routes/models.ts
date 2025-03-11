import {Request, Response, Router} from 'express';
import {isAuthenticated} from '@/security';
import {getLorasFromForge} from '@/thirdparty/forge';
import {CivitAi} from '@/thirdparty/civitai';
import {ForgeLora} from "@/types/thirdparty/forge";
import {convertForgeAndCivitaiLoraToNavigator, NavigatorLora} from "@/types/models";
import {RequestBody, RequestParams, ResponseBody} from "@/types/express";
import {CivitAiModelType} from "@/types/thirdparty/civitai";
import {asyncQuery} from "@/database";
import * as child_process from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

export const modelRouter = Router();

const civitai = new CivitAi();

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
    // Grab the hash from each lora, ask CivitAI for the data on each lora that it matched
    for(const lora of loras) {
        let hash = ""
        if(!lora.metadata?.sshs_model_hash) {
            console.log("Lora has no SSHS model hash! Name: ", lora)
            // Attempt to see if we can try to fall back with a SHA256 hash instead
            if(process.env.MODEL_DIR !== undefined) {
                // Get the path to the model
                console.log("Attempting to manually get SHA256 hash for lora: ", lora.name)
                let loraPath = path.resolve(process.env.MODEL_DIR, './Lora', lora.name + ".safetensors")
                loraPath = fs.realpathSync(loraPath)
                try {
                    hash = await getFileSha256(lora.name, loraPath)
                    console.log("Got manual SHA256 hash for lora: ", lora.name, " -> ", hash)
                } catch(e) {
                    console.error("Failed to manually calculate SHA256 hash for lora: ", lora.name)
                    console.error(e)
                    unmatchedLoras.push(lora)
                    continue
                }
            } else {
                unmatchedLoras.push(lora)
                continue
            }
        } else {
            hash = lora.metadata.sshs_model_hash.slice(0, 12)
        }

        try {
            const matchedModel = await civitai.getModelVersionByHash(hash)
            if(matchedModel?.model?.type !== CivitAiModelType.LORA) {
                console.warn(`Unexpected model type found for ${hash}: ${matchedModel?.model?.type} (Expected: LORA)`)
                continue
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

async function getFileSha256(fileName: string, filePath: string): Promise<string> {
    // First, see if we already have a cache of this in our database (file_sha256_cache) as recalculating is expensive
    let results = await asyncQuery("SELECT sha256_sum FROM file_sha256_cache WHERE file_name = ?", [fileName])
    if(results.length > 0) {
        console.log("Found cached SHA256 for file: ", fileName)
        return results[0].sha256_sum
    }

    // Not found in the cache, go ahead and calculate it again
    console.log(`Non-cached entry. Calculating SHA256 for file: ${fileName} (${filePath})`)
    let output = child_process.execSync('sha256sum ' + filePath)
    let sha256 = output.toString().split(" ")[0]
    // Update the cache so that we can just read it from the cache next time
    await asyncQuery("INSERT INTO file_sha256_cache (file_name, sha256_sum) VALUES (?, ?)", [fileName, sha256])
    return sha256
}
