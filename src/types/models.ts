import { ForgeLora } from "@/types/thirdparty/forge";
import { CivitAiModelVersion, isCivitAiModelVersion } from "@/types/thirdparty/civitai";
import { ModelMetadataProvider, ModelType } from "@/types/enums";
import path from "node:path";
import fs from "node:fs";
import { asyncQuery } from "@/database";
import child_process from "node:child_process";
import { ModelMetadata } from "@/types/database";
import { CivitAi } from "@/thirdparty/civitai";

export interface LocalOverrideLora {
  name: string;
  description: string;
  nsfw: boolean;
  trainedWords?: string[];
  baseModel: string;
  images?: string[];
}

export function isLocalOverrideLora(obj: any): obj is LocalOverrideLora {
  return (
    (obj &&
      typeof obj.name === "string" &&
      typeof obj.description === "string" &&
      typeof obj.nsfw === "boolean" &&
      typeof obj.baseModel === "string" &&
      obj.images === undefined) ||
    (obj.images !== undefined &&
      Array.isArray(obj.images) &&
      obj.images.every((image: any) => typeof image === "string") &&
      obj.trainedWords === undefined) ||
    (obj.trainedWords !== undefined &&
      Array.isArray(obj.trainedWords) &&
      obj.trainedWords.every((word: any) => typeof word === "string"))
  );
}

export interface NavigatorLora {
  forge: ForgeLora;
  civitai?: CivitAiModelVersion;
  localOverride?: LocalOverrideLora;
  alias: string;
  name: string;
  nsfw?: boolean;
  provider: ModelMetadataProvider.CIVITAI | ModelMetadataProvider.LOCAL; // Acts as further "documentation"
  // that we don't
  // support HuggingFace
  // (yet).
}

export function convertCivitaiAndForgeToNavigatorLora(
  civitai: CivitAiModelVersion,
  forge: ForgeLora
): NavigatorLora {
  return {
    forge,
    civitai,
    alias: forge.alias,
    name: civitai.name,
    nsfw: civitai.model.nsfw,
    provider: ModelMetadataProvider.CIVITAI
  };
}

// FIXME: At some point there should probably be a more generic "get model" function equivalent of this
/**
 * Attempts to get the metadata associated with this LoRA.
 * It will check to see if there is metadata cached in the
 *  database, which will also determine what provider the metadata comes from.
 * @param lora The internal Forge representation of this LoRA (will be used to match against the database).
 * @param forceUpdateMetadata If true, will force an update of the metadata from upstream (if possible).
 */
export async function getLoraMetadata(
  lora: ForgeLora,
  forceUpdateMetadata: boolean = false
): Promise<NavigatorLora | undefined> {
  let hash = "";
  const civitai = new CivitAi();
  if (forceUpdateMetadata) {
    console.log("Forcing update of metadata for lora: ", lora.name);
  }

  if (!lora.metadata?.sshs_model_hash) {
    // The metadata is needed to grab the hash of the model, which is what gets stored against the database.
    //  If we don't have the metadata/hash of the model, then attempt to calculate the SHA256 of the hash manually

    console.log("Lora has no SSHS model hash! Name: ", lora.name);
    // Attempt to see if we can try to fall back with a SHA256 hash instead
    if (process.env.MODEL_DIR !== undefined) {
      // Get the path to the model
      console.log(
        "Attempting to manually get SHA256 hash for lora: ",
        lora.name
      );
      let loraPath = path.resolve(
        process.env.MODEL_DIR,
        "./Lora",
        lora.name + ".safetensors"
      );
      try {
        loraPath = fs.realpathSync(loraPath);
        hash = await getFileSha256(lora.name, loraPath);
        console.log(
          "Got manual SHA256 hash for lora: ",
          lora.name,
          " -> ",
          hash
        );
      } catch (e) {
        console.error(
          "Failed to manually calculate SHA256 hash for lora: ",
          lora.name
        );
        console.error(e);
        console.warn(
          `Falling back to using alias as the hash for lora: ${lora.name} (Alias: ${lora.alias})`
        );
        hash = lora.alias;
      }
    } else {
      // Can't fall back to calculating the SHA256 hash manually, since we don't know where the model is.
      console.warn(
        "No model directory set, cannot calculate SHA256 hash for lora - falling back to alias as the hash: ",
        lora.name
      );
      console.warn(
        "If this is intended, please be sure to register a local override using the alias as the hash. Name: ",
        lora.name,
        " -> ",
        lora.alias
      );
      hash = lora.alias;
    }
  } else {
    hash = lora.metadata.sshs_model_hash.slice(0, 12);
  }

  // Now that we have the hash of the model,
  //  we can look it up in the `model_metadata` database table and get the metadata
  let metadata = await getModelMetadata(hash);
  if (metadata) {
    // Check if the metadata provider is CivitAI, and if it is and the `metadata_updated_at` timestamp is older than
    //  7 days, re-request the metadata from CivitAI.
    const CACHE_VALID_RANGE = 1000 * 60 * 60 * 24 * 7;
    if (metadata.metadata_provider === ModelMetadataProvider.CIVITAI) {
      let metadataObj = JSON.parse(metadata.metadata_cache);
      if ((metadata.metadata_updated_at.getTime() > Date.now() - CACHE_VALID_RANGE) && !forceUpdateMetadata) {
        // Cache is still fine, return this data
        if (isCivitAiModelVersion(metadataObj)) {
          // console.debug(
          //     `Metadata for ${lora.name}'s cache is still valid, returning cached data from database.`
          // )
          return convertCivitaiAndForgeToNavigatorLora(metadataObj, lora);
        }
        console.warn(
          `Invalid metadata found in database for ${lora.name} - attempting to update again from CivitAI: `,
          metadataObj
        );
      }
      if (metadata.updates_disabled) {
        console.warn(
          `Model ${lora.name} is disabled for updates (and last updated > 7 days ago), returning current cached data.`
        );
        if (isCivitAiModelVersion(metadataObj)) {
          return convertCivitaiAndForgeToNavigatorLora(metadataObj, lora);
        } else {
          console.error(
            "Invalid metadata found in database (updates disabled, cannot resolve): ",
            metadataObj
          );
          return undefined;
        }
      }
      if (!(await civitai.isAuthenticated())) {
        console.error(
          "Not authenticated and and therefore unable to fetch model version (not in cache)!"
        );
        return;
      }
      try {
        // If the `metadata.metadata_id` field is set, grab the model by ID instead of hash
        //  this allows users who don't have a local copy of the file
        //  to still be able to use it.
        //  (by setting the expected ID in the database)
        let resp: CivitAiModelVersion | undefined;
        if (metadata.metadata_id) {
          resp = await civitai.getModelVersionById(metadata.metadata_id);
        } else {
          resp = await civitai.getModelVersionByHash(hash);
        }
        if (resp !== undefined) {
          // Update the cache in the database, then return it to the caller
          metadata.metadata_cache = JSON.stringify(resp);
          metadata.metadata_updated_at = new Date();
          await setModelMetadata(hash, metadata);
          return convertCivitaiAndForgeToNavigatorLora(resp, lora);
        }
      } catch (e) {
        console.warn(
          `[Cache Update Failed] No matching model on CivitAI found for ${lora.name} (${hash}) - was it taken down?`
        );
        // Return the cached data just in case it got pulled from CivitAI this isn't necessarily fatal since
        //  we already have a copy of the data anyway.
        return convertCivitaiAndForgeToNavigatorLora(metadataObj, lora);
      }
    } else if (metadata.metadata_provider === ModelMetadataProvider.LOCAL) {
      let obj = JSON.parse(metadata.metadata_cache);
      if (isLocalOverrideLora(obj)) {
        return {
          forge: lora,
          localOverride: obj,
          alias: lora.alias,
          name: lora.name,
          nsfw: obj.nsfw || false,
          provider: ModelMetadataProvider.LOCAL
        };
      } else {
        console.error(
          `Lora ${lora.name}'s metadata provider is marked as LOCAL, but the metadata is invalid!`
        );
        return undefined;
      }
    }
  } else {
    // We don't currently have any metadata for the LoRA, try to get it from CivitAI using the hash
    try {
      console.log(
        `No metadata found for lora ${lora.name} (${hash}), attempting to fetch from CivitAI...`
      );
      let resp = await civitai.getModelVersionByHash(hash);
      if (resp !== undefined) {
        // Persist the data into the cache
        let updatedMetadata: ModelMetadata = {
          hash,
          model_type: ModelType.LORA,
          metadata_cache: JSON.stringify(resp),
          metadata_provider: ModelMetadataProvider.CIVITAI,
          metadata_id: Number.parseInt(resp.id),
          metadata_updated_at: new Date(),
          updates_disabled: false
        };
        await setModelMetadata(hash, updatedMetadata);
        console.log(
          `Successfully fetched metadata for lora ${lora.name} (${hash}) from CivitAI - cached into database.`
        );
        return convertCivitaiAndForgeToNavigatorLora(resp, lora);
      }
    } catch (e) {
      console.error(
        `Failed to get metadata for lora ${lora.name} (${hash}) from CivitAI: `,
        e
      );
    }
  }

  console.error(`No metadata found for lora ${lora.name} (${hash})`);

  return undefined;
}

/**
 * This function will return an instance of {@link ModelMetadata} which represents cached metadata for a model from the
 * database.
 * @param modelHash The hash of the model, which is used as a key for the cache
 * @return An instance of {@link ModelMetadata} if the key exists in the database, otherwise returns undefined.
 */
export async function getModelMetadata(
  modelHash: string
): Promise<ModelMetadata | undefined> {
  const results = await asyncQuery(
    `SELECT id,
            hash,
            model_type,
            FROM_BASE64(metadata_cache) AS metadata_cache,
            metadata_provider,
            metadata_id,
            metadata_updated_at,
            updates_disabled
     FROM model_metadata
     WHERE hash = ?`,
    [modelHash]
  );
  if (results.length > 0) {
    return results[0] as ModelMetadata;
  }
  return undefined;
}

export async function setModelMetadata(
  modelHash: string,
  metadata: ModelMetadata
) {
  console.log("Setting metadata for model with hash: ", modelHash);
  const existingMetadata = await getModelMetadata(modelHash);
  if (existingMetadata) {
    // Update the metadata if it already exists
    console.log("Updating metadata for model with hash: ", modelHash);
    await asyncQuery(
      `UPDATE model_metadata
       SET model_type          = ?,
           metadata_cache      = TO_BASE64(?),
           metadata_provider   = ?,
           metadata_id         = ?,
           metadata_updated_at = NOW()
       WHERE hash = ?`,
      [
        metadata.model_type,
        metadata.metadata_cache,
        metadata.metadata_provider,
        metadata.metadata_id,
        modelHash
      ]
    );
  } else {
    // Insert a new metadata entry if not found
    console.log("Inserting metadata for model with hash: ", modelHash);
    await asyncQuery(
      `INSERT INTO model_metadata (hash, model_type, metadata_cache, metadata_provider, metadata_id)
       VALUES (?, ?, TO_BASE64(?), ?, ?)`,
      [
        modelHash,
        metadata.model_type,
        metadata.metadata_cache,
        metadata.metadata_provider,
        metadata.metadata_id
      ]
    );
  }
}

async function getFileSha256(
  fileName: string,
  filePath: string
): Promise<string> {
  // First, see if we already have a cache of this in our database (file_sha256_cache) as recalculating is expensive
  let results = await asyncQuery(
    "SELECT sha256_sum FROM file_sha256_cache WHERE file_name = ?",
    [fileName]
  );
  if (results.length > 0) {
    console.log("Found cached SHA256 for file: ", fileName);
    return results[0].sha256_sum;
  }

  // Not found in the cache, go ahead and calculate it again
  console.log(
    `Non-cached entry. Calculating SHA256 for file: ${fileName} (${filePath})`
  );
  const sha256Cmd = `sha256sum "${filePath}"`;
  let output = child_process.execSync(sha256Cmd);
  let sha256 = output.toString().split(" ")[0];
  // Update the cache so that we can just read it from the cache next time
  await asyncQuery(
    "INSERT INTO file_sha256_cache (file_name, sha256_sum) VALUES (?, ?)",
    [fileName, sha256]
  );
  return sha256;
}
