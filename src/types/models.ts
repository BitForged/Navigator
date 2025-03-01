import {ForgeLora} from "@/types/thirdparty/forge";
import {CivitAiModelVersion} from "@/types/thirdparty/civitai";

export type MergedLora = ForgeLora & CivitAiModelVersion

export interface NavigatorLora {
    forge: ForgeLora,
    civitai: CivitAiModelVersion,
    alias: string,
    name: string,
    nsfw?: boolean
}

export function convertForgeAndCivitaiLoraToNavigator(civitai: CivitAiModelVersion, forge: ForgeLora): NavigatorLora {
    return {
        forge,
        civitai,
        alias: forge.alias,
        name: civitai.name,
        nsfw: civitai.model.nsfw
    }
}