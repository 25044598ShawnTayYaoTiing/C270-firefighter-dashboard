# FA Docker Compose / Multi-container Orchestration

## Ownership and Scope

**FA responsibility: Ji Xun — Docker Compose / Multi-container Orchestration**

Ji Xun owns how the existing frontend and backend containers are integrated for local development. Min owns the frontend Dockerfile and Nginx image. Thein owns the backend Dockerfile and Node.js image. This component does not own AWS/ECS, GitHub Actions, Ansible, Gemini Deployment Summaries or Failure Diagnostics, DevSecOps scanners, or application business logic.

## Architecture

```text
Browser
  |
  | http://127.0.0.1:3000
  v
Frontend service
  Nginx container, internal port 80
  |
  | http://backend:3000
  | Docker Compose service-name DNS
  v
Backend service
  Node.js/Express container, internal port 3000
  |
  +--> external MySQL/Railway
  +--> external Gemini
  +--> optional Google Speech-to-Text credentials
```

Both application services join the project-scoped `firefighter-network` bridge network. Docker's embedded DNS resolves the service name `backend` to the backend container. Container-to-container traffic never uses host `localhost`.

The Compose project has the default name `firefighter-dashboard`, producing predictable resources such as:

- services: `frontend` and `backend`;
- containers: `firefighter-dashboard-frontend-1` and `firefighter-dashboard-backend-1`;
- network: `firefighter-dashboard_firefighter-network`.

Explicit `container_name` values are intentionally avoided. Compose can therefore isolate another project with `--project-name` and retains its normal service-management behavior.

## Files

| File | Purpose | Primary owner |
|---|---|---|
| `docker-compose.yml` | Builds, networks, configures, starts, monitors, and restarts the two services | Ji Xun |
| `docker-compose.gcp.yml` | Optional read-only bind mount for an existing local Google ADC file | Ji Xun |
| `scripts/compose-smoke.js` | Cross-platform build, health, DNS, proxy, recovery, and cleanup validation | Ji Xun |
| `.env.example` | Non-secret configuration template and required-variable guidance | Shared supporting file |
| `frontend/Dockerfile` | Builds the Nginx frontend image | Min |
| `frontend/nginx.conf.template` | Serves frontend health/static assets and proxies application traffic | Min |
| `frontend/validate-backend-url.sh` | Rejects missing or malformed frontend backend origins | Min |
| `Dockerfile` | Builds the production-dependency Node.js backend image | Thein |
| `app.js` | Supplies the lightweight JSON backend `/health` contract | Application/backend supporting contract |

## Networking and Service Discovery

The frontend receives this fixed local runtime value:

```text
BACKEND_URL=http://backend:3000
```

`backend` is a Compose service name, not a host machine name. Internal ports are:

| Service | Container port | Host default | Purpose |
|---|---:|---:|---|
| Frontend | `80` | `127.0.0.1:3000` | Browser entry point |
| Backend | `3000` | `127.0.0.1:3001` | Direct local health/debug access |

Host ports can be changed with `FRONTEND_PORT` and `BACKEND_PORT`. Internal service communication remains `backend:3000` regardless of host-port changes.

Both published ports bind to `127.0.0.1`, so this local development stack is not unintentionally exposed on every host network interface.

## Health and Startup Behavior

### Backend

The backend Compose health check sends a real HTTP request to:

```text
http://127.0.0.1:3000/health
```

It requires both HTTP success and the application contract:

```json
{
  "status": "ok"
}
```

### Frontend

The frontend health check sends a real HTTP request to Nginx `/health`. This validates that the gateway can accept requests. It intentionally does not make frontend liveness depend continuously on Google, Gemini, MySQL, or the backend.

### Startup Ordering

The frontend has:

```yaml
depends_on:
  backend:
    condition: service_healthy
```

This prevents initial frontend startup until the backend passes its health check. `depends_on` controls startup ordering; it is not a continuous dependency monitor.

### Restart and Shutdown

Both services use:

```yaml
restart: unless-stopped
```

An unexpected process/container failure is restarted by Docker. An explicit operator stop remains stopped, which prevents an aggressive loop from overriding intentional maintenance.

Both services also have a bounded 15-second stop grace period. Nginx and Node receive the normal container termination signal before Docker applies a forced stop.

If the backend is temporarily unavailable, Nginx remains live while proxied application requests return a gateway error or time out. When the same backend service starts again, the frontend proxy recovers without rebuilding either image.

## Required Environment Configuration

Copy the template:

```powershell
Copy-Item .env.example .env
```

Configure at least:

- `SESSION_SECRET`;
- `DB_HOST`;
- `DB_PORT`;
- `DB_USER`;
- `DB_PASSWORD`;
- `DB_NAME`.

Compose fails during interpolation if the required session/database values are missing. Optional Gemini, Google Speech-to-Text, and OneMap values may remain empty when those features are not being demonstrated.

Never commit `.env`. Do not put OAuth tokens, ADC JSON, service-account keys, or downloaded federation files in Compose YAML.

`NODE_ENV` defaults to `development` for local HTTP behavior, while the backend still runs the same production-dependency container image. Production ECS environment configuration is separate from this local Compose file.

## Normal Startup

Validate configuration without printing interpolated values:

```powershell
docker compose config --quiet
```

Build and start:

```powershell
docker compose up --detach --build
docker compose ps
```

Open:

```text
http://127.0.0.1:3000
```

Inspect bounded logs:

```powershell
docker compose logs --tail 100 frontend backend
```

Stop and remove the local containers and project network:

```powershell
docker compose down
```

The external database and cloud services are not created or deleted by this command.

## Optional Google ADC Overlay

The base Compose file has no ADC path or credential mount. Use the overlay only when local Speech-to-Text is required.

Set `GOOGLE_APPLICATION_CREDENTIALS_HOST` to an existing ADC file outside the repository, then validate and start:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS_HOST = (Resolve-Path '<absolute-path-to-existing-adc-json>').Path
docker compose -f docker-compose.yml -f docker-compose.gcp.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.gcp.yml up --detach --build
```

The overlay:

- requires the host source path only when the overlay is selected;
- mounts the file at `/var/run/google-credentials/application_default_credentials.json`;
- sets the container's `GOOGLE_APPLICATION_CREDENTIALS` to that path;
- uses a read-only bind;
- disables automatic host-path creation;
- does not copy the credential into either image.

If the variable is absent, overlay validation fails clearly:

```powershell
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS_HOST -ErrorAction SilentlyContinue
docker compose -f docker-compose.yml -f docker-compose.gcp.yml config --quiet
```

That failure is expected. Base Compose remains usable without the overlay.

## Automated Smoke and Recovery Test

Run:

```powershell
npm run compose:smoke
```

The script:

1. verifies Docker Engine availability;
2. runs `docker compose config --quiet`;
3. builds both images through Compose;
4. starts an isolated project on temporary loopback ports;
5. waits for backend and frontend container health;
6. verifies both host health endpoints;
7. proves that the frontend resolves `backend` through Compose DNS;
8. requests `http://backend:3000/health` from inside the frontend container;
9. requests `/login` through Nginx to prove frontend-to-backend proxying;
10. stops the backend and verifies frontend liveness plus expected proxy degradation;
11. starts the backend and verifies health and proxy recovery;
12. runs `docker compose down --rmi local` and confirms no smoke-test containers or images remain.

It uses a generated session secret, placeholder non-production database settings, blank AI/cloud credentials, a unique project name, and temporary host ports. It does not query or modify production data.

If interrupted or failed, it makes a best-effort attempt to remove only its uniquely named smoke-test project.

## Manual Service-DNS Validation

Resolve the backend name from the frontend:

```powershell
docker compose exec --no-TTY frontend getent hosts backend
```

Call backend health over the internal network:

```powershell
docker compose exec --no-TTY frontend wget -q -O - http://backend:3000/health
```

Expected response:

```json
{"status":"ok"}
```

Changing `BACKEND_PORT` affects only direct host access. These internal commands continue to use `backend:3000`.

## Manual Failure and Recovery Demonstration

Start the stack and verify health:

```powershell
docker compose up --detach --build
docker compose ps
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:3000/health
```

Stop only the backend:

```powershell
docker compose stop backend
```

Expected behavior:

- frontend `/health` remains `200` because Nginx itself is alive;
- a proxied request such as `/login` returns a temporary gateway error or request timeout;
- the frontend container is not falsely restarted or marked dead because an external dependency is unavailable.

Restart and verify recovery:

```powershell
docker compose start backend
docker compose ps
docker compose exec --no-TTY frontend wget -q -O - http://backend:3000/health
Invoke-WebRequest http://127.0.0.1:3000/login
```

Then clean up:

```powershell
docker compose down
```

## Runtime Configuration Failure Examples

| Failure | Expected result |
|---|---|
| Missing `SESSION_SECRET` | Compose interpolation fails before startup |
| Missing required database value | Compose interpolation fails before startup |
| Malformed frontend `BACKEND_URL` in another runtime such as ECS | Frontend entrypoint exits with a clear validation message |
| Backend unavailable after startup | Nginx remains live; proxied request returns a gateway error or times out |
| GCP overlay selected without ADC host path | Compose overlay validation fails |
| ADC source path does not exist | Bind mount fails; Compose does not create a misleading directory |

## Technical Explanation for FA

### Why use service-name DNS?

Inside a container, `localhost` means that same container. The frontend therefore cannot reach the backend through `localhost`. Compose DNS maps `backend` to the backend container on the shared network.

### Why use health checks?

A running process is not necessarily ready to serve valid requests. HTTP health checks validate actual service behavior and allow startup to wait for backend readiness.

### Why keep frontend health independent?

Frontend `/health` is a liveness check for Nginx. If it depended on every downstream system, a temporary backend outage could trigger unnecessary frontend restarts and hide the true failed component.

### Host ports versus container ports

Container ports are stable service contracts inside the network. Host ports are developer entry points and can change to avoid conflicts.

### What does `depends_on` guarantee?

With `condition: service_healthy`, it guarantees initial ordering and readiness. It does not continuously restart the frontend whenever backend state changes.

### Why use an overlay?

The optional file adds local ADC configuration only when explicitly selected. The base environment therefore stays credential-free and works for manual transcript fallback.

### How does this improve consistency?

Every developer builds the same Dockerfiles, uses the same service names, network, health checks, environment contract, and startup order. The smoke script validates these assumptions automatically.

## Likely Lecturer Questions and Model Answers

1. **Why does Nginx use `backend` instead of `localhost`?**

   `localhost` inside Nginx points back to the frontend container. `backend` is resolved by Docker's embedded DNS to the backend service.

2. **What is the difference between port `3001` and backend port `3000`?**

   `3001` is the default host debugging port. Containers always reach the backend on its internal port `3000`.

3. **What does the backend health check validate?**

   It performs an HTTP request and requires both a successful status and JSON `{ "status": "ok" }`.

4. **Why does frontend depend on `service_healthy`?**

   It prevents initial gateway startup before the required backend is ready.

5. **Does `depends_on` monitor the backend forever?**

   No. It controls initial startup ordering. Runtime availability is handled by health visibility, Nginx gateway errors, and recovery.

6. **Why does frontend health stay green when backend is stopped?**

   It represents Nginx liveness. Coupling it to backend availability would restart the wrong component.

7. **What does `restart: unless-stopped` mean?**

   Docker restarts unexpected failures, but respects a deliberate operator stop.

8. **Why avoid explicit `container_name`?**

   Compose already provides predictable project-scoped names. Avoiding it preserves project isolation and normal Compose behavior.

9. **How are secrets protected?**

   Required values come from ignored environment files or generated smoke-test values. Credentials are never hard-coded or copied into images.

10. **How does the ADC overlay stay optional?**

    Its required source variable and mount exist only when both Compose files are selected.

11. **How is ADC mounted safely?**

    It is a read-only bind from an explicit external path, and missing paths are not automatically created.

12. **How do you prove service DNS works?**

    Execute `getent hosts backend` and request `http://backend:3000/health` from the frontend container.

13. **How does the smoke test avoid affecting a developer's normal stack?**

    It uses a unique project name and temporary ports, then removes only that project.

14. **What makes the environment reproducible?**

    Versioned Compose definitions, pinned container bases, locked dependencies, explicit health contracts, required configuration, and an automated integration test.

## L4 Evidence Checklist

Ji Xun should capture or demonstrate:

1. base and overlay `docker compose config --quiet`;
2. both images building;
3. both services healthy in `docker compose ps`;
4. `getent hosts backend` from the frontend;
5. internal backend health through `backend:3000`;
6. successful `/login` through Nginx;
7. degraded proxy behavior with frontend liveness preserved;
8. backend start and recovered proxy communication;
9. clean `docker compose down`;
10. the smoke-test success output and this technical explanation.
