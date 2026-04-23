import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { config, paths } from "./config.js";
import { AppDatabase } from "./db.js";
import { asyncHandler } from "./lib/async-handler.js";
import { EventBus } from "./lib/event-bus.js";
import { CaddyService } from "./services/caddy-service.js";
import {
  createDeploymentSlug,
  DeploymentRunner,
  ensureDataDirectories,
  inferSourceLabel,
  isValidGitUrl
} from "./services/deployment-runner.js";
import type { DeploymentSnapshot, PlatformEvent } from "./types.js";
import { toDeploymentSummary } from "./types.js";

function writeSseEvent(response: Response, event: string, payload: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function beginSse(response: Response): NodeJS.Timeout {
  response.status(200);
  response.setHeader("content-type", "text/event-stream");
  response.setHeader("cache-control", "no-cache, no-transform");
  response.setHeader("connection", "keep-alive");
  response.flushHeaders();

  return setInterval(() => {
    response.write(": keepalive\n\n");
  }, 15000);
}

async function main(): Promise<void> {
  await ensureDataDirectories();

  const database = new AppDatabase(paths.databaseFile);
  const events = new EventBus();
  const caddy = new CaddyService();
  const runner = new DeploymentRunner(database, events, caddy);

  try {
    await runner.bootstrap();
  } catch (error) {
    console.error("Initial Caddy sync failed", error);
  }

  const app = express();
  const upload = multer({
    dest: paths.uploadsDir,
    limits: {
      fileSize: 100 * 1024 * 1024
    }
  });

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/deployments", (_request, response) => {
    response.json({
      deployments: database.listDeployments().map(toDeploymentSummary)
    });
  });

  app.post(
    "/api/deployments",
    upload.single("projectArchive"),
    asyncHandler(async (request, response) => {
      const sourceType = String(request.body.sourceType ?? "").trim();

      if (sourceType !== "git" && sourceType !== "upload") {
        response.status(400).json({
          error: "sourceType must be either git or upload"
        });
        return;
      }

      let gitUrl: string | undefined;
      let uploadFilename: string | undefined;

      if (sourceType === "git") {
        gitUrl = String(request.body.gitUrl ?? "").trim();

        if (!gitUrl || !isValidGitUrl(gitUrl)) {
          response.status(400).json({
            error: "Please provide a valid Git URL"
          });
          return;
        }
      }

      if (sourceType === "upload") {
        if (!request.file) {
          response.status(400).json({
            error: "Please attach a .zip archive to upload a project"
          });
          return;
        }

        if (!request.file.originalname.toLowerCase().endsWith(".zip")) {
          response.status(400).json({
            error: "Uploaded projects must be provided as a .zip archive"
          });
          return;
        }

        uploadFilename = request.file.originalname;
      }

      const id = randomUUID();
      const slug = createDeploymentSlug();
      const sourceLabel = inferSourceLabel(sourceType, gitUrl ?? uploadFilename ?? "upload");

      const deployment = database.createDeployment({
        id,
        slug,
        sourceType,
        sourceLabel,
        gitUrl,
        uploadFilename,
        status: "pending"
      });

      const summary = toDeploymentSummary(deployment);
      events.publish({
        type: "deployment",
        deployment: summary
      });

      runner.enqueue({
        deploymentId: deployment.id,
        sourceType,
        gitUrl,
        archivePath: request.file?.path
      });

      response.status(201).json({
        deployment: summary
      });
    })
  );

  app.get("/api/events", (request, response) => {
    const keepAlive = beginSse(response);

    writeSseEvent(response, "snapshot", {
      deployments: database.listDeployments().map(toDeploymentSummary)
    });

    const unsubscribe = events.subscribe((event) => {
      if (event.type === "deployment") {
        writeSseEvent(response, "deployment", event.deployment);
      }
    });

    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  app.get("/api/deployments/:deploymentId/stream", (request, response) => {
    const deployment = database.getDeployment(request.params.deploymentId);

    if (!deployment) {
      response.status(404).json({
        error: "Deployment not found"
      });
      return;
    }

    const keepAlive = beginSse(response);
    const snapshot: DeploymentSnapshot = {
      deployment: toDeploymentSummary(deployment),
      logs: database.listLogs(deployment.id)
    };

    writeSseEvent(response, "snapshot", snapshot);

    const unsubscribe = events.subscribe((event: PlatformEvent) => {
      if (event.type === "deployment" && event.deployment.id === deployment.id) {
        writeSseEvent(response, "deployment", event.deployment);
      }

      if (event.type === "log" && event.deploymentId === deployment.id) {
        writeSseEvent(response, "log", event.entry);
      }
    });

    request.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  if (fs.existsSync(config.frontendDistDir)) {
    app.use(express.static(config.frontendDistDir));
  }

  app.get("*", (_request, response) => {
    const indexFile = path.join(config.frontendDistDir, "index.html");

    if (fs.existsSync(indexFile)) {
      response.sendFile(indexFile);
      return;
    }

    response.status(503).send("Frontend assets have not been built yet.");
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected server error"
    });
  });

  app.listen(config.port, () => {
    console.log(`Backend listening on port ${config.port}`);
  });
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
