declare global {
    namespace NodeJS {
        interface ProcessEnv {
            ENABLE_LORA_REQUESTS: undefined | boolean;
            SUPPORTS_FLUX: undefined | boolean;
        }
    }
}

export {}