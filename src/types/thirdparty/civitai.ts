export interface CivitAiModel {
  id: string;
  name: string;
  description: string;
  type: CivitAiModelType;
  nsfw: boolean;
  mode: "Archived" | "TakenDown" | undefined;
  creator: CivitAiCreator;
  modelVersions: CivitAiModelVersion[];
  tags: string[];
}

export interface CivitAiCreator {
  username: string;
  image: string | null; // URL to creator avatar
}

export interface CivitAiModelStripped {
  name: string;
  type: CivitAiModelType;
  nsfw: boolean;
}

export interface CivitAiModelVersion {
  id: string;
  /**
   * This will be the "Version" of the model as displayed on CivitAI
   */
  name: string;
  model: CivitAiModelStripped;
  baseModel: string;
  description: string;
  createdAt: string;
  downloadUrl: string;
  trainedWords: string[];
  files: CivitAiModelVersionFile[];
  images?: object[];
}

export interface CivitAiModelVersionFile {
  id: number;
  sizeKB: number;
  name: string;
  type: CivitAiModelType;
  primary: boolean | undefined;
  hashes: {
    AutoV1: string;
    AutoV2: string;
    AutoV3: string;
    SHA256: string;
    CRC32: string;
    BLAKE3: string;
  };
  downloadUrl: string;
}

export enum CivitAiModelType {
  Checkpoint = "Checkpoint",
  TextualInversion = "TextualInversion",
  Hypernetwork = "Hypernetwork",
  AestheticGradient = "AestheticGradient",
  LORA = "LORA",
  Controlnet = "Controlnet",
  Poses = "Poses",
}

export function getFolderPathForModelType(
  type: CivitAiModelType,
): string | null {
  switch (type) {
    case CivitAiModelType.LORA:
      return "Lora";
    case CivitAiModelType.Controlnet:
      return "ControlNet";
    case CivitAiModelType.Poses:
      throw new Error("Unsupported model type: " + type);
    case CivitAiModelType.Checkpoint:
      return "Stable-diffusion";
    case CivitAiModelType.TextualInversion:
      return "../embeddings"; // A bit of a unique case, Forge doesn't store the embeddings in the `models`
    // folder, but a dir up instead
    case CivitAiModelType.Hypernetwork:
      return "hypernetworks";
    case CivitAiModelType.AestheticGradient:
      throw new Error("Unsupported model type: " + type);
  }
}

export type CivitAiModelResponse = CivitAiModel;

/**
 * Checks if the given object is a valid CivitAiModelVersion type. Used as a Type-guard for when deserializing
 *  JSON from the database.
 *
 * @param obj The object to check.
 * @return Returns true if the object is a valid CivitAiModelVersion, otherwise false.
 */
export function isCivitAiModelVersion(obj: any): obj is CivitAiModelVersion {
  return (
    (obj &&
      typeof obj.id === "number" &&
      typeof obj.name === "string" &&
      typeof obj.description === "string") ||
    (obj.description === null &&
      typeof obj.baseModel === "string" &&
      Array.isArray(obj.trainedWords) &&
      Array.isArray(obj.files) &&
      obj.files.every((file: any) => {
        return (
          typeof file.id === "number" &&
          typeof file.sizeKB === "number" &&
          typeof file.name === "string" &&
          typeof file.type === "string" &&
          typeof file.downloadUrl === "string"
        );
      }))
  );
}
