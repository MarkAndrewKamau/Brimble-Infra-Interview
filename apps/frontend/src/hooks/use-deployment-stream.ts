import { useEffect, useState } from "react";

import type { DeploymentLogEntry, DeploymentSnapshot, DeploymentSummary } from "../types";

export function useDeploymentStream(deploymentId: string | null) {
  const [snapshot, setSnapshot] = useState<DeploymentSnapshot | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deploymentId) {
      setSnapshot(null);
      setIsConnecting(false);
      setError(null);
      return;
    }

    setIsConnecting(true);
    setError(null);

    const eventSource = new EventSource(`/api/deployments/${deploymentId}/stream`);

    const handleSnapshot = (event: MessageEvent<string>) => {
      const nextSnapshot = JSON.parse(event.data) as DeploymentSnapshot;
      setSnapshot(nextSnapshot);
      setIsConnecting(false);
    };

    const handleDeployment = (event: MessageEvent<string>) => {
      const deployment = JSON.parse(event.data) as DeploymentSummary;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              deployment
            }
          : {
              deployment,
              logs: []
            }
      );
    };

    const handleLog = (event: MessageEvent<string>) => {
      const entry = JSON.parse(event.data) as DeploymentLogEntry;

      setSnapshot((current) =>
        current
          ? {
              ...current,
              logs: [...current.logs, entry]
            }
          : null
      );
    };

    eventSource.addEventListener("snapshot", handleSnapshot as EventListener);
    eventSource.addEventListener("deployment", handleDeployment as EventListener);
    eventSource.addEventListener("log", handleLog as EventListener);

    eventSource.onerror = () => {
      setIsConnecting(false);
      setError("Live log stream disconnected. Reconnect by selecting the deployment again.");
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [deploymentId]);

  return {
    snapshot,
    isConnecting,
    error
  };
}

