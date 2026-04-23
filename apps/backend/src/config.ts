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
