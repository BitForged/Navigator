export interface NavigatorConfig {
    /**
     * Defines the maximum allowed number of pixels for generating images.
     */
    readonly pixelLimit: number
}

export interface NavigatorVersion {
    branch: string;
    commit: string;
}

export function getApplicationConfig(): NavigatorConfig {
    return {
        pixelLimit: process.env.IMAGE_PIXEL_LIMIT || 3686400
    }
}