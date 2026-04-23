import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { DeploymentSummary } from "../types";

function upsertDeployments(
  current: DeploymentSummary[] | undefined,
  incoming: DeploymentSummary
): DeploymentSummary[] {
  const next = [...(current ?? [])];
  const existingIndex = next.findIndex((deployment) => deployment.id === incoming.id);

  if (existingIndex >= 0) {
    next[existingIndex] = incoming;
  } else {
    next.unshift(incoming);
  }

  next.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return next;
}

export function usePlatformEvents(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const eventSource = new EventSource("/api/events");

    const handleSnapshot = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as { deployments: DeploymentSummary[] };
      queryClient.setQueryData(["deployments"], payload.deployments);
    };

    const handleDeployment = (event: MessageEvent<string>) => {
      const deployment = JSON.parse(event.data) as DeploymentSummary;
      queryClient.setQueryData<DeploymentSummary[]>(["deployments"], (current) =>
        upsertDeployments(current, deployment)
      );
    };

    eventSource.addEventListener("snapshot", handleSnapshot as EventListener);
    eventSource.addEventListener("deployment", handleDeployment as EventListener);

    return () => {
      eventSource.close();
    };
  }, [queryClient]);
}

