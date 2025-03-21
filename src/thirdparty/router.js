import { CivitAi } from "./civitai";
import {
  doesFileExist,
  downloadFileToPath,
  getAvailableStorage,
} from "@/storage";
import { Router } from "express";
import { isArtificer, isAuthenticated } from "@/security";
import axios from "axios";
import { getFolderPathForModelType } from "@/types/thirdparty/civitai";
import path from "node:path";
import * as constants from "@/constants";
import { emitToAll } from "@/processing/socketManager";

const civitai = new CivitAi();
export const thirdPartyRouter = new Router();

thirdPartyRouter.get("/test_civitai", async (req, res) => {
  let isAuthenticated = await civitai.isAuthenticated().catch((_) => {
    console.error("Request to CivitAI failed");
    return false;
  });
  res.json({ isAuthenticated });
});

thirdPartyRouter.get(
  "/civitai/downloads_enabled",
  isAuthenticated,
  async (req, res) => {
    if (process.env.MODEL_DIR === undefined) {
      // Can't perform downloads if the directory needed for this is undefined
      res.json({ downloadsEnabled: false, message: "Model directory not set" });
      return;
    }
    if (!(await civitai.isAuthenticated())) {
      res.json({
        downloadsEnabled: false,
        message: "CivitAI authentication failed",
      });
      return;
    }

    res.json({ downloadsEnabled: true });
  },
);

thirdPartyRouter.get(
  "/civitai/download/:modelVersionId",
  isAuthenticated,
  isArtificer,
  async (req, res) => {
    let modelId = req.params.modelVersionId;

    const baseModelDir = process.env.MODEL_DIR;

    if (baseModelDir === undefined || baseModelDir === "") {
      res.status(500).json({ message: "Model directory not set" });
      return;
    }

    if (!(await civitai.isAuthenticated())) {
      res.status(500).json({ message: "CivitAI authentication failed" });
      return;
    }

    // Attempt to grab the Model Version information from CivitAI
    let data = await civitai.getModelVersionById(modelId);
    if (!data) {
      res.status(404).json({ message: "Model not found" });
      return;
    }

    // Check the type of model it is and grab the folder path based off that
    let modelFolderPath = baseModelDir;

    try {
      let modelTypeDir = getFolderPathForModelType(data.model.type);
      if (modelTypeDir) {
        modelFolderPath = `${baseModelDir}/${modelTypeDir}`;
      }
    } catch (e) {
      // This function throws an error if the model type is unsupported, let the client know
      res.status(400).json({ message: "Unsupported model type" });
      return;
    }

    modelFolderPath = path.resolve(modelFolderPath);

    // Find the first file that has "primary = true"
    let primaryFile = data.files.find((f) => f.primary);

    // Check to see if the file exists in the specified location
    if (doesFileExist(`${modelFolderPath}/${primaryFile.name}`)) {
      res.status(400).json({ message: "Model already downloaded" });
      return;
    }

    console.log("Preparing to download model to: ", modelFolderPath);

    let storagePercentage = await getAvailableStorage(modelFolderPath);

    if (storagePercentage < 10) {
      res
        .status(500)
        .json({ message: "Low storage space", error: "LOW_STORAGE_SPACE" });
      return;
    }

    console.log("Storage check passed; Space available: ", storagePercentage);

    try {
      console.log(
        "Downloading model to: ",
        `${modelFolderPath}/${primaryFile.name}`,
      );
      await downloadFileToPath(
        `${data.downloadUrl}?token=${civitai.getApiKey()}`,
        `${modelFolderPath}/${primaryFile.name}`,
      );
      res.json({ message: "Model downloaded" });
      console.log("Model downloaded successfully! Reloading Forge...");
      // Fire off a quick refresh to the Forge backend to reload models
      const refreshEndpointNames = [
        "refresh-embeddings",
        "refresh-checkpoints",
        "refresh-loras",
      ];
      for (const endpointName of refreshEndpointNames) {
        try {
          const url = `${constants.SD_API_HOST}/${endpointName}`;
          await axios.post(url);
        } catch (e) {
          console.error(
            "Failed to request refresh of models from Forge backend: ",
            e,
          );
        }
      }

      console.log(
        "Successfully requested refresh of models from Forge backend",
      );
      // Advise websocket clients that the available models have changed
      emitToAll(
        "models-refreshed",
        JSON.stringify({
          message: "Models refreshed by CivitAI download",
        }),
      );
    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Internal Server Error" });
    }
  },
);

thirdPartyRouter.get(
  "/civitai/api-proxy/*",
  isAuthenticated,
  async (req, res) => {
    // Proxies API requests from downstream clients to CivitAI with our API key (and to bypass CORS)
    try {
      const requestedPath = req.params[0];
      const queryParams = req.query;
      const upstreamUrl = `https://civitai.com/api/v1/${requestedPath}`;
      let upstreamResponse = await axios.get(upstreamUrl, {
        params: queryParams,
        headers: {
          Authorization: `Bearer ${civitai.getApiKey()}`,
          "User-Agent": "Navigator",
        },
      });
      res.status(upstreamResponse.status).json(upstreamResponse.data);
    } catch (error) {
      if (error.response) {
        // The upstream API returned an error status code
        res.status(error.response.status).json(error.response.data);
      } else if (error.request) {
        // The request was made, but no response was received
        res.status(500).send("Upstream API did not respond");
      } else {
        // Something happened in setting up the request that triggered an Error
        res.status(500).send("An error occurred");
        console.error(error);
      }
    }
  },
);
