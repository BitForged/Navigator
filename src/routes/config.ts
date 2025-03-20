import { Router } from "express";
import { getApplicationConfig } from "@/types/config";
import app from "@/index";

export const configRouter = Router();

configRouter.get("/limits", (_, res) => {
  const config = getApplicationConfig();
  res.json({
    max_pixels: config.pixelLimit,
  });
});

configRouter.get("/version", (_, res) => {
  res.json(app.versionInfo);
});
