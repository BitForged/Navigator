const DiffusionRequest = require("./DiffusionRequest");
const database = require("../database");
const constants = require("../constants");
const axios = require("axios");
const { getAlwaysOnScripts } = require("../util");

module.exports = class Img2ImgRequest extends DiffusionRequest {
  constructor(
    id,
    model_name,
    prompt,
    negative_prompt,
    seed,
    sampler_name,
    scheduler_name,
    steps,
    cfg_scale,
    width,
    height,
    initial_image,
    mask,
    image_enhancements,
  ) {
    super(
      id,
      model_name,
      prompt,
      negative_prompt,
      seed,
      sampler_name,
      steps,
      cfg_scale,
      width,
      height,
    );
    this.initial_image = initial_image;
    this.mask = mask;
    this.image_enhancements = image_enhancements;
  }

  async prepareInitialImage() {
    // If the initial image is provided, and the prefix is NAVIGATOR, then assume it's a job ID
    // Since the API expects a base64 image, we need to convert the job ID to a base64 image
    if (this.initial_image && this.initial_image.indexOf("NAVIGATOR") === 0) {
      this.initial_image = this.initial_image.replaceAll("NAVIGATOR_", "");
      let img = await database.getImageById(this.initial_image);
      if (img !== null) {
        this.initial_image = img.image_data.toString();
      } else {
        throw new Error(`Image with ID ${this.initial_image} not found`);
      }
    }
  }

  // Function to convert the request to the format expected by the API
  toApiFormat() {
    let inpaintingData = {};
    if (!this.mask || this.mask !== "") {
      console.log("Adding inpainting data");
      inpaintingData = {
        mask: this.mask,
        initial_noise_multiplier: 1,
        inpaint_full_res: 1,
        mask_blur: 4,
        mask_blur_x: 4,
        mask_blur_y: 4,
        mask_round: true,
        inpainting_fill: 1,
        inpaint_full_res_padding: 32,
        inpainting_mask_invert: 0,
        image_cfg_scale: 1.5,
      };
    }
    return {
      force_task_id: `navigator-${this.id}`,
      prompt: this.prompt,
      negative_prompt: this.negative_prompt,
      seed: this.seed,
      subseed: this.subseed,
      subseed_strength: this.subseed_strength,
      sampler_name: this.sampler_name,
      scheduler: this.scheduler_name,
      steps: this.steps,
      cfg_scale: this.cfg_scale,
      width: this.width,
      height: this.height,
      denoising_strength: this.denoising_strength,
      mask: this.mask,
      init_images: this.initial_image ? [this.initial_image] : [],
      override_settings: {
        sd_model_checkpoint: this.model_name,
      },
      save_images: false,
      ...inpaintingData,
    };
  }

  sendToApi() {
    const apiData = this.toApiFormat();
    // Validate some parameters that are required for the API
    if (apiData.steps > 75) {
      apiData.steps = 75;
    }

    if (this.image_enhancements) {
      apiData["alwayson_scripts"] = getAlwaysOnScripts(true, true);
    }

    if (!apiData.mask || apiData.mask === "") {
      delete apiData.mask; // API might be angry if we send an empty mask
    }

    return axios.post(`${constants.SD_API_HOST}/img2img`, apiData);
  }
};
