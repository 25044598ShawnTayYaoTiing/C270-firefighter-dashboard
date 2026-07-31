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

## AIOps

Present the capability accurately:

- implemented as deployment-failure analysis;
- covered by focused unit tests;
- connected to the failed-deployment workflow path;
- advisory only;
- receives allowlisted and sanitized diagnostics;
- requires human review;
- has no AWS credentials, OIDC permission, deployment command, rollback
  command, or tool execution; and
- has not been deliberately demonstrated through a real cloud deployment
  failure.

Show:

- `scripts/aiops/sanitizeDiagnostics.js`;
- `scripts/aiops/analyzeDeploymentFailure.js`;
- `test/aiopsDiagnostics.test.js`;
- the isolated `aiops-analysis` workflow job; and
- [`FA-AIOPS-DEPLOYMENT-FAILURE-ANALYSIS.md`](FA-AIOPS-DEPLOYMENT-FAILURE-ANALYSIS.md).

Run `npm run aiops:demo` to present the controlled local failure path. It uses
synthetic diagnostics and a mocked AI response while exercising the production
sanitizer and analyzer validation. It does not obtain AWS credentials, call
ECS or Gemini, invoke rollback, or intentionally fail production. Label this
as **SIMULATED LOCAL FAILURE EVIDENCE**, not cloud-failure proof.

For GitHub-hosted evidence, manually run **AIOps FA Demonstration**. Capture its
sanitization step and Actions Summary, including the clearly labelled
`LIVE GEMINI`, `MOCKED`, or fallback mode; mandatory human review; preserved
`FAILED` result; and zero AWS, deployment, rollback, and remediation actions.

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
- not AIOps;
- not authorized to deploy or change AWS; and
- not a substitute for tests or human review.

Never merge intentionally flawed demonstration code into `main`. Retain the
review screenshots or PR discussion as evidence, then remove the temporary
demo code.

## Final capture checklist

| Evidence | Layer | Captured |
|---|---|---|
| Successful workflow graph | CI/CD | ☐ |
| 86 automated tests | LOCAL/CI | ☐ |
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
| AIOps guardrails and unit tests | CODE/LOCAL | ☐ |
| CodeRabbit controlled PR review | DEVELOPER WORKFLOW | ☐ |
