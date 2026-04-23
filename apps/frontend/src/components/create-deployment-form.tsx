import { useState, type FormEvent } from "react";

type Props = {
  isSubmitting: boolean;
  onSubmit: (input: { sourceType: "git" | "upload"; gitUrl?: string; archive?: File }) => Promise<void>;
};

export function CreateDeploymentForm({ isSubmitting, onSubmit }: Props) {
  const [sourceType, setSourceType] = useState<"git" | "upload">("git");
  const [gitUrl, setGitUrl] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      if (sourceType === "git") {
        if (!gitUrl.trim()) {
          setError("Add a Git URL to create a deployment from a repository.");
          return;
        }

        await onSubmit({
          sourceType,
          gitUrl: gitUrl.trim()
        });
        setGitUrl("");
        return;
      }

      if (!archive) {
        setError("Choose a .zip archive to upload a project.");
        return;
      }

      await onSubmit({
        sourceType,
        archive
      });
      setArchive(null);
      const fileInput = document.getElementById("projectArchive") as HTMLInputElement | null;
      if (fileInput) {
        fileInput.value = "";
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Failed to create deployment");
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Create Deployment</p>
          <h2>Ship a Git repo or a project archive</h2>
        </div>
        <span className="helper-pill">SSE logs enabled</span>
      </div>

      <form className="deploy-form" onSubmit={handleSubmit}>
        <div className="source-toggle" role="radiogroup" aria-label="Deployment source">
          <button
            className={sourceType === "git" ? "source-option is-active" : "source-option"}
            onClick={() => setSourceType("git")}
            type="button"
          >
            Git URL
          </button>
          <button
            className={sourceType === "upload" ? "source-option is-active" : "source-option"}
            onClick={() => setSourceType("upload")}
            type="button"
          >
            Upload ZIP
          </button>
        </div>

        {sourceType === "git" ? (
          <label className="field">
            <span>Repository URL</span>
            <input
              placeholder="https://github.com/owner/repo"
              value={gitUrl}
              onChange={(event) => setGitUrl(event.target.value)}
            />
          </label>
        ) : (
          <label className="field">
            <span>Project Archive</span>
            <input
              id="projectArchive"
              accept=".zip,application/zip"
              onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
              type="file"
            />
            <small>ZIP archives only. The bundled sample app lives in `samples/hello-node`.</small>
          </label>
        )}

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-button" disabled={isSubmitting} type="submit">
          {isSubmitting ? "Creating deployment..." : "Create deployment"}
        </button>
      </form>
    </section>
  );
}
