import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { buildDeploymentUrl, config, paths } from "../config.js";
import { AppDatabase } from "../db.js";
import { EventBus } from "../lib/event-bus.js";
import type {
  DeploymentLogEntry,
  DeploymentLogLevel,
  DeploymentLogPhase,
  DeploymentRecord,
  DeploymentSourceType,
  DeploymentSummary,
  DeploymentStatus
} from "../types.js";
import { toDeploymentSummary } from "../types.js";
import { extractZipArchive, recreateDirectory, removeIfExists, resolveProjectRoot } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";
import { CaddyService } from "./caddy-service.js";

export interface EnqueueDeploymentJob {
  deploymentId: string;
  sourceType: DeploymentSourceType;
  gitUrl?: string;
  archivePath?: string;
}

export class DeploymentRunner {
  private queue = Promise.resolve();

  constructor(
    private readonly database: AppDatabase,
    private readonly events: EventBus,
    private readonly caddy: CaddyService
  ) {}

  enqueue(job: EnqueueDeploymentJob): void {
    this.queue = this.queue
      .then(async () => {
        await this.run(job);
      })
      .catch((error) => {
        console.error("Deployment queue error", error);
      });
  }

  async bootstrap(): Promise<void> {
    await this.caddy.syncRoutes(this.database.getRunningDeployments());
  }

  private async run(job: EnqueueDeploymentJob): Promise<void> {
    const deployment = this.requireDeployment(job.deploymentId);
    const workspaceDir = path.join(paths.workspacesDir, deployment.slug);
    const sourceDir = path.join(workspaceDir, "source");
    const imageTag = `${deployment.slug}:latest`;
    const containerName = `deployment-${deployment.slug}`;

    try {
      await this.transition(deployment.id, "building");
      await recreateDirectory(workspaceDir);
      await this.log(deployment.id, "system", "Workspace prepared");

      const projectRoot = await this.prepareSource(job, sourceDir);

      await this.updateDeployment(deployment.id, {
        imageTag,
        failureReason: null
      });

      await this.log(
        deployment.id,
        "build",
        `Running Railpack build for ${projectRoot}`,
        "info"
      );

      await runCommand({
        command: "railpack",
        args: ["build", "--name", imageTag, "--progress", "plain", projectRoot],
        cwd: projectRoot,
        env: {
          ...process.env,
          BUILDKIT_HOST: config.buildkitHost
        },
        onLine: (stream, line) => {
          void this.log(
            deployment.id,
            "build",
            line,
            stream === "stderr" ? "stderr" : "info"
          );
        }
      });

      await this.transition(deployment.id, "deploying");
      await this.stopExistingContainer(containerName, deployment.id);

      await this.log(
        deployment.id,
        "deploy",
        `Starting ${containerName} on ${config.dockerNetwork}`
      );

      await runCommand({
        command: "docker",
        args: [
          "run",
          "-d",
          "--name",
          containerName,
          "--network",
          config.dockerNetwork,
          "--label",
          "brimble.managed=true",
          "--label",
          `brimble.deployment_id=${deployment.id}`,
          "-e",
          `PORT=${config.deploymentPort}`,
          imageTag
        ],
        onLine: (stream, line) => {
          void this.log(
            deployment.id,
            "deploy",
            line,
            stream === "stderr" ? "stderr" : "info"
          );
        }
      });

      await this.waitForContainerReady(containerName, deployment.id);

      const liveUrl = buildDeploymentUrl(deployment.slug);
      await this.updateDeployment(deployment.id, {
        status: "running",
        containerName,
        liveUrl,
        failureReason: null
      });

      await this.caddy.syncRoutes(this.database.getRunningDeployments());
      await this.captureRuntimeSnapshot(containerName, deployment.id);
      await this.log(deployment.id, "deploy", `Deployment is live at ${liveUrl}`);
    } catch (error) {
      await this.handleFailure(deployment.id, containerName, error);
    } finally {
      if (job.archivePath) {
        await removeIfExists(job.archivePath);
      }
    }
  }

  private async prepareSource(job: EnqueueDeploymentJob, destinationDir: string): Promise<string> {
    if (job.sourceType === "git") {
      if (!job.gitUrl) {
        throw new Error("Missing git URL for git deployment");
      }

      await this.log(
        job.deploymentId,
        "source",
        `Cloning ${job.gitUrl}`
      );

      await runCommand({
        command: "git",
        args: ["clone", "--depth", "1", job.gitUrl, destinationDir],
        onLine: (stream, line) => {
          void this.log(
            job.deploymentId,
            "source",
            line,
            stream === "stderr" ? "stderr" : "info"
          );
        }
      });

      return resolveProjectRoot(destinationDir);
    }

    if (!job.archivePath) {
      throw new Error("Missing uploaded archive for upload deployment");
    }

    await this.log(job.deploymentId, "source", "Extracting uploaded project");
    return extractZipArchive(job.archivePath, destinationDir);
  }

  private async waitForContainerReady(containerName: string, deploymentId: string): Promise<void> {
    const endpoint = `http://${containerName}:${config.deploymentPort}/`;

    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        const response = await fetch(endpoint);
        if (response.ok) {
          await this.log(deploymentId, "deploy", `Container responded on ${endpoint}`);
          return;
        }
      } catch {
        if (attempt === 1) {
          await this.log(deploymentId, "deploy", "Waiting for the container to accept traffic");
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("Container did not become reachable after 30 seconds");
  }

  private async stopExistingContainer(containerName: string, deploymentId: string): Promise<void> {
    await this.log(deploymentId, "deploy", `Cleaning up any previous ${containerName}`);

    try {
      await runCommand({
        command: "docker",
        args: ["rm", "-f", containerName]
      });
    } catch {
      await this.log(deploymentId, "deploy", "No previous container was running");
    }
  }

  private async captureRuntimeSnapshot(containerName: string, deploymentId: string): Promise<void> {
    try {
      await runCommand({
        command: "docker",
        args: ["logs", "--tail", "20", containerName],
        onLine: (stream, line) => {
          void this.log(
            deploymentId,
            "runtime",
            line,
            stream === "stderr" ? "stderr" : "info"
          );
        }
      });
    } catch {
      await this.log(deploymentId, "runtime", "Runtime log snapshot was unavailable");
    }
  }

  private async handleFailure(
    deploymentId: string,
    containerName: string,
    error: unknown
  ): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);

    await this.log(deploymentId, "system", reason, "error");
    await this.updateDeployment(deploymentId, {
      status: "failed",
      failureReason: reason,
      liveUrl: null,
      containerName: null
    });

    try {
      await runCommand({
        command: "docker",
        args: ["logs", "--tail", "50", containerName],
        onLine: (stream, line) => {
          void this.log(
            deploymentId,
            "runtime",
            line,
            stream === "stderr" ? "stderr" : "info"
          );
        }
      });
    } catch {
      await this.log(deploymentId, "runtime", "No container logs were available after failure");
    }

    try {
      await runCommand({
        command: "docker",
        args: ["rm", "-f", containerName]
      });
    } catch {
      // Ignore cleanup errors so the original failure remains the main signal.
    }

    try {
      await this.caddy.syncRoutes(this.database.getRunningDeployments());
    } catch (syncError) {
      console.error("Failed to sync Caddy after deployment failure", syncError);
    }
  }

  private requireDeployment(deploymentId: string): DeploymentRecord {
    const deployment = this.database.getDeployment(deploymentId);

    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    return deployment;
  }

  private async transition(
    deploymentId: string,
    status: DeploymentStatus
  ): Promise<DeploymentSummary> {
    return this.updateDeployment(deploymentId, {
      status
    });
  }

  private async updateDeployment(
    deploymentId: string,
    patch: {
      status?: DeploymentStatus;
      imageTag?: string | null;
      liveUrl?: string | null;
      containerName?: string | null;
      failureReason?: string | null;
    }
  ): Promise<DeploymentSummary> {
    const updated = this.database.updateDeployment(deploymentId, patch);
    const summary = toDeploymentSummary(updated);
    this.events.publish({
      type: "deployment",
      deployment: summary
    });
    return summary;
  }

  async log(
    deploymentId: string,
    phase: DeploymentLogPhase,
    message: string,
    level: DeploymentLogLevel = "info"
  ): Promise<DeploymentLogEntry> {
    const normalized = message.trim();
    if (!normalized) {
      return this.database.insertLog({
        deploymentId,
        phase,
        level,
        message: ""
      });
    }

    const entry = this.database.insertLog({
      deploymentId,
      phase,
      level,
      message: normalized
    });

    this.events.publish({
      type: "log",
      deploymentId,
      entry
    });

    return entry;
  }
}

export function createDeploymentSlug(): string {
  return `deploy-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
}

export function inferSourceLabel(sourceType: DeploymentSourceType, value: string): string {
  if (sourceType === "upload") {
    return value;
  }

  const withoutHash = value.split("#")[0] ?? value;
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash;
  const trimmed = withoutQuery.replace(/\/+$/, "");
  const lastSegment = trimmed.split("/").pop() ?? trimmed;
  return lastSegment.endsWith(".git") ? lastSegment.slice(0, -4) : lastSegment;
}

export function isValidGitUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(value.trim());
}

export async function ensureDataDirectories(): Promise<void> {
  await fs.promises.mkdir(paths.uploadsDir, { recursive: true });
  await fs.promises.mkdir(paths.workspacesDir, { recursive: true });
}
