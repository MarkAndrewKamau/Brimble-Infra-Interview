export type DeploymentStatus = "pending" | "building" | "deploying" | "running" | "failed";
export type DeploymentSourceType = "git" | "upload";
export type DeploymentLogPhase = "source" | "build" | "deploy" | "runtime" | "system";
export type DeploymentLogLevel = "info" | "stderr" | "error";

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

