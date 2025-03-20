import { PermissionRole } from "@/security";
import { ModelMetadataProvider, ModelType } from "@/types/enums";

export interface User {
  id: BigInt;
  role: PermissionRole;
  created_at: Date; // This does not need to be explicitly set by Navigator, the database will create it automatically
  readonly updated_at: Date; // This is auto-calculated on the database side
}

export interface ModelMetadata {
  id?: number; // Internal ID for the cache entry, use the `hash` as the actual key below
  hash: string;
  model_type: ModelType;
  metadata_cache: string;
  metadata_provider: ModelMetadataProvider;
  metadata_id: number;
  metadata_updated_at: Date; // This is generally auto-calculated by the database
  updates_disabled: boolean;
}
