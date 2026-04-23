import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { CreateDeploymentForm } from "../components/create-deployment-form";
import { DeploymentDetails } from "../components/deployment-details";
import { DeploymentList } from "../components/deployment-list";
import { createDeployment, listDeployments } from "../lib/api";
import { useDeploymentStream } from "../hooks/use-deployment-stream";
import { usePlatformEvents } from "../hooks/use-platform-events";
import type { DeploymentSummary } from "../types";

export function HomePage() {
  const queryClient = useQueryClient();
  usePlatformEvents();

  const deploymentsQuery = useQuery({
    queryKey: ["deployments"],
    queryFn: listDeployments
  });

  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createDeployment,
    onSuccess: async (deployment) => {
      queryClient.setQueryData<DeploymentSummary[]>(["deployments"], (current) => {
        const next = [deployment, ...(current ?? []).filter((item) => item.id !== deployment.id)];
        next.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return next;
      });
      setSelectedDeploymentId(deployment.id);
    }
  });

  const deployments = deploymentsQuery.data ?? [];

  useEffect(() => {
    if (!deployments.length) {
      setSelectedDeploymentId(null);
      return;
    }

    if (!selectedDeploymentId || !deployments.some((deployment) => deployment.id === selectedDeploymentId)) {
      setSelectedDeploymentId(deployments[0]?.id ?? null);
    }
  }, [deployments, selectedDeploymentId]);

  const selectedDeployment = useMemo(
    () => deployments.find((deployment) => deployment.id === selectedDeploymentId) ?? null,
    [deployments, selectedDeploymentId]
  );

  const stream = useDeploymentStream(selectedDeploymentId);
  const deploymentForDetails = stream.snapshot?.deployment ?? selectedDeployment;
  const logsForDetails = stream.snapshot?.logs ?? [];

  return (
    <main className="page-shell">
      <section className="hero">
        <p className="eyebrow">Brimble Infra Interview</p>
        <h1>Deploy local apps with Railpack, Docker, Caddy, and live streaming logs.</h1>
        <p className="hero-copy">
          This one-pager creates deployments from a Git URL or a ZIP upload, tracks the state machine,
          stores logs in SQLite, and streams updates back over SSE while Caddy fronts the running
          containers.
        </p>
      </section>

      <section className="dashboard-grid">
        <div className="left-rail">
          <CreateDeploymentForm
            isSubmitting={createMutation.isPending}
            onSubmit={async (input) => {
              await createMutation.mutateAsync(input);
            }}
          />

          {deploymentsQuery.isLoading ? (
            <section className="panel">
              <p>Loading deployments...</p>
            </section>
          ) : null}

          {deploymentsQuery.error ? (
            <section className="panel">
              <p className="form-error">
                {deploymentsQuery.error instanceof Error
                  ? deploymentsQuery.error.message
                  : "Failed to load deployments"}
              </p>
            </section>
          ) : null}

          <DeploymentList
            deployments={deployments}
            selectedDeploymentId={selectedDeploymentId}
            onSelect={setSelectedDeploymentId}
          />
        </div>

        <DeploymentDetails
          deployment={deploymentForDetails}
          logs={logsForDetails}
          isConnecting={stream.isConnecting}
          streamError={stream.error}
        />
      </section>
    </main>
  );
}

