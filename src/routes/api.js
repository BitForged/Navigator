const express = require("express");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const {
  addQueueItem,
  removeQueueItem,
  getQueueSize,
  doesQueueContainItem,
  getCurrentlyProcessingItem,
} = require("../processing/queueWorker");
const { emitToAll, emitToSocketsByIp } = require("../processing/socketManager");
const database = require("../database");
const db = database.getConnectionPool();
const router = express.Router();
const constants = require("../constants");
const { isAuthenticated } = require("../security");
const {
  isValidDiffusionRequest,
  doesUserOwnCategory,
  validateModelName,
  validateSamplerName,
  validateSchedulerName,
  validateUpscalerName,
  cleanseTask,
} = require("../util");
const Img2ImgRequest = require("../models/Img2ImgRequest");
const appConfig = require("@/types/config").getApplicationConfig();

/*
    The goal of this route is to grab a list of models from the SD API, and also compare it to a list of models that we
     have in our database. Our database will include known models that might have certain attributes that we want consumers
     to be aware of, or we might assign it a more user-friendly name, etc.
 */
router.get("/models", async (req, res) => {
  if (req.query.refresh === "true") {
    await axios.post(`${constants.SD_API_HOST}/refresh-checkpoints`);
    emitToAll("models-refreshed", { message: "Models have been refreshed!" });
  }
  axios
    .get(`${constants.SD_API_HOST}/sd-models`)
    .then((response) => {
      db.query("SELECT * FROM models", (error, results) => {
        if (error) {
          res.json({ error: error.message });
        } else {
          const models = response.data.map((model) => {
            const match = results.find(
              (result) => result.model_name === model.model_name,
            );
            if (match) {
              // We want to merge the two objects,
              // but we also want to make sure that the is_restricted field is a boolean
              match.is_restricted = match.is_restricted === 1;
              return {
                ...model,
                known: true,
                ...match,
              };
            } else {
              return {
                ...model,
                known: false,
              };
            }
          });
          res.json({ models });
        }
      });
      // res.json(response.data);
    })
    .catch((error) => {
      res.json({ error: error.message });
    });
});

router.get("/samplers", async (req, res) => {
  axios
    .get(`${constants.SD_API_HOST}/samplers`)
    .then((response) => {
      let samplers = response.data;
      if (req.query.all === undefined) {
        // Return only the first 25, as that is the limit for Discord auto-complete.
        samplers = samplers.slice(0, 24);
      }
      res.json(samplers);
    })
    .catch((error) => {
      res.json({ error: error.message });
    });
});

router.get("/upscalers", async (req, res) => {
  axios
    .get(`${constants.SD_API_HOST}/upscalers`)
    .then((response) => {
      let upscalers = response.data;
      // The backend API returns an upscaler called "None", we can exclude that from the list
      upscalers = upscalers.filter((upscaler) => upscaler.name !== "None");
      res.json(upscalers);
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

router.get("/schedulers", async (req, res) => {
  axios
    .get(`${constants.SD_API_HOST}/schedulers`)
    .then((response) => {
      res.json(response.data);
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

router.get("/modules", async (req, res) => {
  axios
    .get(`${constants.SD_API_HOST}/sd-modules`)
    .then((response) => {
      res.json(response.data);
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
});

async function queueTxt2ImgRequest(req, res, owner_id, taskData = undefined) {
  /* For now, we expect the following parameters:
       - model_name
       - prompt (the "positive" prompt)
       - negative_prompt
       - owner_id
       - job_id (optional, if not present, generate one)
       - width (optional, default to 512)
       - height (optional, default to 512)
       - steps (optional, default to 50)
       - hrf_steps (optional, default to `steps`)
       - seed (optional, default to null)
       - cfg_scale (optional, default to 7)
       - sampler_name (optional, default to "DPM++ 2M")
       - scheduler_name (optional, default to "automatic")
       - denoising_strength (optional, default to 0.35 when hr_fix is enabled)
       - force_hr_fix (optional, default to false)
       - upscaler_name (optional, will check if "4x_NMKD-Siax_200k" exists - if not, fall back to a built-in ("RealESRGAN_x4"))
       - image_enhancements (optional, set to any value to activate, will enable FreeU and SAG via Forge if activated)
       - modules (optional, but needed for advanced model types like Flux and Chroma)
     */

  if (taskData === undefined) {
    const {
      model_name,
      prompt,
      negative_prompt,
      job_id,
      width,
      height,
      steps,
      hrf_steps,
      seed,
      cfg_scale,
      distilled_cfg,
      sampler_name,
      scheduler_name,
      denoising_strength,
      force_hr_fix,
      subseed,
      subseed_strength,
      categoryId,
      upscaler_name,
      image_enhancements,
      modules,
    } = req.body;
    taskData = {
      model_name,
      prompt,
      negative_prompt,
      job_id,
      width,
      height,
      steps,
      hrf_steps,
      seed,
      cfg_scale,
      distilled_cfg,
      sampler_name,
      scheduler_name,
      denoising_strength,
      force_hr_fix,
      subseed,
      subseed_strength,
      categoryId,
      upscaler_name,
      image_enhancements,
      modules,
    };
  }

  const {
    model_name,
    prompt,
    negative_prompt,
    job_id,
    width,
    height,
    steps,
    hrf_steps,
    seed,
    cfg_scale,
    distilled_cfg,
    sampler_name,
    scheduler_name,
    denoising_strength,
    force_hr_fix,
    subseed,
    subseed_strength,
    categoryId,
    upscaler_name,
    image_enhancements,
    modules,
  } = taskData;
  if (!model_name || !prompt || !owner_id) {
    res.status(400).json({ error: "Missing required parameters" });
    return;
  }

  // If a category ID was passed, ensure that the user actually owns the category.
  if (categoryId !== undefined && categoryId !== null) {
    try {
      let category = await database.getCategoryById(categoryId);
      if (!category || category.owner_id !== owner_id) {
        res
          .status(403)
          .json({ error: "Category does not exist or you do not own it" });
        return;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
  }

  // Ensure that the width and height are within acceptable bounds.
  if (width * height > appConfig.pixelLimit) {
    res.status(400).json({
      error: `The total value of (Width * Height) must not exceed ${appConfig.pixelLimit}`,
    });
    return;
  }

  // Get the Request IP Address (via the X-Forwarded-For/CF-Connecting-IP header if present)
  const requestIP = req.ip;

  let validatedSchedulerName;
  console.log(`Attempting to validate scheduler name: ${scheduler_name}`);
  if (scheduler_name === undefined || scheduler_name === null) {
    // Fall back to the "Automatic" scheduler if none was supplied
    validatedSchedulerName = "automatic";
    console.error(
      `Null/undefined scheduler name found, falling back to 'automatic'`,
    );
  } else {
    validatedSchedulerName = await validateSchedulerName(scheduler_name);
    if (validatedSchedulerName !== scheduler_name) {
      console.log(
        `Warn: Provided scheduler name ${scheduler_name} did not match the validated scheduler name of ${validatedSchedulerName} - retrying with lowercase name`,
      );
      validatedSchedulerName = await validateSchedulerName(
        scheduler_name.toLowerCase(),
      );
    }
    console.log(
      `Validated scheduler name: ${scheduler_name} => ${validatedSchedulerName}`,
    );
  }

  // TODO: Check if model_name is valid
  const job = {
    type: "txt2img",
    model_name,
    prompt,
    negative_prompt,
    owner_id,
    job_id: job_id || uuidv4().toString().substring(0, 8), //TODO: Check if job_id is unique
    width: width || 512,
    height: height || 512,
    steps: steps || 50,
    hrf_steps: hrf_steps || steps,
    seed: seed || -1,
    cfg_scale: cfg_scale || 7,
    distilled_cfg: distilled_cfg || 3.5,
    sampler_name: sampler_name || "DPM++ 2M",
    scheduler_name: validatedSchedulerName,
    denoising_strength: denoising_strength || 0.0,
    force_hr_fix: force_hr_fix || false,
    queue_size: getQueueSize() + 1,
    task_type: "txt2img",
    status: "queued",
    origin: requestIP,
    categoryId,
    image_enhancements: image_enhancements || false,
  };

  if (subseed && subseed_strength) {
    job.subseed = subseed;
    job.subseed_strength = subseed_strength;
  }

  if (taskData.first_pass_image) {
    job.first_pass_image = taskData.first_pass_image;
  }

  let samplerData = await axios.get(`${constants.SD_API_HOST}/samplers`);
  for (let i = 0; i < samplerData.data.length; i++) {
    let sampler = samplerData.data[i];
    // noinspection JSUnresolvedReference
    let containsAlias = sampler.aliases.indexOf(job.sampler_name) > -1;
    if (containsAlias) {
      job.sampler_name = sampler.name;
      break;
    }
  }

  if (upscaler_name !== undefined && upscaler_name !== null) {
    let validatedUpscalerName = await validateUpscalerName(upscaler_name);
    if (validatedUpscalerName) {
      job.upscaler_name = validatedUpscalerName;
    }
  }

  if (modules !== undefined && modules.length > 0) {
    job.modules = modules;
  }

  let error = await createImageJobInDB(job);

  if (error) {
    res.status(400).json({ error: error });
    return;
  }

  addQueueItem(job);
  if (job.first_pass_image) {
    let cleanedTask = { ...job };
    delete cleanedTask.first_pass_image;
    // We don't want to send the first pass image to the client, as it's a large base64 string.
    res.json(cleanedTask);
  } else {
    res.json(job);
  }
}

async function queueImg2ImgRequest(req, res, owner_id, taskData = undefined) {
  if (taskData === undefined) {
    const {
      model_name,
      prompt,
      negative_prompt,
      width,
      height,
      steps,
      seed,
      cfg_scale,
      sampler_name,
      scheduler_name,
      denoising_strength,
      categoryId,
      init_image,
      mask,
      image_enhancements,
    } = req.body;
    taskData = {
      owner_id,
      model_name,
      prompt,
      negative_prompt,
      width,
      height,
      steps,
      seed,
      cfg_scale,
      sampler_name,
      scheduler_name,
      denoising_strength,
      categoryId,
      init_image,
      mask,
      image_enhancements,
    };
  }

  let {
    model_name,
    prompt,
    negative_prompt,
    width,
    height,
    steps,
    seed,
    cfg_scale,
    sampler_name,
    scheduler_name,
    denoising_strength,
    categoryId,
    init_image,
    mask,
    image_enhancements,
  } = taskData;
  if (!isValidDiffusionRequest(taskData)) {
    res.status(400).json({ error: "Missing required parameters" });
    return;
  }

  if (sampler_name === undefined || sampler_name === null) {
    sampler_name = "DPM++ 2M";
  }

  // If a category ID was passed, ensure that the user actually owns the category.
  if (categoryId !== undefined && categoryId !== null) {
    try {
      if (!(await doesUserOwnCategory(owner_id, categoryId))) {
        res
          .status(403)
          .json({ error: "Category does not exist or you do not own it" });
        return;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }
  }

  if (denoising_strength) {
    if (denoising_strength < 0.0 || denoising_strength > 1.0) {
      res
        .status(400)
        .json({ error: "Denoising strength must be between 0.0 and 1.0" });
      return;
    }
  }

  // Ensure that the width and height are within acceptable bounds.
  if (width * height > appConfig.pixelLimit) {
    res.status(400).json({
      error: `The total value of (Width * Height) must not exceed ${appConfig.pixelLimit}`,
    });
    return;
  }

  // Get the Request IP Address (via the X-Forwarded-For/CF-Connecting-IP header if present)
  const requestIP = req.ip;

  model_name = await validateModelName(model_name);
  sampler_name = await validateSamplerName(sampler_name);
  scheduler_name = await validateSchedulerName(scheduler_name || "automatic");

  // Create an id for the job
  const job_id = uuidv4().toString().substring(0, 8);

  // Create a new Img2ImgRequest to attach to the job
  let backendRequest = null;
  try {
    backendRequest = new Img2ImgRequest(
      job_id,
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
      init_image,
      mask,
      image_enhancements || false,
    );
    if (denoising_strength) {
      backendRequest.denoising_strength = denoising_strength;
      console.log(`Setting denoising strength to ${denoising_strength}`);
    } else {
      backendRequest.denoising_strength = 0.75;
    }
    await backendRequest.prepareInitialImage();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal Server Error" });
    return;
  }

  // Start constructing a task to be queued
  const job = {
    type: "img2img",
    job_id,
    owner_id,
    queue_size: getQueueSize() + 1,
    task_type: "img2img",
    status: "queued",
    origin: requestIP,
    backendRequest,
    image_enhancements: image_enhancements !== undefined || false,
  };

  if (categoryId) {
    job.categoryId = categoryId;
  }

  // Attempt to allocate a new entry in the database for the job
  let error = await createImageJobInDB(job);
  if (error) {
    res.status(400).json({ error: error });
    return;
  }

  addQueueItem(job);

  if (init_image) {
    let cleanedTask = { ...job };
    delete cleanedTask.backendRequest;
    // We don't want to send the initial image to the client, in case it's a large base64 string.
    res.json(cleanedTask);
  } else {
    res.json(job);
  }
}

router.post("/queue/img2img", async (req, res) => {
  if (
    process.env.ALLOW_LEGACY_BOT_ENDPOINTS === undefined ||
    process.env.ALLOW_LEGACY_BOT_ENDPOINTS !== "true"
  ) {
    res.status(400).json({
      error:
        "This endpoint is not enabled. Please use /api/queue/user/img2img instead.",
    });
    return;
  }
  if (req.body.owner_id === undefined) {
    res.status(400).json({ error: "Missing authentication data" });
    return;
  }
  await queueImg2ImgRequest(req, res, req.body.owner_id);
});

router.post("/queue/txt2img", async (req, res) => {
  if (
    process.env.ALLOW_LEGACY_BOT_ENDPOINTS === undefined ||
    process.env.ALLOW_LEGACY_BOT_ENDPOINTS !== "true"
  ) {
    res.status(400).json({
      error:
        "This endpoint is not enabled. Please use /api/queue/user/txt2img instead.",
    });
    return;
  }
  if (req.body.owner_id === undefined) {
    res.status(400).json({ error: "Missing authentication data" });
    return;
  }
  await queueTxt2ImgRequest(req, res, req.body.owner_id);
});

// TODO: The next two routes belongs in user.js,
//  however the queue worker is here (and needs to be moved to a separate file)
router.post("/queue/user/txt2img", isAuthenticated, async (req, res) => {
  if (req.user.discord_id === undefined) {
    res.status(400).json({ error: "Missing authentication data" });
    return;
  }
  await queueTxt2ImgRequest(req, res, req.user.discord_id);
});

router.post("/queue/user/img2img", isAuthenticated, async (req, res) => {
  if (req.user.discord_id === undefined) {
    res.status(400).json({ error: "Missing authentication data" });
    return;
  }
  await queueImg2ImgRequest(req, res, req.user.discord_id);
});

function parseModelNameFromInfo(info) {
  // Regular expression to match the "Model: " pattern followed by the model name
  const modelRegex = /Model: ([^,\n]+)/;
  const match = info.match(modelRegex);

  if (match) {
    return match[1].trim(); // Extract the captured group and trim whitespace
  } else {
    return null; // Model not found
  }
}

/**
 * Returns a list of Forge modules given a speciefied info text string
 * @param {string} info - Represents the "info" text string from Forge
 * @returns {string[]} Any found modules, concatenated into an array with `.safetensors` appended to the end of each element.
 */
function parseModulesFromInfo(info) {
  // Example: "... Model hash: e6da438d1a, Model: my-fancy-model, Version: f2.0.1v1.10.1-previous-669-gdfdcbab6, Module 1: ae, Module 2: t5xxl_fp8_e4m3fn_scaled"
  // This regex finds all keys starting with "Module", and captures the value after the colon.
  const moduleRegex = /Module \d+:\s*([^,]+)/g;
  // For each match, we take the first captured group (the value).
  return Array.from(
    info.matchAll(moduleRegex),
    (match) => `${match[1]}.safetensors`,
  );
}

function getImageParams(jobId) {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT * FROM images WHERE id = ?",
      [jobId],
      async (error, results) => {
        if (error) {
          reject(error);
        } else {
          if (results.length > 0) {
            let info = {};
            if (
              results[0].info_data64 !== undefined &&
              results[0].info_data64 !== null
            ) {
              // Already cached, just utilize that instead
              console.log("Using cached image info");
              // Base64 decode the data
              let buffer = Buffer.from(results[0].info_data64, "base64");
              info = JSON.parse(buffer.toString("utf8"));
            } else {
              try {
                let res = await axios.post(
                  `${constants.SD_API_HOST}/png-info`,
                  { image: results[0].image_data.toString() },
                );
                info = res.data;
              } catch (e) {
                reject(e);
              }
            }
            let imageData = {
              width: info.parameters["Size-1"],
              height: info.parameters["Size-2"],
              seed: info.parameters["Seed"],
              cfg_scale: info.parameters["CFG scale"],
              distilled_cfg: info.parameters.distilled_cfg || 3.5,
              steps: info.parameters["Steps"],
              model_name: parseModelNameFromInfo(info.info),
              modules: parseModulesFromInfo(info.info),
              prompt: info.parameters["Prompt"],
              negative_prompt: info.parameters["Negative prompt"],
              sampler_name: info.parameters["Sampler"],
              scheduler_name: info.parameters["Schedule type"],
              denoising_strength: info.parameters["Denoising strength"],
              image_data: results[0].image_data.toString(),
            };
            const subseed = info.parameters["Variation seed"];
            const subseed_strength = info.parameters["Variation strength"];
            if (subseed !== undefined && subseed !== null) {
              imageData.subseed = subseed;
            }
            if (subseed_strength !== undefined && subseed_strength !== null) {
              imageData.subseed_strength = subseed_strength;
            }
            imageData.image_enhancements =
              info.parameters["freeu_enabled"] === "True" ||
              info.parameters["sag_enabled"] === "True";
            resolve(imageData);
          } else {
            reject("Job not found");
          }
        }
      },
    );
  });
}

router.post(
  "/queue/user/txt2img/upscale-hrf/:jobId",
  isAuthenticated,
  async (req, res) => {
    if (req.user.discord_id === undefined) {
      res.status(400).json({ error: "Missing authentication data" });
      return;
    }
    // noinspection JSUnresolvedReference
    const jobId = req.params.jobId;
    let newCategoryId = null;

    try {
      let image = await database.getImageById(jobId);
      // Check to see if the image previously had a category assigned to it.
      // If it did, and the user is also the owner of the category, then we will
      // assign the upscaled image to the same category.
      if (image !== null) {
        if (image.category_id !== null) {
          let category = await database.getCategoryById(image.category_id);
          if (category && category.owner_id === req.user.discord_id) {
            newCategoryId = category.id;
          }
        }
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal Server Error" });
      return;
    }

    getImageParams(jobId)
      .then(async (params) => {
        let taskData = {
          model_name: params.model_name,
          prompt: params.prompt,
          negative_prompt: params.negative_prompt,
          owner_id: req.user.discord_id,
          width: params.width,
          height: params.height,
          steps: params.steps,
          hrf_steps: params.hrf_steps || params.steps,
          seed: params.seed,
          cfg_scale: params.cfg_scale,
          sampler_name: params.sampler_name,
          scheduler_name: params.scheduler_name,
          denoising_strength: params.denoising_strength,
          first_pass_image: params.image_data,
          force_hr_fix: true,
          categoryId: newCategoryId,
          image_enhancements: params.image_enhancements || false,
          distilled_cfg: params.distilled_cfg,
          modules: params.modules || [],
        };

        if (
          req.body.upscaler_name !== undefined &&
          req.body.upscaler_name !== null
        ) {
          taskData.upscaler_name = req.body.upscaler_name;
        }

        if (
          req.body.denoising_strength !== undefined &&
          req.body.denoising_strength !== null
        ) {
          taskData.denoising_strength = req.body.denoising_strength;
        }

        if (req.body.hrf_steps !== undefined && req.body.hrf_steps !== null) {
          taskData.hrf_steps = req.body.hrf_steps;
        }

        if (params.width * 2 * (params.height * 2) > appConfig.pixelLimit) {
          res.status(400).json({ error: "Image is too large to upscale" });
          return;
        }
        await queueTxt2ImgRequest(req, res, req.user.discord_id, taskData);
      })
      .catch((error) => {
        res.status(400).json({ error: error });
      });
  },
);

router.get("/images/:jobId", async (req, res) => {
  // noinspection JSUnresolvedReference
  const jobId = req.params.jobId.replace(".png", "");
  db.query(
    "SELECT image_data FROM images WHERE id = ?",
    [jobId],
    (error, results) => {
      if (error) {
        res.json({ error: error.message });
      } else {
        if (results.length > 0) {
          if (results[0].image_data === null) {
            res.status(404).json({ error: "Image not found" });
            return;
          }
          const data = results[0].image_data.toString();
          const decodedImage = Buffer.from(data, "base64");
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": decodedImage.length,
          });
          res.end(decodedImage);
        } else {
          res.status(404).json({ error: "Image not found" });
        }
      }
    },
  );
});

router.get("/images/:jobId/info", async (req, res) => {
  const jobId = req.params.jobId;
  db.query("SELECT * FROM images WHERE id = ?", [jobId], (error, results) => {
    if (error) {
      res.json({ error: error.message });
    } else {
      if (results.length > 0) {
        if (results[0].image_data === null) {
          res.status(404).json({ error: "Image not found" });
          return;
        }
        // Check if cached image info is present in DB
        if (results[0].info_data64) {
          // Base64 decode the data and return it
          let buffer = Buffer.from(results[0].info_data64, "base64");
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Content-Length": buffer.length,
          });
          res.end(buffer.toString());
        } else {
          axios
            .post(`${constants.SD_API_HOST}/png-info`, {
              image: results[0].image_data.toString(),
            })
            .then((response) => {
              let paramData = response.data;
              paramData.parameters.owner_id = results[0].owner_id;
              res.json(response.data);
              // Since we didn't have the data in cache, go ahead and persist it to cache
              let buffer = Buffer.from(JSON.stringify(paramData), "utf8");
              let data64 = buffer.toString("base64");
              db.query(
                "UPDATE images SET info_data64 = ? WHERE id = ?",
                [data64, jobId],
                (error, _) => {
                  if (error) {
                    console.error(
                      "Failed to update image info cache: " + error.message,
                    );
                  }
                },
              );
            })
            .catch((error) => {
              res.status(500).json({ error: error.message });
            });
        }
      } else {
        res.status(404).json({ error: "Image not found" });
      }
    }
  });
});

router.get("/previews/:jobId", async (req, res) => {
  const jobId = req.params.jobId.replace(".png", "");
  db.query(
    "SELECT preview_data FROM images WHERE id = ?",
    [jobId],
    (error, results) => {
      if (error) {
        res.json({ error: error.message });
      } else {
        if (results.length > 0) {
          if (results[0].preview_data === null) {
            res.status(404).json({ error: "Preview not found" });
            return;
          }
          const data = results[0].preview_data.toString();
          const decodedImage = Buffer.from(data, "base64");
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": decodedImage.length,
          });
          res.end(decodedImage);
        } else {
          res.status(404).json({ error: "Preview not found" });
        }
      }
    },
  );
});

router.post("/queue/interrupt/:jobId", isAuthenticated, async (req, res) => {
  const jobId = req.params.jobId;
  // Check to see if the currently processing item is the requested Job ID
  if (
    getCurrentlyProcessingItem() !== null &&
    getCurrentlyProcessingItem().job_id === jobId
  ) {
    const currentJob = getCurrentlyProcessingItem();
    // If it is, make sure it's owned by the user requesting the interrupt
    // noinspection JSUnresolvedReference
    if (currentJob.owner_id !== req.user.discord_id) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }
    axios
      .post(`${constants.SD_API_HOST}/interrupt`)
      .then(() => {
        emitToSocketsByIp(
          currentJob.origin,
          "task-interrupted",
          cleanseTask(currentJob),
        );
        res.json({ message: "Task interrupted!", status: "interrupted" });
      })
      .catch((error) => {
        console.error("Error interrupting task: ", error);
        res.status(500).json({ error: error.message });
      });
  } else {
    if (doesQueueContainItem(jobId)) {
      removeQueueItem(jobId);
      res.json({ message: "Task removed!", status: "removed" });
      // Since the Job ID was allocated and saved into the database, it should be removed since it'll never be used.
      await database.asyncQuery("DELETE FROM images WHERE id = ?", [jobId]);
    } else {
      res.status(404).json({ error: "Task not found" });
    }
  }
});

function createImageJobInDB(job) {
  return new Promise((resolve, reject) => {
    db.query(
      "INSERT INTO images (id, owner_id, category_id) VALUES (?,?,?)",
      [job.job_id, job.owner_id, job.categoryId],
      (error, _) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });
}

module.exports = { router };
