import type { DeploymentSummary } from "../types";

type Props = {
  deployments: DeploymentSummary[];
  selectedDeploymentId: string | null;
  onSelect: (deploymentId: string) => void;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

export function DeploymentList({ deployments, selectedDeploymentId, onSelect }: Props) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Deployments</p>
          <h2>{deployments.length} tracked runs</h2>
        </div>
      </div>

      <div className="deployment-list">
        {deployments.length === 0 ? (
          <div className="empty-state">
            <h3>No deployments yet</h3>
            <p>Create one above to kick off a Railpack build and stream the logs here.</p>
          </div>
        ) : null}

        {deployments.map((deployment) => (
          <button
            key={deployment.id}
            className={selectedDeploymentId === deployment.id ? "deployment-card is-active" : "deployment-card"}
            onClick={() => onSelect(deployment.id)}
            type="button"
          >
            <div className="deployment-card-top">
              <div>
                <strong>{deployment.sourceLabel}</strong>
                <p>{deployment.slug}</p>
              </div>
              <span className={`status-pill status-${deployment.status}`}>{deployment.status}</span>
            </div>

            <div className="deployment-meta">
              <span>{formatTimestamp(deployment.createdAt)}</span>
              <span>{deployment.imageTag ?? "Image pending"}</span>
            </div>

            <div className="deployment-links">
              {deployment.liveUrl ? (
                <a
                  href={deployment.liveUrl}
                  onClick={(event) => event.stopPropagation()}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open live URL
                </a>
              ) : (
                <span>URL pending</span>
              )}

              {deployment.failureReason ? <span className="failure-text">{deployment.failureReason}</span> : null}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
