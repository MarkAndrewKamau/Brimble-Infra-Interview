import path from "node:path";

function readNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeHostSuffix(value: string | undefined): string {
  if (!value) {
    return ".localhost";
  }

  return value.startsWith(".") ? value : `.${value}`;
}

export const config = {
  port: readNumber(process.env.PORT, 3000),
  dataDir: process.env.DATA_DIR ?? path.resolve(process.cwd(), "data"),
  buildkitHost: process.env.BUILDKIT_HOST ?? "docker-container://buildkit",
  dockerNetwork: process.env.DOCKER_NETWORK ?? "brimble-platform",
  caddyAdminUrl: process.env.CADDY_ADMIN_URL ?? "http://caddy:2019/load",
  backendUpstream: process.env.BACKEND_UPSTREAM ?? "backend:3000",
  appBaseUrl: trimTrailingSlash(process.env.APP_BASE_URL ?? "http://localhost"),
  deploymentHostSuffix: normalizeHostSuffix(process.env.DEPLOYMENT_HOST_SUFFIX),
  deploymentPort: readNumber(process.env.DEPLOYMENT_PORT, 8080),
  buildTimeoutMs: readNumber(process.env.BUILD_TIMEOUT_MS, 600000),
  cloneTimeoutMs: readNumber(process.env.CLONE_TIMEOUT_MS, 120000),
  deploymentMemory: process.env.DEPLOYMENT_MEMORY ?? "512m",
  deploymentCpus: process.env.DEPLOYMENT_CPUS ?? "1.0",
  deploymentPidsLimit: readNumber(process.env.DEPLOYMENT_PIDS_LIMIT, 256),
  frontendDistDir: path.resolve(process.cwd(), "apps/frontend/dist")
};

export const paths = {
  databaseFile: path.join(config.dataDir, "deployments.sqlite"),
  uploadsDir: path.join(config.dataDir, "uploads"),
  workspacesDir: path.join(config.dataDir, "workspaces")
};

export function buildDeploymentUrl(slug: string): string {
  return `http://${slug}${config.deploymentHostSuffix}`;
}
