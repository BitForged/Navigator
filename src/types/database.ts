import {PermissionRole} from "@/security";

export interface User {
    id: BigInt,
    role: PermissionRole,
    created_at: Date, // This does not need to be explicitly set by Navigator, the database will create it automatically
    readonly updated_at: Date // This is auto calculated on the database side
}