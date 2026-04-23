import { useEffect, useMemo, useRef, useState } from "react";

import type { DeploymentLogEntry, DeploymentSummary } from "../types";

type Props = {
  deployment: DeploymentSummary | null;
  logs: DeploymentLogEntry[];
  isConnecting: boolean;
  streamError: string | null;
};

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleTimeString();
}

export function DeploymentDetails({ deployment, logs, isConnecting, streamError }: Props) {
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport || !stickToBottom) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [logs, stickToBottom]);

  const groupedLogs = useMemo(() => logs, [logs]);

  if (!deployment) {
    return (
      <section className="panel detail-panel empty-detail">
        <p className="eyebrow">Details</p>
        <h2>Select a deployment</h2>
        <p>The build status, image tag, live URL, and logs will appear here.</p>
      </section>
    );
  }

  return (
    <section className="panel detail-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Active Deployment</p>
          <h2>{deployment.sourceLabel}</h2>
        </div>
        <span className={`status-pill status-${deployment.status}`}>{deployment.status}</span>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <span>Image tag</span>
          <strong>{deployment.imageTag ?? "Building..."}</strong>
        </div>
        <div className="detail-card">
          <span>Live URL</span>
          {deployment.liveUrl ? (
            <a href={deployment.liveUrl} rel="noreferrer" target="_blank">
              {deployment.liveUrl}
            </a>
          ) : (
            <strong>Pending route</strong>
          )}
        </div>
        <div className="detail-card">
          <span>Updated</span>
          <strong>{new Date(deployment.updatedAt).toLocaleString()}</strong>
        </div>
      </div>

      {deployment.failureReason ? <p className="form-error">{deployment.failureReason}</p> : null}
      {streamError ? <p className="stream-warning">{streamError}</p> : null}

      <div className="logs-header">
        <div>
          <p className="eyebrow">Build And Deploy Logs</p>
          <h3>{isConnecting ? "Connecting..." : `${groupedLogs.length} lines persisted`}</h3>
        </div>
      </div>

      <div
        className="log-viewer"
        onScroll={(event) => {
          const target = event.currentTarget;
          const nearBottom =
            target.scrollHeight - target.scrollTop - target.clientHeight < 64;
          setStickToBottom(nearBottom);
        }}
        ref={logViewportRef}
      >
        {groupedLogs.length === 0 ? (
          <div className="log-empty">Logs will stream here as soon as the deployment starts moving.</div>
        ) : null}

        {groupedLogs.map((entry) => (
          <div key={entry.id} className={`log-line log-${entry.level}`}>
            <span>{formatTimestamp(entry.createdAt)}</span>
            <strong>{entry.phase}</strong>
            <code>{entry.message}</code>
          </div>
        ))}
      </div>
    </section>
  );
}
