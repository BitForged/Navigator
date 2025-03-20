import { ForgeLoraResponse } from "@/types/thirdparty/forge";
import { SD_API_HOST } from "@/constants";
import axios, { AxiosResponse, isAxiosError } from "axios";

export async function getLorasFromForge(): Promise<ForgeLoraResponse> {
  if (!process.env.ENABLE_LORA_REQUESTS) {
    return [];
  }
  try {
    const response: AxiosResponse<ForgeLoraResponse> =
      await axios.get<ForgeLoraResponse>(`${SD_API_HOST}/loras`);
    // Remove tag frequency as its not really necessary currently
    for (const lora of response.data) {
      delete lora.metadata?.ss_tag_frequency;
      delete lora.metadata?.ss_bucket_info;
      delete lora.metadata?.ss_datasets;
      delete lora.metadata?.ss_dataset_dirs;
    }
    return response.data;
  } catch (error) {
    if (isAxiosError(error)) {
      console.error(
        "A network error occurred when requesting Loras: ",
        error.response?.data,
      );
    } else {
      console.error("An unknown error occurred when requesting Loras: ", error);
    }

    return [];
  }
}
