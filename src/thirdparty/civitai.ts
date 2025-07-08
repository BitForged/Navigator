import axios, { isAxiosError } from "axios";
import {
  CivitAiModelResponse,
  CivitAiModelVersion,
  isCivitAiModelVersion,
} from "@/types/thirdparty/civitai";
import * as database from "@/database";
import { ModelMetadataProvider } from "@/types/enums";

export class CivitAi {
  apiKey: string | undefined = "";
  CIVIT_AI_API_URL = "https://civitai.com/api/v1";
  constructor() {
    this.apiKey = process.env.CIVITAI_API_KEY;
  }

  getApiKey() {
    return this.apiKey || process.env.CIVITAI_API_KEY;
  }

  /**
   * Constructs the full URL for a given endpoint by appending it to the base API URL.
   *
   * @param {string} endpoint - The specific API endpoint to be appended to the base URL.
   * @return {string} The full URL constructed by combining the base API URL and the provided endpoint.
   */
  getEndpoint(endpoint: string): string {
    return `${this.CIVIT_AI_API_URL}/${endpoint}`;
  }

  /**
   * Checks if the current session is authenticated by making a test API request.
   *
   * @return {Promise<boolean>} Returns a promise that resolves to true if the response status is 200, indicating successful authentication, otherwise false.
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      let resp = await axios.get(
        `${this.getEndpoint("models")}?hidden=1&limit=1`,
        {
          headers: {
            Authorization: "Bearer " + this.apiKey || "",
          },
        },
      );
      return resp.status === 200;
    } catch (err) {
      console.error(`Failed to check CivitAI for authentication: ${err}`);
      return false;
    }
  }

  /**
   * Retrieves the latest download URL for a specified model based on its ID.
   * The method also considers certain conditions, such as environment support for specific models.
   *
   * @param {number} modelId - The unique identifier of the model to retrieve the download URL for.
   * @return {Promise<string | undefined>} A promise that resolves to the download URL of the model if found and accessible, or undefined if the model is not available or the user is not authenticated.
   */
  async getModelDownloadUrl(modelId: number): Promise<string | undefined> {
    if (!(await this.isAuthenticated())) {
      return;
    }

    try {
      let resp = await axios.get<CivitAiModelResponse>(
        `${this.getEndpoint("models")}/${modelId}`,
        {
          headers: {
            Authorization: "Bearer " + this.apiKey,
          },
        },
      );

      if (resp.status !== 200) {
        console.error("Error getting model data: ");
        return;
      }

      const data = resp.data;

      for (let modelVersion of data.modelVersions) {
        if (
          modelVersion.baseModel.indexOf("Flux") !== -1 &&
          process.env.SUPPORTS_FLUX !== true
        ) {
          // Skip this model version if it is a Flux model and the environment does not support it.
          continue;
        }
        console.log(modelVersion.files);
        return modelVersion.files[0].downloadUrl;
        // TODO: Expand this to possibly include other data, such as the SHA256 hash of the model.
      }
      return;
    } catch (error) {
      if (isAxiosError(error)) {
        console.error(error.response?.data);
      } else {
        console.error(
          "Unknown error occurred when checking for matching model version: ",
          error,
        );
      }
      return;
    }
  }

  /**
   * Fetches a model version based on the provided hash.
   * Makes a request to the API to retrieve the model version associated with the given hash,
   * if the user is authenticated.
   *
   * @param {string} hash - The hash value of the model version to be retrieved.
   * @return {Promise<CivitAiModelVersion | undefined>} A promise that resolves to the
   * CivitAiModelVersion object if found, or undefined if the user is not authenticated or
   * the model version is not found.
   */
  async getModelVersionByHash(
    hash: string,
  ): Promise<CivitAiModelVersion | undefined> {
    if (!(await this.isAuthenticated())) {
      console.error(
        "Not authenticated and and therefore unable to fetch model version from CivitAI!",
      );
      return;
    }

    try {
      let resp = await axios.get<CivitAiModelVersion>(
        `${this.getEndpoint(`model-versions/by-hash/${hash}`)}`,
        {
          headers: {
            Authorization: "Bearer " + this.apiKey,
          },
        },
      );
      delete resp.data.images;
      // Update metadata cache in database
      const modelVersionId = resp.data.id;
      if (modelVersionId === undefined || modelVersionId === null) {
        console.error("!!Model version ID is null or undefined!", resp.data);
        return undefined;
      }
      return resp.data;
    } catch (error) {
      if (isAxiosError(error)) {
        console.error(error.response?.data);
      } else {
        console.error(
          "Unknown error occurred when checking for matching model version: ",
          error,
        );
      }
      return;
    }
  }

  async getModelVersionById(
    id: number,
  ): Promise<CivitAiModelVersion | undefined> {
    if (!(await this.isAuthenticated())) {
      console.error(
        "Not authenticated and and therefore unable to fetch model version (not in cache)!",
      );
      return;
    }

    try {
      let resp = await axios.get<CivitAiModelVersion>(
        `${this.getEndpoint(`model-versions/${id}`)}`,
        {
          headers: {
            Authorization: "Bearer " + this.apiKey,
          },
        },
      );
      delete resp.data.images;
      // Update metadata cache in database
      const modelVersionId = resp.data.id;
      if (modelVersionId === undefined || modelVersionId === null) {
        console.error("!!Model version ID is null or undefined!", resp.data);
        return undefined;
      }
      return resp.data;
    } catch (error) {
      if (isAxiosError(error)) {
        console.error(error.response?.data);
        console.error(
          "An error was returned from the CivitAI API: ",
          error.response?.status,
        );
      } else {
        console.error(
          "Unknown error occurred when checking for matching model version: ",
          error,
        );
      }
      return;
    }
  }
}

// module.exports = CivitAi;
