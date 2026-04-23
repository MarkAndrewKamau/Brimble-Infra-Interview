# Brimble Infra Interview

A small deployment platform that accepts a project, builds it with Railpack, runs it as a Docker container, routes traffic through Caddy, and streams build/runtime logs to a one-page React UI.

The project is intentionally simple and operationally explicit. It favors a reliable end-to-end path over broad platform features.

## What It Does

- Creates deployments from a Git URL or uploaded ZIP archive.
- Builds projects with Railpack.
- Runs each successful build as a Docker container.
- Routes each live deployment through Caddy.
- Tracks deployment state in SQLite.
- Persists build, deploy, runtime, and system logs.
- Streams live deployment updates and logs with Server-Sent Events.
- Ships as a Docker Compose stack with backend, Caddy, and BuildKit.

## Architecture

```text
Browser UI
  |
  | HTTP + SSE
  v
Backend API / Deployment Runner
  |
  | stores deployments and logs
  v
SQLite database

Backend API / Deployment Runner
  |
  | clone or unpack project
  | railpack build
  | docker run
  v
Docker + BuildKit

Caddy
  |
  | host-based route
  v
Running deployment container
```

## System Components

| Component | Responsibility |
| --- | --- |
| Frontend | Submit deployments, list deployments, select a deployment, display live and historical logs. |
| Backend API | Validate requests, create deployment records, expose deployment snapshots, serve SSE streams. |
| Deployment runner | Process deployments sequentially, prepare source, run Railpack, start containers, sync Caddy, persist logs. |
| Caddy | Receive all HTTP traffic and reverse proxy either to the platform UI/API or to deployment containers. |
| SQLite | Persist deployments, statuses, image tags, live URLs, failure reasons, and log lines. |
| BuildKit | Provide the build backend used by Railpack. |

## Deployment Lifecycle

Deployments move through a small state machine:

```text
pending -> building -> deploying -> running
                       \-> failed
building --------------/
```

The statuses mean:

| Status | Meaning |
| --- | --- |
| `pending` | The backend accepted the deployment and queued it. |
| `building` | Source is being cloned or unpacked and Railpack is building the image. |
| `deploying` | The image was built and the runner is starting or replacing the container. |
| `running` | The container responded successfully and Caddy has been synced. |
| `failed` | Source preparation, build, container startup, readiness, or cleanup failed. |

Each transition is persisted and published to connected SSE clients.

## Routing Model

This implementation uses host-based routing:

```text
http://<deployment-slug>.localhost
```

For example:

```text
http://deploy-moat8cyr-5018.localhost
```

Caddy routes that hostname to the matching deployment container on the shared Docker network:

```text
deployment-<slug>:8080
```

The platform UI and API remain available through the fallback route:

```text
http://localhost
```

### Why Host-Based Routing?

Host-based routing keeps the deployment container model simple:

- No host port allocator is required.
- No per-deployment host port needs to be exposed.
- Containers can communicate through Docker DNS on the Compose network.
- The live URL looks close to how production preview deployments commonly work.
- `*.localhost` works in modern local environments without custom DNS setup.

Path-based routing would also be valid for this challenge, but it would require deployed apps to behave correctly under a path prefix such as `/deployments/:id`. Many apps assume they are served from `/`, so host-based routing avoids that class of breakage.

## Caddy Configuration

Caddy starts from [infra/Caddyfile](infra/Caddyfile):

```caddyfile
{
	admin 0.0.0.0:2019
	auto_https off
}

:80 {
	encode zstd gzip
	reverse_proxy backend:3000
}
```

At runtime, the backend posts a generated JSON config to Caddy's admin API at:

```text
http://caddy:2019/load
```

That generated config preserves:

- HTTP-only local routing with automatic HTTPS disabled.
- Response compression with `zstd` and `gzip`.
- A fallback proxy to the backend.
- One terminal route per running deployment.

## Logs

Logs are both streamed live and persisted.

The backend stores every log line in SQLite with:

- deployment ID
- phase
- level
- message
- timestamp

Log phases are:

```text
source
build
deploy
runtime
system
```

This means a user can watch logs live during a build and still reconnect later to scroll through the full history.

## Streaming

The app uses Server-Sent Events rather than WebSockets.

SSE fits this project because log streaming is one-way from server to browser. It is also simpler to implement, works directly in the browser through `EventSource`, and avoids extra WebSocket lifecycle complexity.

There are two SSE streams:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/events` | Platform-level deployment list updates. |
| `GET /api/deployments/:deploymentId/stream` | Deployment snapshot plus live deployment and log events. |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `GET` | `/api/deployments` | List deployments. |
| `POST` | `/api/deployments` | Create a Git or ZIP deployment. |
| `GET` | `/api/events` | Stream platform events. |
| `GET` | `/api/deployments/:deploymentId/stream` | Stream one deployment's logs and status. |

### Create A Git Deployment

```bash
curl -fsS -X POST \
  -F sourceType=git \
  -F gitUrl=https://github.com/example/repo.git \
  http://localhost/api/deployments
```

### Create A ZIP Deployment

```bash
rm -f /tmp/hello-node.zip
cd samples
zip -r /tmp/hello-node.zip hello-node
curl -fsS -X POST \
  -F sourceType=upload \
  -F projectArchive=@/tmp/hello-node.zip \
  http://localhost/api/deployments
```

The `rm -f` matters when recreating ZIP files because `zip -r` updates an existing archive and can leave stale entries in place.

## Local Requirements

- Docker
- Docker Compose
- A host that allows the backend container to mount `/var/run/docker.sock`
- Internet access for the first Railpack/BuildKit build so builder and runtime layers can be downloaded

Node is only required if you want to run local builds outside Docker.

## Quick Start

From the repository root:

```bash
docker compose up --build -d
```

Open:

```text
http://localhost
```

Check the API:

```bash
curl -fsS http://localhost/api/health
```

Expected response:

```json
{"ok":true}
```

Deploy the sample app through the UI, or use the ZIP `curl` example above.

When the deployment reaches `running`, open its live URL:

```text
http://<deployment-slug>.localhost
```

## Useful Commands

Build TypeScript and frontend assets locally:

```bash
npm run build
```

Validate the Caddyfile:

```bash
caddy validate --config infra/Caddyfile
```

Rebuild and restart the stack:

```bash
docker compose up --build -d
```

Show service status:

```bash
docker compose ps
```

Show backend logs:

```bash
docker compose logs --tail=100 backend
```

Stop the stack:

```bash
docker compose down
```

Remove persisted deployment data and BuildKit cache:

```bash
docker compose down -v
```

## Configuration

The backend reads these environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Backend HTTP port inside the container. |
| `DATA_DIR` | `./data` | Directory for SQLite, uploads, and workspaces. |
| `BUILDKIT_HOST` | `docker-container://buildkit` | BuildKit target used by Railpack. |
| `DOCKER_NETWORK` | `brimble-platform` | Docker network for deployment containers. |
| `CADDY_ADMIN_URL` | `http://caddy:2019/load` | Caddy admin load endpoint. |
| `BACKEND_UPSTREAM` | `backend:3000` | Upstream Caddy should use for platform UI/API fallback. |
| `APP_BASE_URL` | `http://localhost` | Base URL for the platform. |
| `DEPLOYMENT_HOST_SUFFIX` | `.localhost` | Suffix appended to deployment slugs. |
| `DEPLOYMENT_PORT` | `8080` | Port exposed by built deployment containers. |

## Source Handling

Git deployments:

- Validate that the URL looks like `http`, `https`, `git@`, or `ssh`.
- Clone with `git clone --depth 1`.
- Resolve the project root if the repository contains a single wrapper directory.

ZIP deployments:

- Require a `.zip` file.
- Extract into a deployment workspace.
- Reject entries that would escape the workspace.
- Ignore `__MACOSX` archive metadata.
- Resolve the project root if the archive contains a single wrapper directory.

## Container Lifecycle

For each deployment, the runner:

1. Creates a slug such as `deploy-moat8cyr-5018`.
2. Builds a Docker image tagged `<slug>:latest`.
3. Removes any previous container with the same deployment container name.
4. Starts a new container named `deployment-<slug>`.
5. Connects it to the Compose network.
6. Sets `PORT=<DEPLOYMENT_PORT>`.
7. Waits for `http://deployment-<slug>:<DEPLOYMENT_PORT>/` to respond.
8. Marks the deployment as `running`.
9. Syncs Caddy routes.
10. Captures a short runtime log snapshot.

Deployments are processed sequentially by the backend runner. That keeps the control plane simple and avoids contention around BuildKit, Docker image names, Caddy syncs, and workspace cleanup.

## Persistence

The Compose stack uses named volumes:

| Volume | Purpose |
| --- | --- |
| `platform-data` | SQLite database, uploaded archives during processing, and deployment workspaces. |
| `buildkit-state` | BuildKit cache and state. |

Deployment records and logs survive container restarts. Use `docker compose down -v` if you want a clean slate.

## Project Structure

```text
apps/backend
  src/config.ts
  src/db.ts
  src/server.ts
  src/services/caddy-service.ts
  src/services/deployment-runner.ts
  src/utils

apps/frontend
  src/components
  src/hooks
  src/lib/api.ts
  src/pages/home-page.tsx

infra
  backend.Dockerfile
  Caddyfile

samples
  hello-node
```

## Verification Performed

The current implementation has been checked with:

```bash
npm run build
caddy validate --config infra/Caddyfile
docker compose up --build -d
curl -fsS http://localhost/api/health
```

A clean ZIP of `samples/hello-node` was deployed successfully. The resulting deployment reached `running` and responded through Caddy at a `*.localhost` deployment URL.

## Known Limitations

- Deployments are processed sequentially instead of concurrently.
- There is no authentication or multi-tenant isolation.
- There are no resource quotas for CPU, memory, disk, or build time.
- Old images and containers are not garbage-collected beyond replacing the same deployment container name.
- Health checks use a simple HTTP request to `/`.
- The UI is intentionally compact and focused on the core platform workflow.
- Git URL validation is basic and does not prove the repository is reachable before enqueueing.
- Caddy route sync is whole-config replacement rather than a finer-grained route patch.

## What I Would Improve Next

- Add automated tests around ZIP extraction safety, state transitions, Caddy config generation, and log persistence.
- Add a cleanup job for old workspaces, images, and stopped containers.
- Add per-deployment build timeouts and clearer cancellation behavior.
- Add resource limits to `docker run`.
- Add authentication and basic audit metadata.
- Add a richer health-check model with configurable paths.
- Add retry/backoff controls for source clone and image pulls.
- Add UI affordances for retrying a failed deployment and deleting old deployments.
- Add structured deployment events for easier debugging and metrics.

## Design Tradeoffs

This implementation intentionally chooses:

- SSE instead of WebSockets because the browser only needs server-to-client updates.
- Host-based routing instead of path-based routing because deployed apps can serve from `/` without path-prefix awareness.
- Sequential deployment execution instead of parallel workers because it is easier to reason about and safer for a small take-home platform.
- SQLite instead of a server database because it keeps Compose setup minimal while still providing durable state.
- Docker network routing instead of host port allocation because it avoids port collisions and keeps deployment containers private to the platform network.

## Time And Scope Notes

The goal was to complete the hard requirements first:

1. Build with Railpack.
2. Run the built image.
3. Route traffic through Caddy.
4. Persist deployment state and logs.
5. Stream logs live.
6. Provide a usable one-page UI.
7. Keep `docker compose up --build` as the primary way to run the system.

With more time, I would focus less on UI polish and more on automated tests, cleanup, cancellation, resource limits, and clearer production hardening.
