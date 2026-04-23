import type { DeploymentSummary } from "../types";

async function handleJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function listDeployments(): Promise<DeploymentSummary[]> {
  const payload = await handleJsonResponse<{ deployments: DeploymentSummary[] }>(
    await fetch("/api/deployments")
  );

  return payload.deployments;
}

export async function createDeployment(input: {
  sourceType: "git" | "upload";
  gitUrl?: string;
  archive?: File;
}): Promise<DeploymentSummary> {
  const formData = new FormData();
  formData.append("sourceType", input.sourceType);

  if (input.sourceType === "git" && input.gitUrl) {
    formData.append("gitUrl", input.gitUrl);
  }

  if (input.sourceType === "upload" && input.archive) {
    formData.append("projectArchive", input.archive);
  }

  const payload = await handleJsonResponse<{ deployment: DeploymentSummary }>(
    await fetch("/api/deployments", {
      method: "POST",
      body: formData
    })
  );

  return payload.deployment;
}

