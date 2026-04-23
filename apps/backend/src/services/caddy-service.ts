import { config } from "../config.js";
import type { DeploymentRecord } from "../types.js";

function buildProxyHandlers(dial: string) {
  return [
    {
      handler: "encode",
      encodings: {
        gzip: {},
        zstd: {}
      },
      prefer: ["zstd", "gzip"]
    },
    {
      handler: "reverse_proxy",
      upstreams: [
        {
          dial
        }
      ]
    }
  ];
}

function buildCaddyConfig(deployments: DeploymentRecord[]) {
  const deploymentRoutes = deployments
    .filter((deployment) => deployment.containerName)
    .map((deployment) => ({
      match: [
        {
          host: [`${deployment.slug}${config.deploymentHostSuffix}`]
        }
      ],
      handle: buildProxyHandlers(`${deployment.containerName}:${config.deploymentPort}`),
      terminal: true
    }));

  return {
    admin: {
      listen: "0.0.0.0:2019"
    },
    apps: {
      http: {
        servers: {
          edge: {
            listen: [":80"],
            routes: [
              ...deploymentRoutes,
              {
                handle: buildProxyHandlers(config.backendUpstream)
              }
            ],
            automatic_https: {
              disable: true
            }
          }
        }
      }
    }
  };
}

export class CaddyService {
  async syncRoutes(deployments: DeploymentRecord[]): Promise<void> {
    let attempts = 0;
    let lastError: Error | undefined;

    while (attempts < 20) {
      attempts += 1;

      try {
        const response = await fetch(config.caddyAdminUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(buildCaddyConfig(deployments))
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Caddy sync failed with ${response.status}: ${body}`);
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    throw lastError ?? new Error("Caddy sync failed");
  }
}
