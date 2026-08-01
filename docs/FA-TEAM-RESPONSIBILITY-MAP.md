# FA DevOps Team Responsibility Map

## Executive Summary

This map assigns responsibility for the repository's current DevOps implementation. It is a presentation and maintenance boundary, not a claim about original authorship. The allocation is based on the agreed FA team split and the technical responsibilities visible in the current repository.

| Member | Primary Component | Extended Component | Current Scope Size | Key Evidence |
|---|---|---|---|---|
| Kiki | GitHub Actions CI/CD orchestration | Pipeline observability, artifact lifecycle, and release evidence | LARGE | Workflow triggers, job dependencies, PR/main behavior, image artifact hand-off, and deployment gating in `.github/workflows/deploy.yml` |
| Min | Frontend Dockerisation and Nginx runtime gateway | Frontend container hardening and runtime validation | SMALL | `frontend/Dockerfile`, `frontend/nginx.conf.template`, and `frontend/validate-backend-url.sh` |
| Thein | Backend Node.js Dockerisation | Runtime lifecycle and production-container validation | MEDIUM | Root `Dockerfile`, production dependency installation, distroless non-root runtime, and container health check |
| Ji Xun | Local Docker Compose orchestration | Automated integration smoke testing and recovery validation | MEDIUM | `docker-compose.yml`, `docker-compose.gcp.yml`, `scripts/compose-smoke.js`, and `docs/FA-DOCKER-COMPOSE.md` |
| Shawn | AWS cloud deployment and deployment reliability | Ansible rollback/diagnostics and Gemini deployment assistance | LARGE | Deployment portion of `.github/workflows/deploy.yml`, all `ansible/` deployment automation, `scripts/deployment-analysis/`, and deployment evidence documents |
| Fatin | DevSecOps security gates | Security evidence, dependency governance, and supply-chain controls | LARGE | npm audit, Gitleaks, Semgrep, Trivy, Dependabot, security artifacts, and fail-closed workflow dependencies |

The allocation is technically coherent but not equal in size. Shawn has the broadest current scope because cloud identity, image publication, ECS task definitions, deployment ordering, verification, rollback, diagnostics, and Gemini-assisted summaries form one integrated production responsibility. Min has the narrowest current scope. Ji Xun's original Compose scope has been strengthened with automated DNS, health, proxy, degradation, recovery, and cleanup validation without overlapping another member's primary ownership.

## Overall DevOps Architecture

```text
Developer
  -> GitHub
  -> GitHub Actions CI/CD orchestration                         [Kiki]
  -> Tests and security gates                                  [Kiki + Fatin]
  -> Backend and frontend Docker builds                        [Thein + Min]
  -> Trivy image security gate                                 [Fatin]
  -> Integrity-protected image artifacts                       [Kiki + Fatin]
  -> GitHub OIDC temporary AWS authentication                  [Shawn]
  -> Separate backend and frontend ECR repositories            [Shawn]
  -> New ECS task-definition revisions                         [Shawn]
  -> Ansible deployment preflight                              [Shawn]
  -> Backend ECS Express update and stabilization              [Shawn]
  -> Backend /health verification                              [Shawn]
  -> Frontend ECS Express update and stabilization             [Shawn]
  -> Frontend smoke test                                       [Shawn]
  -> Verified rollback and bounded diagnostics on failure      [Shawn]
  -> Sanitized, read-only Gemini-assisted deployment summary          [Shawn]
  -> Users

Local development:
Developer
  -> Docker Compose                                            [Ji Xun]
  -> Frontend Nginx container                                  [Min]
  -> Backend Node.js container                                 [Thein]
  -> External application services
```

The architecture deliberately uses two layers:

- GitHub Actions decides **when** work runs, enforces CI/security prerequisites, transports immutable artifacts, authenticates through OIDC, and invokes deployment.
- Ansible decides **how** the two existing ECS Express services are sequenced, stabilized, verified, and rolled back.

This separation keeps pipeline orchestration, security policy, container construction, local integration, and production deployment individually demonstrable.

## Kiki — CI/CD Pipeline

### Primary Ownership

Kiki owns the GitHub Actions pipeline as an orchestration system:

- event triggers for pull requests, pushes to `main`, and manual scan/deploy runs;
- job graph and `needs` dependencies;
- PR-versus-main execution behavior;
- concurrency and bounded job timeouts;
- source checkout, Node setup, locked dependency installation, and test execution;
- backend/frontend build-step orchestration;
- artifact upload, download, retention, and cross-job image hand-off;
- deployment eligibility and failure propagation;
- workflow summaries and release evidence sequencing.

Kiki owns the placement and dependency relationship of security and cloud steps, while Fatin owns scanner policy and Shawn owns AWS/ECS implementation inside the deployment stage.

### Secondary / Extended Ownership

Implemented extension:

- maintain a concise pipeline stage/runbook diagram;
- improve non-secret failure summaries and job-level observability;
- document artifact names, retention, checksums, and promotion rules;
- own PR/main/manual trigger test scenarios;
- maintain evidence that failed CI or security jobs make deployment ineligible.

These extensions deepen pipeline engineering without taking ownership of scanners, Dockerfile internals, or AWS deployment commands.

### Exact Files and Components

| File or section | Classification | Responsibility |
|---|---|---|
| `.github/workflows/deploy.yml` — `on`, global permissions, concurrency, environment, job graph, `needs`, and event conditions | Primary | Pipeline structure and execution rules |
| `.github/workflows/deploy.yml` — test execution and build-step orchestration | Primary | CI sequence and build hand-off |
| `.github/workflows/deploy.yml` — scanned image artifact upload/download and checksums | Shared with Fatin | Immutable artifact promotion; Fatin owns security intent |
| `.github/workflows/deploy.yml` — deploy-job invocation and Gemini-analysis job condition | Shared with Shawn | Kiki owns job wiring; Shawn owns deployment/Gemini-assisted analysis behavior |
| `.github/dependabot.yml` — GitHub Actions update cadence | Shared with Fatin | Automation scheduling; Fatin owns dependency-risk response |
| `test/*.test.js` | Supporting | The CI job executes the complete test suite; feature owners remain responsible for test content |
| `README.md` — DevSecOps pipeline overview | Supporting | User-facing pipeline explanation |

### Integration With Other Members

- Receives the backend image definition from Thein and frontend image definition from Min.
- Runs both builds only after Kiki's CI sequence and Fatin's pre-build gates succeed.
- Preserves the exact images that pass Fatin's Trivy gate.
- Invokes Shawn's cloud deployment only on an eligible event after every required job succeeds.
- Keeps Ji Xun's local Compose path independent from production deployment.

### FA Demonstration Responsibilities

Kiki should demonstrate:

1. the workflow trigger matrix;
2. the job dependency graph;
3. a pull request where CI/security/build run but deployment is skipped;
4. a `main` run where deployment starts only after all gates pass;
5. checksum-protected image artifact hand-off between jobs;
6. concurrency, timeouts, and failure propagation.

### Technical Concepts to Explain

- CI/CD directed acyclic graphs;
- event filtering and conditional execution;
- immutable artifact promotion;
- job isolation and artifact transfer;
- least-privilege job permissions;
- fail-fast versus `if: always()` cleanup/reporting;
- deterministic release sequencing.

### Current Scope Size

**LARGE.** Pipeline orchestration crosses every team component and requires clear control of events, dependencies, permissions, artifacts, failure semantics, and release eligibility. It remains smaller than Shawn's operational cloud scope because it excludes scanner policy and deployment internals.

## Min — Frontend Dockerisation

### Primary Ownership

Min owns the frontend container and its Nginx runtime gateway:

- pinned Nginx Alpine image;
- static frontend asset placement;
- Nginx template installation;
- runtime `BACKEND_URL` validation;
- frontend `/health` endpoint;
- API, WebSocket, root, and static-asset proxy behavior;
- forwarded headers, TLS server-name behavior, compression, and response security headers;
- frontend container startup correctness and port exposure.

### Secondary / Extended Ownership

Recommended extension:

- document and test Nginx startup with valid and invalid `BACKEND_URL` values;
- own frontend image size and runtime inspection evidence;
- evaluate an image-native frontend `HEALTHCHECK` in addition to the existing Compose check;
- evaluate least-privilege Nginx runtime options without changing the working service architecture;
- maintain a frontend container troubleshooting checklist for proxy, WebSocket, and health failures.

The evaluation items should only be implemented if they remain compatible with ECS Express and the current Nginx image.

### Exact Files and Components

| File or section | Classification | Responsibility |
|---|---|---|
| `frontend/Dockerfile` | Primary | Frontend image construction and runtime content |
| `frontend/nginx.conf.template` | Primary | Runtime gateway, proxy behavior, health response, and headers |
| `frontend/validate-backend-url.sh` | Primary | Fail-closed validation of the backend origin |
| `public/` | Supporting input | Static content copied into the image; application feature ownership is outside this map |
| `docker-compose.yml` — `frontend` service | Shared with Ji Xun | Min owns container expectations; Ji Xun owns Compose orchestration |
| `.dockerignore` | Shared with Thein and Fatin | Build-context hygiene |
| `.github/workflows/deploy.yml` — frontend build step | Shared with Kiki | Min owns build correctness; Kiki owns step orchestration |
| `.github/workflows/deploy.yml` — frontend Trivy steps | Shared with Fatin | Min resolves image issues; Fatin owns scan policy |

### Integration With Other Members

- Supplies a deterministic frontend image to Kiki's pipeline.
- Uses Ji Xun's Compose network value `http://backend:3000` for local integration.
- Uses Shawn's production backend service URL through `BACKEND_URL`.
- Responds to Fatin's container findings without changing security thresholds.

### FA Demonstration Responsibilities

Min should demonstrate:

1. building the frontend image;
2. successful startup with a valid backend origin;
3. fail-closed startup with an invalid origin;
4. Nginx `/health`;
5. `/api/` and WebSocket proxy configuration;
6. security headers and hidden Nginx version;
7. how ECS supplies a production `BACKEND_URL` without rebuilding the image.

### Technical Concepts to Explain

- static asset containerisation;
- runtime configuration versus build-time configuration;
- Nginx reverse proxying and WebSocket upgrades;
- Docker entrypoint hooks;
- health endpoints;
- pinned base images;
- image-size and least-privilege trade-offs.

### Current Scope Size

**SMALL.** The current implementation is technically valid but concentrated in three tightly related files and one container boundary. Runtime-hardening evidence, container validation, and troubleshooting ownership are the natural additions needed for stronger individual FA depth.

## Thein — Backend Dockerisation

### Primary Ownership

Thein owns the production Node.js backend image:

- pinned Node dependency-build image;
- locked production-only dependency installation with `npm ci --omit=dev`;
- pinned distroless Node.js 22 non-root runtime;
- multi-stage copying of runtime dependencies;
- explicit inclusion of required backend runtime files;
- production environment defaults and exposed port;
- non-root UID;
- container-native `/health` check;
- backend process command and runtime behavior.

### Secondary / Extended Ownership

Recommended extension:

- document process lifecycle, signal handling, and graceful ECS shutdown expectations;
- maintain a container-only startup/health validation command;
- record image size, user ID, entrypoint, and health-state evidence;
- document distroless troubleshooting and why development tools are intentionally absent;
- verify that newly introduced backend runtime directories are added deliberately to the Dockerfile.

These extensions remain container-runtime responsibilities and do not transfer npm vulnerability policy from Fatin.

### Exact Files and Components

| File or section | Classification | Responsibility |
|---|---|---|
| `Dockerfile` | Primary | Backend image build, runtime, user, health, and command |
| `package.json` and `package-lock.json` | Supporting | Inputs to production dependency installation |
| `app.js` — `/health` route | Supporting contract | Liveness response consumed by the image, Compose, and deployment |
| `.dockerignore` | Shared with Min and Fatin | Backend build-context minimization and secret hygiene |
| `docker-compose.yml` — `backend` service | Shared with Ji Xun | Thein owns image/runtime expectations; Ji Xun owns local orchestration |
| `.github/workflows/deploy.yml` — backend build step | Shared with Kiki | Thein owns build correctness; Kiki owns pipeline placement |
| `.github/workflows/deploy.yml` — backend Trivy steps | Shared with Fatin | Thein resolves image issues; Fatin owns scan policy |

### Integration With Other Members

- Supplies the backend image definition to Kiki's build pipeline.
- Exposes the runtime and health contracts used by Ji Xun locally and Shawn in ECS.
- Consumes production dependencies evaluated by Fatin's npm audit and Trivy gates.
- Preserves application runtime capabilities without owning Gemini, database, or Speech-to-Text feature code.

### FA Demonstration Responsibilities

Thein should demonstrate:

1. both Docker build stages;
2. why only production dependencies reach runtime;
3. the distroless and non-root security posture;
4. the exact runtime files copied;
5. the container health check;
6. the image's UID, exposed port, and start command;
7. a standalone backend container becoming healthy.

### Technical Concepts to Explain

- multi-stage builds;
- deterministic package installation;
- distroless images;
- non-root execution;
- build context and runtime attack-surface reduction;
- Docker health checks;
- container lifecycle and signal handling.

### Current Scope Size

**MEDIUM.** The backend image includes meaningful production engineering—multi-stage construction, deterministic dependencies, a distroless runtime, non-root execution, selective runtime copying, and health behavior—but remains one bounded deliverable.

## Ji Xun — Docker Compose

### Primary Ownership

Ji Xun owns the reproducible local two-service environment:

- frontend and backend service definitions;
- build contexts and Dockerfile selection;
- local port mapping;
- shared bridge network;
- environment-variable wiring;
- backend health check;
- frontend dependency on backend health;
- frontend health check;
- restart behavior;
- external database configuration rather than introducing a database container;
- optional read-only Google ADC mount overlay for local development.

### Secondary / Extended Ownership

Recommended extension:

- own the repeatable local integration smoke-test procedure;
- test cold start, backend-unhealthy, restart, and recovery scenarios;
- document base Compose versus optional Google ADC overlay usage;
- maintain `docker compose config --quiet` validation;
- provide a non-secret local stack troubleshooting and demonstration procedure;
- maintain the isolated `scripts/compose-smoke.js` validation.

### Exact Files and Components

| File or section | Classification | Responsibility |
|---|---|---|
| `docker-compose.yml` | Primary | Two-service local orchestration |
| `docker-compose.gcp.yml` | Primary | Optional read-only local ADC overlay |
| `scripts/compose-smoke.js` | Primary | Build, health, DNS, proxy, degradation, recovery, and cleanup validation |
| `docs/FA-DOCKER-COMPOSE.md` | Primary evidence | Architecture, operating procedures, demonstration, and technical-question preparation |
| `.env.example` — local ports, URLs, and Compose variables | Shared | Ji Xun owns local wiring; feature owners own service-specific values |
| `README.md` — complete local stack instructions | Supporting | Local operator instructions |
| `Dockerfile` | Consumed, not owned | Backend image supplied by Thein |
| `frontend/Dockerfile` | Consumed, not owned | Frontend image supplied by Min |
| `/health` contracts | Shared integration contract | Used to order and verify local services |

### Integration With Other Members

- Orchestrates Min's and Thein's images without changing their internals.
- Provides Kiki and Fatin a reproducible local validation path.
- Mirrors the production frontend/backend separation managed by Shawn without attempting to emulate ECS.
- Keeps credential files read-only and outside images in coordination with Fatin's secret-handling policy.

### FA Demonstration Responsibilities

Ji Xun should demonstrate:

1. `docker compose config --quiet`;
2. building and starting both services;
3. backend health becoming ready before frontend startup;
4. service-to-service resolution over `firefighter-network`;
5. host port mapping;
6. backend restart and frontend recovery behavior;
7. the optional ADC overlay and why the file is mounted read-only.

### Technical Concepts to Explain

- multi-container orchestration;
- service discovery and bridge networking;
- health-based dependency ordering;
- environment interpolation;
- configuration overlays;
- persistent versus external services;
- reproducible local integration testing.

### Current Scope Size

**MEDIUM.** The component now combines two-service orchestration, health-aware startup, service DNS, environment validation, credential-safe overlays, automated build/health/proxy checks, a failure/recovery exercise, clean shutdown verification, and focused FA documentation.

## Shawn — Cloud Deployment

### Primary Ownership

Shawn owns production cloud delivery after the CI/security gates:

- GitHub OIDC authentication to the manually managed AWS deployment role;
- root-credential rejection and expected-role validation;
- separate backend/frontend ECR repositories;
- immutable SHA image tags and current `latest` aliases;
- discovery of active ECS Express task definitions and application container names;
- registration of new task-definition revisions while preserving existing runtime configuration;
- invocation of Ansible with non-secret deployment inputs;
- deployment preflight and existing-service validation;
- backend-first update, stabilization, and JSON `/health` verification;
- frontend update, stabilization, and smoke testing;
- idempotent no-op behavior when a service already uses the requested revision;
- verified restoration of previous revisions after failure;
- bounded ECS failure diagnostics and GitHub deployment summaries;
- sanitized, isolated, Gemini-assisted success summaries and failure diagnostics.

### Secondary / Extended Ownership

Shawn's current scope is already the largest. The recommended focus is depth and operational evidence rather than additional components:

- maintain rollback drills and failure-injection evidence;
- maintain least-privilege IAM action/resource guidance outside repository-managed infrastructure;
- keep bounded retry values aligned with observed ECS Express timings;
- maintain Gemini-analysis isolation, sanitization, schema validation, and human-review rules;
- keep deployment runbooks current when AWS service behavior changes.

### Exact Files and Components

| File or section | Classification | Responsibility |
|---|---|---|
| `.github/workflows/deploy.yml` — deploy job | Primary within shared workflow | OIDC, ECR, task definitions, Ansible invocation, and deployment summary |
| `.github/workflows/deploy.yml` — `gemini-deployment-analysis` job | Primary within shared workflow | Post-deployment advisory assessment and isolation |
| `ansible/deploy.yml` | Primary | Deployment entry point |
| `ansible/ansible.cfg`, inventory, and requirements files | Primary | Local-runner Ansible configuration and constrained tooling |
| `ansible/roles/ecs_express_deploy/defaults/main.yml` | Primary | Bounded retries, URLs, task definitions, and output paths |
| `ansible/roles/ecs_express_deploy/tasks/` | Primary | Preflight, sequencing, waits, health, smoke test, rollback, diagnostics, and summaries |
| `scripts/deployment-analysis/sanitizeDiagnostics.js` | Primary | Allowlisting, redaction, and payload bounds |
| `scripts/deployment-analysis/prepareDeploymentEvidence.js` | Primary | Curated success/failure pipeline evidence without environment dumps |
| `scripts/deployment-analysis/analyzeDeploymentFailure.js` | Primary | Schema-validated advisory Gemini analysis |
| `test/deploymentAnalysisDiagnostics.test.js` | Supporting | Gemini-analysis security-boundary regression coverage |
| `docs/FA-ANSIBLE-CLOUD-DEPLOYMENT.md` | Primary evidence | Cloud deployment explanation |
| `docs/FA-GEMINI-DEPLOYMENT-SUMMARY-AND-DIAGNOSTICS.md` | Primary evidence | Gemini-assisted analysis architecture and guardrails |

### Integration With Other Members

- Receives only the exact scanned image artifacts passed by Kiki's pipeline and Fatin's gates.
- Deploys the images built from Min's and Thein's Dockerfiles.
- Uses the same frontend/backend service separation exercised by Ji Xun locally.
- Does not alter scanner policy, Dockerfiles, application features, or existing AWS infrastructure.

### FA Demonstration Responsibilities

Shawn should demonstrate:

1. temporary OIDC role assumption and absence of static AWS keys;
2. separate SHA-tagged ECR images;
3. preserved task-definition settings with only the selected image changed;
4. Ansible preflight and backend-first ordering;
5. task-definition-to-service-revision correlation, exact new service-deployment pinning, and bounded authoritative polling until `SUCCESSFUL`;
6. backend `/health` before frontend rollout;
7. frontend smoke test;
8. no-op rerun behavior;
9. failed deployment, verified rollback, preserved original failure, and safe diagnostics;
10. successful-deployment assessment and failure analysis with no AWS credentials or automatic actions.

### Technical Concepts to Explain

- OIDC federation and temporary cloud credentials;
- ECR image promotion;
- ECS task-definition revisions and ECS Express services;
- idempotent deployment;
- bounded stabilization polling;
- health-gated progressive rollout;
- deterministic rollback;
- observability through allowlisted diagnostics;
- Gemini analysis guardrails and human-in-the-loop operations.

### Current Scope Size

**LARGE — the largest current scope.** It spans cloud identity, two image repositories, two production services, task-definition preservation, Ansible sequencing, health/smoke verification, idempotency, rollback, diagnostics, summaries, and a security-isolated Gemini-assisted analysis workflow.

## Fatin — DevSecOps

### Primary Ownership

Fatin owns the security controls that decide whether a release is eligible:

- production dependency auditing with `npm audit --omit=dev --audit-level=high`;
- Gitleaks scanning across source and Git history;
- pull-request read permission required for Gitleaks;
- Semgrep JavaScript and OWASP rules with SARIF evidence;
- pinned Trivy setup and version;
- backend and frontend image scanning for HIGH and CRITICAL OS/library vulnerabilities;
- fail-closed scanner exit behavior;
- security artifacts and retention;
- Dependabot update coverage for npm, GitHub Actions, and both Dockerfiles;
- secret-handling and vulnerability-exception guidance;
- security-gate placement before AWS authentication;
- supply-chain integrity intent for promoting the exact scanned images.

### Secondary / Extended Ownership

Recommended extension:

- own scanner-version review and upgrade evidence;
- maintain a vulnerability-triage and exception-expiry process;
- maintain a compact security evidence index for FA demonstrations;
- review dependency and container update pull requests;
- evaluate lightweight SBOM evidence if it adds demonstrable value without duplicating Trivy;
- maintain secret-safe failure output and artifact-retention guidance.

### Exact Files and Components

| File or section | Classification | Responsibility |
|---|---|---|
| `.github/workflows/deploy.yml` — npm audit step | Primary within shared workflow | Production dependency gate |
| `.github/workflows/deploy.yml` — `secret-scan` job | Primary within shared workflow | Gitleaks policy and PR permission |
| `.github/workflows/deploy.yml` — `sast` job | Primary within shared workflow | Semgrep policy and evidence |
| `.github/workflows/deploy.yml` — Trivy steps | Primary within shared workflow | Image vulnerability gate |
| `.github/workflows/deploy.yml` — security report artifacts | Primary/shared with Kiki | Evidence policy and retention |
| `.github/dependabot.yml` | Primary security policy | Automated dependency-update coverage |
| `SECURITY.md` | Primary documentation | Secret, vulnerability, exception, and response policy |
| `docs/FA-L4-DEVSECOPS.md` | Primary evidence | Gate rationale, demonstration, and rubric mapping |
| `test/deploymentAnalysisDiagnostics.test.js` — sanitizer and workflow-boundary cases | Supporting/shared with Shawn | Regression evidence for secret-safe diagnostics and isolated Gemini-analysis permissions |
| `.gitignore` and `.dockerignore` | Shared | Credential/build-context hygiene |
| `package-lock.json` | Supporting evidence | Reproducible dependency graph examined by npm audit |

### Integration With Other Members

- Defines security requirements that Kiki places in the pipeline graph.
- Scans the images produced from Min's and Thein's Dockerfiles.
- Uses Ji Xun's local Compose path for non-production validation where useful.
- Blocks Shawn's AWS authentication and deployment when any required gate fails.
- Provides remediation findings to the relevant component owner without taking over that component.

### FA Demonstration Responsibilities

Fatin should demonstrate:

1. all four mandatory security controls;
2. the HIGH/CRITICAL failure thresholds;
3. scanner pinning and security report artifacts;
4. a safe failed-gate scenario where deployment cannot start;
5. pull-request Gitleaks permission and behavior;
6. exact scanned-image preservation;
7. Dependabot coverage and the vulnerability response process.

### Technical Concepts to Explain

- shift-left security;
- SCA, secret scanning, SAST, and container scanning;
- severity thresholds and fail-closed controls;
- SARIF and security evidence;
- scanner and action pinning;
- software supply-chain integrity;
- vulnerability triage and exception governance.

### Current Scope Size

**LARGE.** Four mandatory security controls, fail-closed release policy, scanner pinning, artifact evidence, Dependabot, and security governance provide broad technical content. It is substantial but more bounded than Shawn's end-to-end production operations scope.

## Shared Components

Shared means that one file contains multiple responsibilities. It does not erase the primary boundary.

| Component | Members | Boundary |
|---|---|---|
| `.github/workflows/deploy.yml` | Kiki, Fatin, Shawn | Kiki owns orchestration; Fatin owns security gates; Shawn owns cloud deployment, Ansible invocation, and Gemini-assisted analysis behavior |
| Build-and-scan job | Kiki, Min, Thein, Fatin | Kiki sequences; Min/Thein own successful image construction; Fatin owns Trivy policy |
| Scanned image artifacts | Kiki, Fatin, Shawn | Kiki owns transfer; Fatin owns scan-to-deploy integrity intent; Shawn consumes artifacts without rebuilding |
| `docker-compose.yml` | Ji Xun, Min, Thein | Ji Xun owns orchestration; Min and Thein own the container contracts being orchestrated |
| `.env.example` | Ji Xun, Min, Thein, Shawn, Fatin | Local wiring, runtime contracts, cloud non-secret settings, and secret-handling examples meet in one template |
| `.dockerignore` | Min, Thein, Fatin | Frontend/backend build-context efficiency and credential hygiene |
| `/health` | Thein, Ji Xun, Shawn | Application team supplies lightweight liveness; Thein packages it, Ji Xun uses it locally, and Shawn verifies it in production |
| `README.md` DevOps sections | All | Shared operator documentation; detailed FA evidence remains in specialist documents |

Application feature ownership—including Gemini report generation, Speech-to-Text behavior, database features, maps, and user-interface business logic—is outside this DevOps allocation. Those features are runtime dependencies or validation targets, not reassigned responsibilities.

## Responsibility Boundaries

### Kiki Does Not Own

- scanner rules, thresholds, or vulnerability triage;
- Dockerfile implementation;
- AWS CLI/ECR/ECS internals;
- Ansible deployment logic;
- application features.

### Min Does Not Own

- backend image design;
- Compose orchestration;
- CI/CD job dependencies;
- production ECS deployment;
- application backend implementation.

### Thein Does Not Own

- frontend Nginx behavior;
- Compose orchestration;
- scanner policy;
- AWS deployment;
- application feature logic.

### Ji Xun Does Not Own

- Dockerfile internals;
- production deployment;
- AWS infrastructure;
- scanner thresholds;
- application service implementation.

### Shawn Does Not Own

- generic CI job design;
- scanner implementation or policy;
- frontend/backend Dockerfiles;
- local Compose architecture;
- Gemini, STT, database, or UI application logic.

### Fatin Does Not Own

- general workflow sequencing outside security dependencies;
- container feature design;
- Ansible rollout logic;
- AWS service administration;
- automatic remediation of application findings.

## Recommended Additional Responsibilities

| Priority | Member | Natural Additional Contribution | Concrete FA Evidence | Why It Fits |
|---|---|---|---|---|
| High | Min | Frontend container runtime/hardening validation | Valid/invalid `BACKEND_URL` demonstration, health proof, image inspection, Nginx troubleshooting matrix | Extends the existing frontend container boundary |
| Completed | Ji Xun | Local integration smoke and recovery validation | Compose config proof, health-order demo, restart/recovery scenario, overlay documentation | Adds operational depth to local orchestration |
| Medium | Kiki | Pipeline observability and artifact lifecycle | Trigger matrix, job DAG, artifact-retention map, failure-propagation evidence | Strengthens orchestration without taking scanner/cloud ownership |
| Medium | Thein | Backend lifecycle and production-runtime evidence | Signal/health/runbook evidence, image UID/size/runtime inspection | Deepens the existing backend image responsibility |
| Low | Fatin | Security evidence governance | Scanner-version register, triage process, exception expiry, optional SBOM evaluation | Current scope is already substantial |
| None required | Shawn | Reliability drills rather than new scope | Rollback/no-op/failure-diagnostic demonstrations | Current scope is already the largest |

No member should receive a second unrelated platform merely to make the allocation look equal. Balanced assessment is better achieved by giving narrower component owners deeper validation, troubleshooting, documentation, and demonstration responsibility within their existing boundary.

## Final Allocation

| Member | Final Primary Deliverable | Final Extended Deliverable | Integration Proof | Explicit Boundary |
|---|---|---|---|---|
| Kiki | Reliable GitHub Actions CI/CD graph | Pipeline observability and artifact lifecycle | PR/main/manual runs and immutable artifact hand-off | Not scanner policy or cloud implementation |
| Min | Production-ready frontend Nginx image | Runtime validation and container hardening evidence | Correct proxy/health behavior locally and in ECS | Not Compose or backend |
| Thein | Production-ready backend Node image | Runtime lifecycle and container validation evidence | Healthy non-root backend locally and in ECS | Not application features or cloud |
| Ji Xun | Reproducible two-service Compose environment | Local smoke/recovery scenarios | Healthy startup, networking, and overlay behavior | Not production deployment |
| Shawn | Secure AWS/ECS deployment with Ansible | Verified rollback, diagnostics, summaries, and Gemini-assisted analysis | Backend-first production deployment and failure recovery | Not pipeline/scanner/container ownership |
| Fatin | Fail-closed DevSecOps gates | Security evidence and dependency governance | Unsafe releases blocked before AWS access | Not deployment implementation |

## FA Readiness

| Member | Current Readiness | Evidence Strength | Readiness Action |
|---|---|---|---|
| Kiki | High | Strong integrated workflow and artifact chain | Prepare a concise job-DAG and failure-propagation demonstration |
| Min | Medium | Working frontend image and Nginx configuration, but narrower scope | Complete runtime/hardening validation evidence |
| Thein | High | Strong multi-stage, pinned, distroless, non-root backend image | Prepare lifecycle and standalone health demonstration |
| Ji Xun | High | Two-service Compose plus automated DNS, health, proxy, recovery, and cleanup evidence | Rehearse the documented 3–5 minute demonstration |
| Shawn | High | Broad production deployment, rollback, diagnostics, and Gemini deployment evidence | Rehearse success, no-op, and rollback demonstrations |
| Fatin | High | Four integrated gates plus supporting governance/evidence | Rehearse one safe blocked-release demonstration |

## Presentation Summary

GitHub Actions and Ansible are both used because they solve different problems. GitHub Actions is the control plane for CI/CD events, test/security prerequisites, immutable artifacts, cloud authentication, and job sequencing. Ansible is the deterministic deployment engine that applies backend-first ECS changes, correlates each requested task definition to its exact service revision and new service-deployment ARN, waits for that deployment to become `SUCCESSFUL`, verifies health, performs smoke tests, and restores previous revisions on failure.

The team's Cloud Deployment and Continuous Deployment contribution is an end-to-end automated release path with two purpose-built containers, reproducible local orchestration, mandatory security controls, temporary OIDC cloud authentication, separate ECR/ECS services, progressive verification, rollback, bounded diagnostics, and human-reviewed Gemini-assisted advice.

This demonstrates DevOps automation and security because a source change follows a controlled path from CI through security and immutable image promotion to verified production deployment. Unsafe or unhealthy changes are blocked or rolled back, while the responsibility for each stage remains clear and independently demonstrable.
