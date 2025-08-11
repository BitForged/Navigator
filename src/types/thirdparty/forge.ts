/**
 * Definitions for objects sent to or received from the Forge API
 */

export interface ForgeLora {
  name: string;
  alias: string;
  path: string;
  metadata?: ForgeLoraMetadata;
}

export interface ForgeLoraMetadata {
  /**
   * This is the "AutoV3" hash that CivitAI will be looking for when using the by-hash endpoint
   *  you'll need to make sure that you only use the first 12 characters as that is how CivitAI saves it.
   */
  sshs_model_hash: string;
  // Define a few keys we know about that are "junk" so that they can be removed
  ss_tag_frequency?: ForgeLoraTagFrequency;
  ss_datasets?: object[];
  ss_bucket_info?: object;
  ss_dataset_dirs?: object;

  // Currently, we only care about the model hash (and maybe tag frequency) but include the other keys just in case.
  [key: string]: any;
}

export interface ForgeLoraTagFrequency {
  [key: string]: {
    [tag: string]: number;
  };
}

export interface ForgeEmbeddingResponse {
  loaded: Record<string, ForgeEmbedding>;
  skipped: {};
}

export interface ForgeEmbedding {
  step: number | null;
  sd_checkpoint: string | null;
  sd_checkpoint_name: string | null;
  shape: number;
  vectors: number;
}

export type ForgeLoraResponse = ForgeLora[];
