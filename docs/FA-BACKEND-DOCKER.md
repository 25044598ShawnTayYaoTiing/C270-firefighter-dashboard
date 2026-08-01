# FA Backend Dockerisation

## Purpose

The backend container packages the Node.js and Express application as a
deterministic, minimal, non-root production image. The same image contract is
used by local Docker Compose and the AWS ECS backend service.

Primary evidence:

- [`../Dockerfile`](../Dockerfile)
- [`../.dockerignore`](../.dockerignore)
- [`../app.js`](../app.js)
- [`../docker-compose.yml`](../docker-compose.yml)
- [`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)

## Architecture

```text
Source + package-lock.json
        |
        v
Node.js dependency stage
        |
        v
npm ci --omit=dev
        |
        v
Locked production node_modules
        |
        v
Distroless Node.js 22 runtime
        |
        v
Non-root UID 65532
        |
        v
Express on container port 3000
        |
        v
GET /health -> {"status":"ok"}
        |
        +----------------------+
        |                      |
        v                      v
Docker Compose             AWS ECS backend
host 127.0.0.1:3001        immutable ECR image
```

## Dockerfile explanation

### Multi-stage construction

The `dependencies` stage uses the digest-pinned
`node:22-bookworm-slim` image to install packages. The final stage starts from a
separate digest-pinned distroless Node.js image. Build and package-management
facilities therefore do not become part of the production runtime.

### Digest-pinned base images

Both `FROM` instructions include SHA-256 digests. A normal image tag can move to
a different image later, but a digest identifies exact base-image content. This
improves reproducibility and supply-chain traceability. Updating a base image is
an explicit reviewed change rather than an invisible rebuild difference.

### Deterministic dependencies

The dependency stage copies `package.json` and `package-lock.json`, then runs:

```dockerfile
RUN npm ci --omit=dev
```

`npm ci` requires the lockfile to match the manifest and installs the locked
dependency graph. `--omit=dev` excludes development-only packages from the
production image. The resulting `node_modules` directory is copied into the
runtime stage.

### Distroless runtime

The final image uses `gcr.io/distroless/nodejs22-debian13:nonroot`. It contains
the Node.js runtime and required system libraries without a normal shell,
package manager, or general administration tools. This reduces the final
attack surface.

The trade-off is that production debugging cannot rely on opening a shell in
the container. Health endpoints, application logs, ECS events, image metadata,
and external diagnostics must be used instead.

### Non-root execution

Runtime files are copied with ownership `65532:65532`, and the final image
declares:

```dockerfile
USER 65532
```

The Express process therefore does not run with root privileges.

### Minimal runtime content

The Dockerfile copies only the files and directories required by the running
application. `.dockerignore` excludes Git data, `.env` files, logs, tests,
documentation, scripts, editor settings, and local dependency directories from
the build context.

### Runtime secrets

The image contains no `.env` file, API key, database password, AWS credential,
or Google credential file. Values such as `SESSION_SECRET`, database
configuration, and application-service credentials are supplied at runtime by
Docker Compose or the existing ECS task definition.

This separates immutable application content from environment-specific secret
configuration.

## Health design

The backend exposes:

```http
GET /health
```

with:

```json
{"status":"ok"}
```

This endpoint measures whether the Node.js and Express process is running and
can answer HTTP requests. It intentionally does not contact:

- MySQL;
- Gemini;
- Google Speech-to-Text;
- Google STS or AWS Workload Identity Federation; or
- other external services.

An external service outage should not make ECS repeatedly restart a healthy
Express process. External dependency availability is handled by feature-level
error handling and dedicated diagnostics such as `/health/speech`.

The Dockerfile health check calls `/health` with the Node.js runtime already
present in the distroless image. Docker Compose independently checks both the
HTTP result and the expected JSON body. The cloud deployment also validates the
public backend `/health` URL before deploying the frontend.

## Security evidence

| Control | Repository evidence |
|---|---|
| Non-root runtime | `USER 65532` and `--chown=65532:65532` |
| Reduced runtime surface | Distroless final image with no normal shell or package manager |
| Reproducible base | Both base images are digest pinned |
| Production dependencies only | `npm ci --omit=dev` |
| Minimal build context | `.dockerignore` excludes secrets, tests, documentation, scripts, and Git data |
| No baked credentials | Runtime values come from Compose or ECS task configuration |
| Dependency gate | `npm audit --omit=dev --audit-level=high` |
| Container vulnerability gate | Trivy blocks HIGH and CRITICAL findings |
| Artifact integrity | CI exports and verifies the exact scanned backend image before ECR publication |

## Reliability evidence

- Locked dependencies make image construction repeatable.
- The Docker-native health check detects an unresponsive Express process.
- Compose waits for backend health before starting the frontend.
- Compose binds backend host access to `127.0.0.1:3001` while preserving
  container port `3000`.
- The Compose smoke test proves frontend-to-backend DNS and recovery.
- GitHub Actions builds and scans the backend image on pull requests and pushes.
- The deployment workflow promotes an immutable commit-SHA image to ECR.
- Ansible waits for the exact ECS task-definition revision and checks `/health`
  before deploying the frontend.
- Successful GitHub Actions deployment output provides real ECS evidence.

No additional backend-only smoke harness is required for FA: the image is
already covered by application tests, CI build and Trivy scanning, Compose
integration, and successful ECS deployment. The commands below provide a
focused individual demonstration.

## FA demonstration: 3–4 minutes

### 0:00–0:45 — Explain the two stages

Show `Dockerfile` and explain:

1. the Node dependency stage;
2. locked production dependency installation; and
3. the distroless non-root runtime.

### 0:45–1:45 — Build the image

From the repository root:

```powershell
docker build --pull -t firefighter-backend:fa .
```

Expected result: the dependency and runtime stages complete and Docker creates
`firefighter-backend:fa`.

### 1:45–2:20 — Inspect runtime metadata

```powershell
docker image inspect firefighter-backend:fa --format 'User={{.Config.User}} Health={{json .Config.Healthcheck.Test}}'
```

Expected evidence:

- `User=65532`;
- a health command that requests `http://127.0.0.1:3000/health`.

### 2:20–2:45 — Inspect layers

```powershell
docker history firefighter-backend:fa
```

Explain that the final image contains explicit runtime copies and does not
inherit the dependency-stage operating system or package-management tools.
Do not expose environment-secret values in screenshots.

### 2:45–3:20 — Show automated security evidence

Open the latest successful GitHub Actions `Build and container security gate`
and show:

- backend image build;
- human-readable Trivy output;
- HIGH/CRITICAL blocking scan; and
- exact scanned-image export.

### 3:20–4:00 — Show runtime evidence

Show:

- the Docker/Compose backend health result;
- the successful cloud deployment summary;
- the requested backend task definition being correlated to its exact service revision and service-deployment ARN, with that deployment reaching `SUCCESSFUL`; and
- backend `/health` passing before frontend deployment.

Do not deliberately fail ECS for this demonstration.

## Likely lecturer questions

### 1. Why use a multi-stage Dockerfile?

It separates package installation from the production runtime. Build utilities
and the larger dependency-stage operating system are not carried into the final
image.

### 2. Why use `npm ci` instead of `npm install`?

`npm ci` enforces `package-lock.json`, fails when the manifest and lockfile
disagree, and provides a repeatable dependency graph for CI and image builds.

### 3. Why use `--omit=dev`?

Development and testing packages are not needed by the running backend.
Excluding them reduces image content and vulnerability surface.

### 4. Why pin image digests?

A digest identifies exact base-image content. A mutable tag alone could resolve
to different content in a later build.

### 5. Why use a distroless image?

It contains the runtime without a normal shell, package manager, and unrelated
administrative tools, reducing the production attack surface.

### 6. What is the disadvantage of distroless?

Interactive shell debugging is unavailable. Operational diagnosis must use
logs, health endpoints, ECS events, image metadata, and external tools.

### 7. Why run as UID 65532?

It prevents the Express process from receiving root privileges inside the
container and limits the impact of a compromised process.

### 8. Why copy runtime directories separately?

It makes the intended production contents explicit and prevents tests,
documentation, scripts, or unrelated workspace files from being copied by a
broad `COPY . .`.

### 9. Where are application secrets stored?

They are supplied at runtime through Compose or the existing ECS task
definition. `.env` and credential files are excluded from the image.

### 10. Why does `/health` not check the database or Gemini?

It is a liveness check for Express. Restarting a healthy process because an
external provider is unavailable can create a restart loop without fixing the
external outage.

### 11. What is the difference between the Docker and Compose health checks?

The image defines a portable default health check. Compose defines
environment-level polling and also verifies the expected JSON body before
starting dependent services.

### 12. Why is the host port 3001 but the container port 3000?

Express consistently listens on port 3000 inside the container. Compose maps it
to host port 3001 so the host's port 3000 can be used by the frontend.

### 13. What is the difference between Docker and Docker Compose?

Docker builds and runs one container image. Compose defines how the frontend
and backend containers are configured, networked, started, health-checked, and
recovered together.

### 14. What is the difference between Docker, ECR, and ECS?

Docker builds the image. ECR stores the immutable image. ECS runs task
definitions that reference that image and maintains the cloud service.

### 15. What happens if Trivy finds a HIGH vulnerability?

The blocking Trivy command exits nonzero. The build job fails, so the
dependency-gated deployment job cannot authenticate to AWS or publish the
image.
