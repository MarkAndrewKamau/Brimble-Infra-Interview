import { spawn } from "node:child_process";

type OutputStream = "stdout" | "stderr";

export interface RunCommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (stream: OutputStream, line: string) => void;
}

export interface RunCommandResult {
  stdout: string;
  stderr: string;
}

function forwardLines(
  streamName: OutputStream,
  chunk: Buffer | string,
  carry: string,
  lines: string[],
  onLine?: (stream: OutputStream, line: string) => void
): string {
  const combined = `${carry}${chunk.toString("utf8")}`;
  const pieces = combined.split(/\r?\n/);
  const nextCarry = pieces.pop() ?? "";

  for (const piece of pieces) {
    lines.push(piece);
    onLine?.(streamName, piece);
  }

  return nextCarry;
}

export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    let stdoutCarry = "";
    let stderrCarry = "";

    child.stdout.on("data", (chunk) => {
      stdoutCarry = forwardLines("stdout", chunk, stdoutCarry, stdoutLines, options.onLine);
    });

    child.stderr.on("data", (chunk) => {
      stderrCarry = forwardLines("stderr", chunk, stderrCarry, stderrLines, options.onLine);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (stdoutCarry) {
        stdoutLines.push(stdoutCarry);
        options.onLine?.("stdout", stdoutCarry);
      }

      if (stderrCarry) {
        stderrLines.push(stderrCarry);
        options.onLine?.("stderr", stderrCarry);
      }

      if (code === 0) {
        resolve({
          stdout: stdoutLines.join("\n"),
          stderr: stderrLines.join("\n")
        });
        return;
      }

      reject(
        new Error(
          `${options.command} ${options.args.join(" ")} exited with code ${code ?? "unknown"}`
        )
      );
    });
  });
}

