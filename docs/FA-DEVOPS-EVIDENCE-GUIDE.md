# FA DevOps Evidence Guide

## Purpose

Use this checklist to capture concise, current evidence for the FA
presentation. It points to existing implementation and validation rather than
duplicating the component documents.

Evidence should be labelled as:

- **LOCAL** — run in Docker or Node.js on a team member's workstation;
- **CI/CD** — produced by GitHub Actions; or
- **CLOUD** — produced by the live ECR/ECS deployment.

Redact account identifiers where appropriate and never capture secret values,
tokens, task-definition environment contents, transcripts, or credentials.

## CI/CD

Open one successful `DevSecOps CI/CD` run and capture:

- the complete workflow graph;
- `Test and dependency security gate`;
- all automated tests passing;
- production `npm audit` passing;
- Gitleaks passing;
- Semgrep passing;
- backend image build;
- frontend image build;
- backend Trivy HIGH/CRITICAL gate;
- frontend Trivy HIGH/CRITICAL gate;
- exact scanned-image artifact export; and
- the deployment job completing successfully.

Explain that pull requests run the CI/security/build stages but skip deployment.
The deployment job depends on all upstream gates and receives OIDC permission
only after they pass.

Primary file: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml).

## Frontend Docker

Run:

```powershell
npm run frontend:container-test
```

Capture the final successful output and highlight:

- native frontend health;
- static HTTP response;
- API reverse proxy;
- real WebSocket upgrade;
- forwarding headers;
- invalid and injection-like `BACKEND_URL` rejection;
- graceful shutdown; and
- automatic cleanup.

Primary references:

- [`../frontend/Dockerfile`](../frontend/Dockerfile)
- [`../frontend/nginx.conf.template`](../frontend/nginx.conf.template)
- [`../scripts/frontend-container-smoke.js`](../scripts/frontend-container-smoke.js)
- [`FA-FRONTEND-DOCKER.md`](FA-FRONTEND-DOCKER.md)

## Backend Docker

Run:

```powershell
docker build --pull -t firefighter-backend:fa .

docker image inspect firefighter-backend:fa --format 'User={{.Config.User}} Health={{json .Config.Healthcheck.Test}}'

docker history firefighter-backend:fa
```

Capture:

- successful multi-stage build;
- non-root `User=65532`;
- health-check metadata;
- digest-pinned base images in the Dockerfile;
- backend Trivy PASS in GitHub Actions;
- active ECS backend revision; and
- public backend `/health` PASS.

Use [`FA-BACKEND-DOCKER.md`](FA-BACKEND-DOCKER.md) for the detailed explanation.

## Docker Compose

Run:

```powershell
npm run compose:smoke
```

Capture or highlight:

- isolated Compose project creation;
- backend health;
- frontend health;
- Docker DNS using `backend`;
- frontend-to-backend HTTP proxying;
- deliberate local backend stop;
- expected proxy degradation;
- backend restart and proxy recovery; and
- cleanup of temporary containers, network, and images.

This is a safe local failure demonstration. It is not evidence of an ECS
failure and does not affect production.

Primary references:

- [`../docker-compose.yml`](../docker-compose.yml)
- [`../docker-compose.gcp.yml`](../docker-compose.gcp.yml)
- [`../scripts/compose-smoke.js`](../scripts/compose-smoke.js)
- [`FA-DOCKER-COMPOSE.md`](FA-DOCKER-COMPOSE.md)

## AWS and Ansible

From a successful main-branch deployment, capture:

- GitHub OIDC role assumption;
- confirmation that the caller is the expected deployment role;
- separate backend and frontend ECR pushes;
- immutable commit-SHA image URIs;
- backend and frontend task-definition revision registration;
- backend update and exact-revision stabilization;
- backend `/health` PASS;
- frontend update and exact-revision stabilization;
- frontend smoke PASS; and
- Ansible recap and GitHub Actions summary.

Explain the division:

```text
GitHub Actions
  -> security/build orchestration
  -> OIDC
  -> ECR publication
  -> task-definition registration

Ansible
  -> backend-first service update
  -> bounded stabilization
  -> health and smoke verification
  -> rollback and diagnostics
```

For rollback evidence, show:

- `ansible/roles/ecs_express_deploy/tasks/main.yml`;
- `rollback.yml`;
- `wait_for_service.yml`; and
- `failure_diagnostics.yml`.

Do not intentionally break production. Explain the code path and use existing
unit/static evidence rather than creating a real ECS failure.

Primary reference: [`FA-ANSIBLE-CLOUD-DEPLOYMENT.md`](FA-ANSIBLE-CLOUD-DEPLOYMENT.md).

## DevSecOps

Capture:

- `npm audit --omit=dev --audit-level=high` with zero vulnerabilities;
- Gitleaks successful result;
- Semgrep successful result and SARIF artifact;
- backend Trivy HIGH/CRITICAL gate;
- frontend Trivy HIGH/CRITICAL gate; and
- the workflow `needs` relationships that prevent deployment after an upstream
  failure.

Explain that:

- Gitleaks checks secret exposure;
- Semgrep checks source patterns;
- npm audit checks production JavaScript dependencies;
- Trivy checks the two built container images; and
- OIDC removes the need for stored AWS access keys.

These are mandatory controls in the current pipeline. CodeRabbit is not one of
these security gates.

Primary reference: [`FA-L4-DEVSECOPS.md`](FA-L4-DEVSECOPS.md).

## Gemini-Assisted Deployment Summary and Failure Diagnostics

Present the capability accurately as assisted summarisation and diagnostics,
not autonomous operations:

- implemented as an assessment after every completed deployment;
- covered by focused unit tests;
- connected to both successful and failed deployment paths;
- advisory only;
- receives allowlisted and sanitized evidence;
- reports healthy successful deployments as low risk and requires human review
  for failures or warnings;
- has no AWS credentials, OIDC permission, deployment command, rollback
  command, or tool execution; and
- has not been deliberately demonstrated through a real cloud deployment
  failure.

Show:

- `scripts/deployment-analysis/sanitizeDiagnostics.js`;
- `scripts/deployment-analysis/prepareDeploymentEvidence.js`;
- `scripts/deployment-analysis/analyzeDeploymentFailure.js`;
- `test/deploymentAnalysisDiagnostics.test.js`;
- the isolated `gemini-deployment-analysis` workflow job; and
- [`FA-GEMINI-DEPLOYMENT-SUMMARY-AND-DIAGNOSTICS.md`](FA-GEMINI-DEPLOYMENT-SUMMARY-AND-DIAGNOSTICS.md).

Run `npm run gemini:deployment:demo` to present the controlled local failure path. It uses
synthetic diagnostics and a mocked AI response while exercising the production
sanitizer and analyzer validation. It does not obtain AWS credentials, call
ECS or Gemini, invoke rollback, or intentionally fail production. Label this
as **SIMULATED LOCAL FAILURE EVIDENCE**, not cloud-failure proof.

From any normal successful deployment, capture the executed
`Gemini Deployment Summary` job and `# Gemini Deployment Summary`. Show the
successful outcome, `HEALTHY_DEPLOYMENT`, low risk, PASS evidence, selected
`LIVE_VALIDATED`, `LIVE_UNVALIDATED`, or `FALLBACK` mode, and zero AWS,
deployment, rollback, and remediation actions by the Gemini analysis job.

For integrated synthetic failure evidence, manually run **DevSecOps CI/CD**
with `run_gemini_deployment_demo=true`. Capture the successful gates, normal AWS deployment,
health/smoke verification, real success assessment, and the additional
**FA DEMO — SYNTHETIC FAILURE EVIDENCE** section. Show real deployment
`SUCCESS`, synthetic scenario `FAILED`, mandatory human review for the
synthetic failure, and the same zero-authority boundary. The standalone
**Gemini Deployment Demo** workflow remains available when a deployment is not
required.

## CodeRabbit

Describe CodeRabbit as **AI-assisted pull-request review and developer workflow
automation**.

Suitable evidence:

- `.coderabbit.yaml` loaded from a controlled feature branch;
- automatic review on a non-draft pull request;
- concise actionable comments;
- a later incremental review after one harmless correction; and
- normal CI/security checks remaining independent.

CodeRabbit is:

- optional;
- not a required DevSecOps security gate;
- not part of deployment analysis;
- not authorized to deploy or change AWS; and
- not a substitute for tests or human review.

Never merge intentionally flawed demonstration code into `main`. Retain the
review screenshots or PR discussion as evidence, then remove the temporary
demo code.

## Final capture checklist

| Evidence | Layer | Captured |
|---|---|---|
| Successful workflow graph | CI/CD | ☐ |
| Automated test suite passing | LOCAL/CI | ☐ |
| npm audit PASS | LOCAL/CI | ☐ |
| Gitleaks and Semgrep PASS | CI/CD | ☐ |
| Backend and frontend Trivy PASS | CI/CD | ☐ |
| Frontend container test | LOCAL | ☐ |
| Backend image metadata | LOCAL | ☐ |
| Compose failure and recovery | LOCAL | ☐ |
| OIDC and ECR publication | CLOUD | ☐ |
| Backend health and frontend smoke | CLOUD | ☐ |
| Ansible deployment recap | CLOUD | ☐ |
| Rollback implementation | CODE EVIDENCE | ☐ |
| Gemini analysis guardrails and unit tests | CODE/LOCAL | ☐ |
| CodeRabbit controlled PR review | DEVELOPER WORKFLOW | ☐ |
