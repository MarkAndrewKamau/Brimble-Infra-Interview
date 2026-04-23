import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type {
  DeploymentLogEntry,
  DeploymentLogLevel,
  DeploymentLogPhase,
  DeploymentRecord,
  DeploymentSourceType,
  DeploymentStatus
} from "./types.js";

type DeploymentRow = {
  id: string;
  slug: string;
  source_type: DeploymentSourceType;
  source_label: string;
  git_url: string | null;
  upload_filename: string | null;
  status: DeploymentStatus;
  image_tag: string | null;
  live_url: string | null;
  container_name: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

type DeploymentLogRow = {
  id: number;
  deployment_id: string;
  phase: DeploymentLogPhase;
  level: DeploymentLogLevel;
  message: string;
  created_at: string;
};

export interface CreateDeploymentInput {
  id: string;
  slug: string;
  sourceType: DeploymentSourceType;
  sourceLabel: string;
  gitUrl?: string | null;
  uploadFilename?: string | null;
  status: DeploymentStatus;
}

export interface UpdateDeploymentInput {
  status?: DeploymentStatus;
  imageTag?: string | null;
  liveUrl?: string | null;
  containerName?: string | null;
  failureReason?: string | null;
}

const DEPLOYMENT_SELECT = `
  select
    id,
    slug,
    source_type,
    source_label,
    git_url,
    upload_filename,
    status,
    image_tag,
    live_url,
    container_name,
    failure_reason,
    created_at,
    updated_at
  from deployments
`;

const UPDATE_COLUMN_MAP: Record<keyof UpdateDeploymentInput, string> = {
  status: "status",
  imageTag: "image_tag",
  liveUrl: "live_url",
  containerName: "container_name",
  failureReason: "failure_reason"
};

function now(): string {
  return new Date().toISOString();
}

function mapDeployment(row: DeploymentRow): DeploymentRecord {
  return {
    id: row.id,
    slug: row.slug,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    gitUrl: row.git_url,
    uploadFilename: row.upload_filename,
    status: row.status,
    imageTag: row.image_tag,
    liveUrl: row.live_url,
    containerName: row.container_name,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapLog(row: DeploymentLogRow): DeploymentLogEntry {
  return {
    id: row.id,
    deploymentId: row.deployment_id,
    phase: row.phase,
    level: row.level,
    message: row.message,
    createdAt: row.created_at
  };
}

export class AppDatabase {
  private readonly db: Database.Database;

  constructor(filename: string) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });

    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      create table if not exists deployments (
        id text primary key,
        slug text not null unique,
        source_type text not null,
        source_label text not null,
        git_url text,
        upload_filename text,
        status text not null,
        image_tag text,
        live_url text,
        container_name text,
        failure_reason text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists deployment_logs (
        id integer primary key autoincrement,
        deployment_id text not null references deployments(id) on delete cascade,
        phase text not null,
        level text not null,
        message text not null,
        created_at text not null
      );

      create index if not exists idx_deployments_status on deployments(status);
      create index if not exists idx_deployment_logs_deployment_id on deployment_logs(deployment_id, id);
    `);
  }

  createDeployment(input: CreateDeploymentInput): DeploymentRecord {
    const timestamp = now();

    this.db
      .prepare(
        `
        insert into deployments (
          id,
          slug,
          source_type,
          source_label,
          git_url,
          upload_filename,
          status,
          created_at,
          updated_at
        )
        values (
          @id,
          @slug,
          @sourceType,
          @sourceLabel,
          @gitUrl,
          @uploadFilename,
          @status,
          @createdAt,
          @updatedAt
        )
      `
      )
      .run({
        id: input.id,
        slug: input.slug,
        sourceType: input.sourceType,
        sourceLabel: input.sourceLabel,
        gitUrl: input.gitUrl ?? null,
        uploadFilename: input.uploadFilename ?? null,
        status: input.status,
        createdAt: timestamp,
        updatedAt: timestamp
      });

    const created = this.getDeployment(input.id);
    if (!created) {
      throw new Error(`Failed to load deployment ${input.id} after insert`);
    }

    return created;
  }

  listDeployments(): DeploymentRecord[] {
    const rows = this.db
      .prepare(`${DEPLOYMENT_SELECT} order by created_at desc`)
      .all() as DeploymentRow[];

    return rows.map(mapDeployment);
  }

  getDeployment(id: string): DeploymentRecord | undefined {
    const row = this.db
      .prepare(`${DEPLOYMENT_SELECT} where id = ?`)
      .get(id) as DeploymentRow | undefined;

    return row ? mapDeployment(row) : undefined;
  }

  getRunningDeployments(): DeploymentRecord[] {
    const rows = this.db
      .prepare(
        `${DEPLOYMENT_SELECT} where status = 'running' and container_name is not null order by created_at desc`
      )
      .all() as DeploymentRow[];

    return rows.map(mapDeployment);
  }

  updateDeployment(id: string, patch: UpdateDeploymentInput): DeploymentRecord {
    const assignments: string[] = [];
    const params: Record<string, string | null> = {
      id,
      updatedAt: now()
    };

    for (const [key, value] of Object.entries(patch) as Array<
      [keyof UpdateDeploymentInput, string | null]
    >) {
      if (value === undefined) {
        continue;
      }

      assignments.push(`${UPDATE_COLUMN_MAP[key]} = @${key}`);
      params[key] = value;
    }

    if (assignments.length === 0) {
      const unchanged = this.getDeployment(id);
      if (!unchanged) {
        throw new Error(`Deployment ${id} not found`);
      }

      return unchanged;
    }

    assignments.push("updated_at = @updatedAt");

    this.db
      .prepare(`update deployments set ${assignments.join(", ")} where id = @id`)
      .run(params);

    const updated = this.getDeployment(id);
    if (!updated) {
      throw new Error(`Deployment ${id} not found after update`);
    }

    return updated;
  }

  insertLog(input: {
    deploymentId: string;
    phase: DeploymentLogPhase;
    level: DeploymentLogLevel;
    message: string;
  }): DeploymentLogEntry {
    const createdAt = now();
    const result = this.db
      .prepare(
        `
        insert into deployment_logs (
          deployment_id,
          phase,
          level,
          message,
          created_at
        )
        values (
          @deploymentId,
          @phase,
          @level,
          @message,
          @createdAt
        )
      `
      )
      .run({
        deploymentId: input.deploymentId,
        phase: input.phase,
        level: input.level,
        message: input.message,
        createdAt
      });

    const row = this.db
      .prepare(
        `
        select id, deployment_id, phase, level, message, created_at
        from deployment_logs
        where id = ?
      `
      )
      .get(result.lastInsertRowid) as DeploymentLogRow;

    return mapLog(row);
  }

  listLogs(deploymentId: string): DeploymentLogEntry[] {
    const rows = this.db
      .prepare(
        `
        select id, deployment_id, phase, level, message, created_at
        from deployment_logs
        where deployment_id = ?
        order by id asc
      `
      )
      .all(deploymentId) as DeploymentLogRow[];

    return rows.map(mapLog);
  }
}

