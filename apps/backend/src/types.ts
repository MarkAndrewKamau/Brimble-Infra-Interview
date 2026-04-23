export const DEPLOYMENT_STATUSES = [
  "pending",
  "building",
  "deploying",
  "running",
  "failed"
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_SOURCE_TYPES = ["git", "upload"] as const;

export type DeploymentSourceType = (typeof DEPLOYMENT_SOURCE_TYPES)[number];

export type DeploymentLogLevel = "info" | "stderr" | "error";
export type DeploymentLogPhase = "source" | "build" | "deploy" | "runtime" | "system";

export interface DeploymentRecord {
  id: string;
  slug: string;
  sourceType: DeploymentSourceType;
  sourceLabel: string;
  gitUrl: string | null;
  uploadFilename: string | null;
  status: DeploymentStatus;
  imageTag: string | null;
  liveUrl: string | null;
  containerName: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentSummary {
  id: string;
  slug: string;
  sourceType: DeploymentSourceType;
  sourceLabel: string;
  status: DeploymentStatus;
  imageTag: string | null;
  liveUrl: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentLogEntry {
  id: number;
  deploymentId: string;
  phase: DeploymentLogPhase;
  level: DeploymentLogLevel;
  message: string;
  createdAt: string;
}

export interface DeploymentSnapshot {
  deployment: DeploymentSummary;
  logs: DeploymentLogEntry[];
}

export type PlatformEvent =
  | {
      type: "deployment";
      deployment: DeploymentSummary;
    }
  | {
      type: "log";
      deploymentId: string;
      entry: DeploymentLogEntry;
    };

export function toDeploymentSummary(record: DeploymentRecord): DeploymentSummary {
  return {
    id: record.id,
    slug: record.slug,
    sourceType: record.sourceType,
    sourceLabel: record.sourceLabel,
    status: record.status,
    imageTag: record.imageTag,
    liveUrl: record.liveUrl,
    failureReason: record.failureReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

