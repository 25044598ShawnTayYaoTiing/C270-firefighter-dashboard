# Frontend Dockerisation and Nginx Runtime

Primary FA owner: **Min — Frontend Dockerisation / Nginx Runtime**

This guide covers only the frontend image and its runtime contract. Docker Compose
orchestration, the backend image, CI/CD, AWS/ECS, Ansible, scanners, and Gemini Deployment Summaries or Failure Diagnostics remain
with their respective owners.

## Architecture

```text
Browser
  |
  | HTTP / WebSocket
  v
Nginx frontend container :80
  |-- /health                 -> local Nginx JSON response
  |-- static asset exists     -> /usr/share/nginx/html
  |-- /api/*                  -> BACKEND_URL, including WebSocket upgrade
  `-- application page       -> BACKEND_URL
                                  |
                                  v
                              Node.js backend
```

The browser uses one frontend origin. Nginx serves static assets and acts as a
gateway to the backend, so the browser does not need to know an internal ECS or
Compose backend address.

## Files Owned by the Frontend Container

| File | Purpose |
|---|---|
| `frontend/Dockerfile` | Reproducible frontend image definition |
| `frontend/Dockerfile.dockerignore` | Frontend-specific build-context allowlist |
| `frontend/nginx.conf.template` | Nginx health, static, HTTP proxy, and WebSocket behavior |
| `frontend/validate-backend-url.sh` | Fail-closed runtime validation of `BACKEND_URL` |
| `scripts/frontend-container-smoke.js` | Focused, automated image/runtime validation |
| `docs/FA-FRONTEND-DOCKER.md` | Design, evidence, demo, and troubleshooting guide |

The `frontend` section of `docker-compose.yml` consumes this contract, but Compose
orchestration remains Ji Xun's responsibility.

## Dockerfile Walkthrough

### Base image

```dockerfile
FROM nginx:1.31.3-alpine@sha256:...
```

The Alpine Nginx image is small compared with a general-purpose operating-system
image. Pinning by digest makes the build reproducible: the same source digest is
selected even if a mutable tag later changes.

### Static assets

```dockerfile
COPY public /usr/share/nginx/html
```

Only browser-safe public CSS, JavaScript, and images are copied into Nginx's static
document root. Backend source, `.env`, credentials, tests, and documentation are
not needed at runtime.

### Runtime template and validation

```dockerfile
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY frontend/validate-backend-url.sh /docker-entrypoint.d/05-validate-backend-url.sh
```

The official Nginx entrypoint runs scripts in `/docker-entrypoint.d` and then uses
`envsubst` to render templates from `/etc/nginx/templates`. Validation runs first,
so an invalid backend origin stops startup before Nginx accepts traffic.

### Port and health contract

```dockerfile
EXPOSE 80
HEALTHCHECK ... GET http://127.0.0.1/health ...
```

`EXPOSE` documents the container port; it does not publish a host port by itself.
The image-native health check verifies that Nginx can return the expected
`{"status":"ok"}` contract, not merely that a process exists.

## Minimal Build Context

`frontend/Dockerfile.dockerignore` starts by excluding everything, then allows only:

- `public/**`;
- `frontend/nginx.conf.template`;
- `frontend/validate-backend-url.sh`.

This reduces data sent to the Docker builder and makes it structurally impossible
for backend source, `.env`, tests, documentation, or local credentials to be copied
by the current frontend Dockerfile.

Build the image:

```powershell
docker build --file frontend/Dockerfile --tag firefighter-frontend:fa .
```

## Runtime `BACKEND_URL`

The backend origin is runtime configuration:

```text
BACKEND_URL=http://backend:3000
```

Runtime configuration lets the same immutable image run in local Compose, test,
and ECS without rebuilding it for each backend address.

Accepted values are HTTP or HTTPS origins with a valid host and optional port:

```text
http://backend:3000
https://backend.example.test
http://127.0.0.1:3000
```

The validator rejects:

- a missing value;
- unsupported schemes;
- paths, queries, and fragments;
- embedded usernames or passwords;
- whitespace or Nginx directive characters;
- ports outside `1` through `65535`.

Containers do not use `localhost` to reach a different container. Inside a
container, `localhost` means that same container. Compose therefore uses the
service DNS name `backend`; ECS supplies its environment-specific backend origin.

The variable is not a secret and must not contain credentials.

## Nginx Behavior

### Local frontend health

`GET /health` returns:

```json
{"status":"ok"}
```

This is intentionally a frontend liveness check. It proves that Nginx started and
loaded its configuration. It does not depend on the backend, database, Gemini, or
Google Speech-to-Text. Backend and end-to-end availability are checked separately.

### Static assets

Known CSS, JavaScript, image, font, and source-map extensions are served from
`/usr/share/nginx/html`. If a requested asset is not in the image, Nginx uses the
backend fallback, preserving compatibility with backend-rendered pages.

### Normal application requests

Routes such as `/login` and `/dashboard` are proxied to `BACKEND_URL`, where Express
renders the application page.

### API and WebSocket requests

`/api/` is proxied with HTTP/1.1. The actual live transcription WebSocket path is:

```text
/api/transcribe/stream
```

The same `/api/` location forwards `Upgrade` and `Connection` headers, so the
HTTP connection can switch protocols to WebSocket.

### Forwarded headers

Nginx sends:

- `Host: $proxy_host`, so the upstream receives the host represented by
  `BACKEND_URL`;
- `X-Real-IP`, containing the direct client address seen by Nginx;
- `X-Forwarded-For`, extending the proxy chain;
- `X-Forwarded-Proto`, preserving whether the browser-facing request was HTTP or
  HTTPS.

`proxy_ssl_server_name on` supplies SNI when `BACKEND_URL` is HTTPS.

## Health-Check Timing

The image defaults are:

| Setting | Value | Reason |
|---|---:|---|
| Interval | 30 seconds | Low steady-state overhead |
| Timeout | 5 seconds | Local Nginx should respond quickly |
| Start period | 10 seconds | Allows entrypoint validation and template rendering |
| Retries | 3 | Avoids marking one transient failure as unhealthy |

Compose currently defines an equivalent service-level check with orchestration
timing selected by the Compose owner. The frontend-owned contract is the
`GET /health` response and image health command.

## Hardening Review

### Implemented

- Nginx Alpine base image;
- immutable digest pin;
- frontend-only build-context allowlist;
- no package installation during the frontend build;
- no `.env`, credentials, backend source, or test data copied into the image;
- fail-closed runtime origin validation;
- Nginx version hidden with `server_tokens off`;
- request body limited to `1m`;
- graceful `SIGQUIT` stop signal inherited from the official image;
- security headers:
  - `X-Content-Type-Options: nosniff`;
  - `X-Frame-Options: SAMEORIGIN`;
  - `Referrer-Policy: strict-origin-when-cross-origin`.

### Runtime user and writable paths

The official image starts with a root entrypoint/master process because it must:

1. run the entrypoint hooks;
2. render `/etc/nginx/conf.d/default.conf`;
3. bind to privileged port 80;
4. prepare Nginx runtime paths.

The Nginx configuration starts worker processes as the image's `nginx` user. The
focused test displays both master and worker processes as evidence.

Changing the entire image to a non-root user would require changing the listening
port and writable runtime paths, which would alter the established Compose/ECS
contract. That is a future architecture decision, not a safe incidental hardening
change.

Nginx needs writable runtime locations for rendered configuration, PID/cache, and
temporary files. Do not set a read-only root filesystem without explicitly
providing the required writable mounts or `tmpfs` paths and testing ECS behavior.

### Content Security Policy decision

A strict CSP was not added blindly. Current backend-rendered pages use third-party
Google Fonts, Bootstrap, Bootstrap Icons, Leaflet, OpenStreetMap tiles, and some
inline style values. An incomplete CSP would break visible application features.
A future CSP should start in report-only mode, inventory every required origin,
and replace inline styles or use nonces before enforcement.

## Automated Frontend Container Test

Run:

```powershell
npm run frontend:container-test
```

The test uses direct Docker CLI operations, not Docker Compose orchestration. It:

1. builds the frontend image;
2. inspects exposed ports and the image-native health check;
3. creates an isolated test network;
4. starts a credential-free mock backend under the DNS alias `backend`;
5. starts the frontend with `BACKEND_URL=http://backend:3000`;
6. waits for Docker health to become `healthy`;
7. checks `/health`, static CSS, and a normal proxied page;
8. verifies API forwarding headers;
9. performs a real WebSocket upgrade through `/api/transcribe/stream`;
10. checks security headers and hidden Nginx version;
11. rejects malformed, missing, directive-injection-style, and out-of-range-port values;
12. stops Nginx and verifies exit code `0`;
13. removes its containers, network, and temporary image.

It does not use AWS, Google Cloud, Gemini, a database, application secrets, or the
live backend.

## Image Inspection Evidence

Build a stable demonstration tag first:

```powershell
docker build --file frontend/Dockerfile --tag firefighter-frontend:fa .
```

### Base metadata, runtime user, port, stop signal, and health check

```powershell
docker image inspect firefighter-frontend:fa
docker image inspect firefighter-frontend:fa --format '{{json .Config.User}}'
docker image inspect firefighter-frontend:fa --format '{{json .Config.ExposedPorts}}'
docker image inspect firefighter-frontend:fa --format '{{json .Config.Healthcheck}}'
docker image inspect firefighter-frontend:fa --format '{{json .Config.StopSignal}}'
```

These prove the configured startup identity, exposed container port, health
contract, and graceful stop signal. An empty `.Config.User` means the entrypoint
starts as root; inspect the running processes to demonstrate worker privilege
dropping.

### Image layers and size

```powershell
docker image ls firefighter-frontend:fa
docker history firefighter-frontend:fa
docker history --no-trunc firefighter-frontend:fa
```

These show image size, layer count, the pinned base, static-asset copy, runtime-file
copy, and permission layer.

### Rendered runtime configuration

For a running container named `firefighter-frontend-fa`:

```powershell
docker exec firefighter-frontend-fa nginx -T
docker exec firefighter-frontend-fa ps -o user,pid,ppid,args
docker inspect firefighter-frontend-fa --format '{{json .State.Health}}'
docker logs firefighter-frontend-fa
```

These prove that `BACKEND_URL` was rendered at startup, WebSocket and forwarding
headers are configured, workers run, Docker records health, and startup diagnostics
are available.

Never paste complete `docker inspect` output into a public report if future task
definitions add sensitive environment variables. The frontend image currently
requires only the non-secret `BACKEND_URL`.

## Safe FA Failure and Recovery Demo

### Automated 3–5 minute sequence

1. Show the focused files:

   ```powershell
   Get-Content frontend/Dockerfile
   Get-Content frontend/validate-backend-url.sh
   ```

2. Run the complete demonstration:

   ```powershell
   npm run frontend:container-test
   ```

3. Point out the successful evidence:

   - image build passes;
   - Docker health becomes healthy;
   - static and proxied HTTP requests return 200;
   - forwarding headers reach `backend`;
   - WebSocket upgrade succeeds;
   - security headers pass;
   - shutdown exits cleanly.

4. Point out the safe failure evidence:

   - `BACKEND_URL=abc` is rejected;
   - a missing value is rejected;
   - an injection-shaped origin is rejected;
   - no broken Nginx container remains running.

5. Show that the test cleaned up:

   ```powershell
   docker ps -a --filter "name=firefighter-frontend-"
   docker network ls --filter "name=firefighter-frontend-validation"
   docker image ls "firefighter-frontend-validation"
   ```

### Manual malformed-configuration example

```powershell
docker build --file frontend/Dockerfile --tag firefighter-frontend:fa .
docker run --rm --env BACKEND_URL=abc firefighter-frontend:fa
```

Expected result: the container exits non-zero and prints:

```text
BACKEND_URL must be an http:// or https:// origin without a path.
```

Missing configuration:

```powershell
docker run --rm firefighter-frontend:fa
```

Expected result: the container exits non-zero and explains that `BACKEND_URL` is
required.

Recovery is configuration-only: supply a valid origin and start a new container.
No image rebuild is required.

## Troubleshooting

Set the variable to the actual frontend container name before using the commands:

```powershell
$frontendContainer = "firefighter-frontend-fa"
```

### Invalid `BACKEND_URL`

Symptoms: the container exits immediately and logs a validation message.

```powershell
docker inspect $frontendContainer --format '{{json .Config.Env}}'
docker logs $frontendContainer
```

Use an origin only, such as `http://backend:3000`; remove paths, credentials,
queries, fragments, spaces, or invalid ports.

### Backend unavailable

Symptoms: frontend `/health` is 200, but proxied routes return 502/503/504.

```powershell
docker exec $frontendContainer getent hosts backend
docker exec $frontendContainer wget -S -O - http://backend:3000/health
docker logs $frontendContainer
```

Check service discovery, backend health, network membership, and the configured
port. A healthy frontend with an unavailable backend is expected liveness
separation, not a false claim that the whole system is healthy.

### Frontend unhealthy

```powershell
docker inspect $frontendContainer --format '{{json .State.Health}}'
docker exec $frontendContainer wget -S -O - http://127.0.0.1/health
docker logs $frontendContainer
```

Inspect recent health output and confirm the rendered configuration loaded.

### Nginx startup failure

```powershell
docker logs $frontendContainer
docker cp "${frontendContainer}:/etc/nginx/conf.d/default.conf" .\rendered-default.conf
docker exec $frontendContainer nginx -T
```

If the container has already exited, create a temporary shell only for local
diagnosis:

```powershell
docker run --rm --entrypoint /bin/sh `
  --env BACKEND_URL=http://backend:3000 `
  firefighter-frontend:fa
```

Do not print environment output if sensitive variables are ever added later.

### Proxy 502

```powershell
docker logs $frontendContainer
docker exec $frontendContainer getent hosts backend
docker exec $frontendContainer wget -S -O - http://backend:3000/health
```

A 502 usually means Nginx is running but cannot connect to the configured upstream.
It is not fixed by pointing to `localhost` unless the backend is deliberately in
the same container, which this architecture does not do.

### WebSocket failure

Confirm the browser path is `/api/transcribe/stream`, then inspect:

```powershell
docker exec $frontendContainer nginx -T
docker logs $frontendContainer
```

Look for HTTP/1.1, `Upgrade`, and `Connection` directives in the `/api/` location.
Also verify the backend itself accepts the upgrade and that intermediate load
balancers permit WebSockets.

## Likely FA Questions and Model Answers

### 1. Why Dockerise a frontend that is mostly static?

It produces one immutable, versioned runtime containing the static assets and
gateway configuration. The same image behaves consistently on developer machines,
CI, and ECS.

### 2. Why use Nginx?

Nginx efficiently serves static files and provides a lightweight reverse-proxy
boundary for Express APIs, pages, and WebSockets.

### 3. Why is `BACKEND_URL` runtime configuration?

Backend addresses differ between Compose and production. Runtime substitution lets
one tested image run in each environment without rebuilding environment-specific
images.

### 4. Why not use `localhost` for the backend?

Each container has its own network namespace. `localhost` inside the frontend is
the frontend container, not the backend container. Service DNS such as `backend`
connects separate containers.

### 5. What does the reverse proxy provide?

It gives the browser one origin, hides internal backend addressing, forwards client
context, and routes API, page, and WebSocket traffic to Express.

### 6. How are WebSockets different from normal HTTP proxying?

The initial request must use HTTP/1.1 and forward `Upgrade` and `Connection`
headers. After a 101 response, the connection becomes a bidirectional WebSocket.

### 7. What does the frontend health check prove?

It proves Nginx started, loaded the rendered configuration, and can return the
expected local JSON health response. It intentionally does not depend on external
services.

### 8. Why pin the base image by digest?

Tags can move. A digest identifies exact image content, improving reproducibility,
auditability, and rollback confidence.

### 9. Why use a Dockerfile-specific ignore file?

The frontend build only needs public assets and two runtime files. An allowlist
reduces build context and prevents unrelated source or local configuration from
entering the build.

### 10. Does the frontend run entirely as non-root?

No. The official image needs a root entrypoint/master process to render
configuration and bind port 80. Nginx workers drop to the `nginx` user. Moving the
whole container to non-root requires a deliberate port and filesystem contract
change.

### 11. Which security headers are used?

`nosniff` prevents MIME guessing, `SAMEORIGIN` limits framing, and the referrer
policy reduces cross-origin URL leakage. The server version is also hidden.

### 12. Why is there no enforced CSP?

The current rendered pages intentionally load several third-party libraries and
contain inline style values. A guessed CSP could break maps, styling, and scripts;
it should be introduced through an inventory and report-only rollout.

### 13. What happens when `BACKEND_URL` is wrong?

Malformed values fail before Nginx starts, with an understandable log message. A
syntactically valid but unreachable backend keeps frontend liveness available while
proxied routes return an upstream error for diagnosis.

### 14. How do image layers affect quality?

Each Dockerfile instruction can create metadata or a filesystem layer. A small
number of deterministic layers improves caching and makes `docker history` easy to
explain; the final image contains no build toolchain.

### 15. How is graceful shutdown demonstrated?

The base image supplies `STOPSIGNAL SIGQUIT`. The focused test runs `docker stop`,
then verifies the container reaches `exited` with code `0`.

## L4 Contribution

The advanced contribution is not merely writing a Dockerfile. It establishes and
tests a production runtime contract:

- reproducible digest-pinned image;
- least-data build context;
- startup-time, fail-closed configuration validation;
- Nginx HTTP and real WebSocket gateway behavior;
- meaningful image health;
- safe forwarding and security headers;
- runtime privilege explanation;
- deterministic failure and recovery demonstration;
- automated cleanup and evidence generation.

That combination demonstrates analysis, hardening, automation, failure handling,
and explainable operational validation at the frontend-container boundary.
