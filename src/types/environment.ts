declare global {
    namespace NodeJS {
        interface ProcessEnv {
            ENABLE_LORA_REQUESTS: undefined | boolean;
            SUPPORTS_FLUX: undefined | boolean;
            SECRET_KEY: string;
            SUPERUSER_ADMIN_TOKEN: undefined | string;
            BOT_TOKEN: undefined | string;
        }
    }
}

export {}