import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import unzipper from "unzipper";

function isSubPath(parentDir: string, childPath: string): boolean {
  const relative = path.relative(parentDir, childPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.promises.mkdir(directoryPath, { recursive: true });
}

export async function recreateDirectory(directoryPath: string): Promise<void> {
  await fs.promises.rm(directoryPath, { recursive: true, force: true });
  await ensureDirectory(directoryPath);
}

export async function removeIfExists(filePath: string): Promise<void> {
  await fs.promises.rm(filePath, { recursive: true, force: true });
}

export async function resolveProjectRoot(directoryPath: string): Promise<string> {
  let current = directoryPath;

  for (;;) {
    const entries = (await fs.promises.readdir(current, { withFileTypes: true })).filter(
      (entry) => entry.name !== "__MACOSX"
    );

    if (entries.length !== 1 || !entries[0]?.isDirectory()) {
      return current;
    }

    current = path.join(current, entries[0].name);
  }
}

export async function extractZipArchive(archivePath: string, destinationDir: string): Promise<string> {
  await ensureDirectory(destinationDir);

  const archive = await unzipper.Open.file(archivePath);

  for (const entry of archive.files) {
    const normalizedPath = path.posix.normalize(entry.path).replace(/^\/+/, "");

    if (!normalizedPath || normalizedPath.startsWith("../") || normalizedPath.includes("/../")) {
      throw new Error(`Archive entry ${entry.path} resolves outside the workspace`);
    }

    if (normalizedPath.startsWith("__MACOSX/")) {
      continue;
    }

    const targetPath = path.resolve(destinationDir, normalizedPath);
    if (!isSubPath(destinationDir, targetPath)) {
      throw new Error(`Archive entry ${entry.path} resolves outside the workspace`);
    }

    if (entry.type === "Directory") {
      await ensureDirectory(targetPath);
      continue;
    }

    await ensureDirectory(path.dirname(targetPath));
    await pipeline(entry.stream(), fs.createWriteStream(targetPath));
  }

  return resolveProjectRoot(destinationDir);
}

