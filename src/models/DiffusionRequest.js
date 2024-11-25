module.exports = class DiffusionRequest {
    constructor(id, model_name, prompt, negative_prompt, seed, sampler_name, steps, cfg_scale, width, height) {
        this.id = id;
        this.model_name = model_name;
        this.prompt = prompt
        this.negative_prompt = negative_prompt || "";
        this.seed = seed || -1;
        this.subseed = -1;
        this.subseed_strength = 0;
        this.sampler_name = sampler_name;
        this.steps = steps || 50;
        this.cfg_scale = cfg_scale || 5;
        this.width = width || 500;
        this.height = height || 500;
        this.denoising_strength = 0.35;
    }
}