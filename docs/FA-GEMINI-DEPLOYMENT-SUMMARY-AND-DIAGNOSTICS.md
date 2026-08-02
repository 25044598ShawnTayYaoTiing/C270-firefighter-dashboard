# FA DevOps — Gemini-Assisted Deployment Summary and Failure Diagnostics

## Purpose

The repository adds a read-only Gemini Deployment Summary and Gemini Failure
Diagnostics step after every completed AWS deployment job. It does not replace
deterministic CI/CD, Ansible verification, or rollback.

Google Gemini provides an assisted summary of deployment results and failure
diagnostics. It converts bounded workflow and Ansible output into a concise
human-readable explanation, while the actual deployment, validation, and
rollback processes remain controlled by GitHub Actions, Ansible, and Amazon
ECS.

```text
Tests and security gates
  -> build and Trivy
  -> GitHub OIDC deployment job
  -> ECR and ECS Express deployment
  -> backend health and frontend smoke verification
  -> sanitized deployment evidence
  -> isolated Gemini analysis job
  -> Gemini or deterministic fallback
  -> GitHub Actions Summary
```

Successful deployments receive a concise health and risk assessment. Failed
deployments retain the deeper failure classification, likely cause,
recommended checks, rollback evidence, and mandatory human review. A failed
deploy job remains failed regardless of the Gemini result.

GitHub Actions remains the CI/CD orchestrator. Ansible remains solely
responsible for backend-first deployment, bounded ECS stabilization, backend
`/health`, frontend smoke testing, and rollback.

## Sanitized evidence

`scripts/deployment-analysis/prepareDeploymentEvidence.js` creates one fixed evidence format
for either outcome. For success it records only deterministic facts already
known by the workflow:

- deployment outcome and bounded duration;
- tests, security gates, and container scan results;
- ECS stabilization, backend health, and frontend smoke results;
- immutable backend and frontend image identifiers;
- previous, requested, and active task-definition identifiers; and
- run ID, commit SHA, branch, schema version, and timestamp.

The deployment job can run only after the test, Gitleaks, Semgrep, dependency
audit, build, and Trivy jobs pass. Therefore those recorded gate results are
derived from enforced workflow dependencies, not model inference.

For failure, the producer enriches the existing allowlisted Ansible diagnostic
record with those same pipeline facts. Ansible remains responsible for
collecting the failure stage, failed task, bounded ECS state, verification
results, and rollback results.

`scripts/deployment-analysis/sanitizeDiagnostics.js` then rebuilds either document from a
nested allowlist before redaction. It strips unsupported fields, redacts
credential-shaped text, removes control characters, limits deployment arrays,
truncates individual strings, and enforces a total payload limit. The analyzer
applies the same sanitizer again after download.

The artifact never includes environment dumps, task-definition bodies,
application payloads, transcripts, headers, cookies, database values, API
keys, AWS credentials, or tokens. Artifact retention is seven days.

## Structured assessment

The isolated job uses the dedicated `DEPLOYMENT_GEMINI_API_KEY` GitHub Actions
secret. It never uses the application's `GEMINI_API_KEY`. The
`DEPLOYMENT_GEMINI_MODEL` repository variable selects the model, with
`gemini-3.5-flash-lite` as the default.

The production analyzer converts the sanitized diagnostic record into a
deterministic evidence catalog. Each observed fact receives an identifier such
as `E1`, while its allowlisted field name and sanitized value remain in the
catalog. Gemini receives that catalog instead of the full diagnostic object.
The response schema dynamically restricts `supportedEvidence` to the exact IDs
available for that assessment.

The analyzer uses a fixed instruction, structured JSON output, no tools, no
function calling, and no autonomous action interface. Its validated response
contains:

- deployment outcome;
- classification and risk level;
- bounded confidence and one to six allowlisted evidence IDs;
- operational summary;
- likely cause for failures;
- recommended checks or actions for a human; and
- whether human review is required.

Model-authored observation fields are not accepted. The summary renders the
selected evidence IDs and their allowlisted field names deterministically.
Operational summary and likely cause are explicitly analysis/inference fields;
recommendations are labelled as human advice and never become observed
evidence. The prompt requires `UNKNOWN` when the catalog is insufficient and
forbids invented logs, metrics, AWS states, revisions, events, health results,
or causes.

Success classifications are `HEALTHY_DEPLOYMENT` and `DEPLOYMENT_WARNING`.
Existing failure classifications remain `ECS_ROLLOUT_FAILURE`,
`BACKEND_HEALTH_FAILURE`, `FRONTEND_SMOKE_FAILURE`, `ROLLBACK_FAILURE`,
`AUTHORIZATION_FAILURE`, `CONFIGURATION_FAILURE`, `NETWORK_FAILURE`, and
`UNKNOWN`.

The response must match the authoritative deployment outcome. A failed
deployment must set `humanReviewRequired: true`. A successful assessment may
set it to `false` only when every supplied pipeline check is `PASS`, the
classification is `HEALTHY_DEPLOYMENT`, and risk is `LOW`. Any warning or
incomplete evidence requires human review.

If the first response contains unsupported evidence IDs, the analyzer permits
exactly one corrective request using the same catalog, the safe validation
error, and an instruction to use only allowed IDs. There is no retry loop. A
second structurally valid but evidence-invalid response becomes
`LIVE_UNVALIDATED`: deterministic fallback remains official, while a bounded,
sanitized copy of the known response fields is displayed separately for human
review.

`LIVE_VALIDATED` is used only after request, parsing, schema, and evidence
validation all pass. `LIVE_UNVALIDATED` requires successful parsing and schema
validation but failed evidence validation. In that mode the proposed model
classification, risk, and recommendations are non-authoritative and cannot
replace the deterministic assessment. `FALLBACK` is used when Gemini is
unavailable, parsing fails, schema validation fails, or no safe structured
response exists.

The summary records Gemini request, structured-validation, and
evidence-validation status, whether the one corrective retry was used, and a
bounded redacted failure category. It also identifies valid, missing, and
unsupported evidence IDs for an unvalidated draft. API transport failures
remain separate from response parsing, schema validation, and evidence-ID
validation. Safe HTTP status and provider code fields are included when
available; credentials, headers, raw response bodies, arbitrary response
fields, and environment data are never included. A complete successful
all-pass record remains
`HEALTHY_DEPLOYMENT / LOW`; failed or incomplete records require review. The
fallback and unvalidated draft cannot change deployment state.

## GitHub Actions summary

Every completed deploy job produces `# Gemini Deployment Summary` with:

- authoritative deployment result and explicit Gemini validation mode;
- model, official classification, official risk, and duration;
- test, security, scan, stabilization, health, and smoke evidence;
- safe image and task-definition identifiers;
- Gemini request and structured/evidence validation status;
- selected allowlisted evidence IDs, operational summary, and recommended checks;
- a separately warned, sanitized `LIVE_UNVALIDATED` draft only when parsing and
  schema validation passed but evidence validation failed;
- failure cause and rollback evidence when applicable; and
- the explicit no-authority safety boundary.

The Gemini analysis job condition is:

```yaml
always() &&
(needs.deploy.result == 'success' ||
 needs.deploy.result == 'failure')
```

Pull requests, scan-only manual runs, and runs where an upstream CI/security
gate prevents the deploy job are excluded because the deploy job result is
`skipped`, not `success` or `failure`.

## Security isolation

```text
Deploy job
  -> contents: read + id-token: write
  -> temporary GitHub OIDC AWS session
  -> ECR, task-definition registration, and Ansible/ECS
  -> no DEPLOYMENT_GEMINI_API_KEY

Gemini analysis job
  -> contents: read only
  -> DEPLOYMENT_GEMINI_API_KEY only in the Gemini step
  -> no id-token: write
  -> no AWS credential action or AWS API call
  -> no Ansible, deployment, rollback, or remediation command
```

The analysis steps are non-blocking. A successful deployment cannot be turned
into a failed deployment by an unavailable AI service. A failed deployment
cannot be turned into success by Gemini, fallback analysis, or successful
rollback. Deterministic workflow and Ansible results remain authoritative.

Diagnostic strings are explicitly treated as untrusted data. Evidence paths
must refer to fields present in the sanitized document, model text is bounded
and redacted before rendering, and model-supplied commands have no execution
path.

## Safe FA demonstrations

Run the local synthetic failure demonstration with:

```powershell
npm run gemini:deployment:demo
```

It uses fake failure evidence and a mocked Gemini client while exercising the
production sanitizer, analyzer schema, prompt-injection boundary, and failed
deployment invariants. It performs no AWS, Gemini, or other network request.

For an integrated presentation, manually run **DevSecOps CI/CD** with
`run_gemini_deployment_demo=true`. The workflow first completes the real deployment and
its normal Gemini Deployment Summary. It then runs the synthetic scenario in
the same isolated job and labels it:

> **FA DEMO — SYNTHETIC FAILURE EVIDENCE**

The summary keeps the real deployment `SUCCESS` separate from the synthetic
scenario `FAILED`. The standalone **Gemini Deployment Demo** workflow remains
available when a deployment is not desired.

For a fast, unmocked check of the production Gemini client, structured-output
schema, response parser, and validator, run:

```powershell
$secureKey = Read-Host 'DEPLOYMENT_GEMINI_API_KEY' -AsSecureString
$env:DEPLOYMENT_GEMINI_API_KEY = [Net.NetworkCredential]::new('', $secureKey).Password
$env:DEPLOYMENT_GEMINI_MODEL = 'gemini-3.5-flash-lite'
npm run gemini:deployment:smoke:live
Remove-Item Env:DEPLOYMENT_GEMINI_API_KEY
Remove-Item Env:DEPLOYMENT_GEMINI_MODEL
```

The manual-only **Gemini Deployment Summary and Failure Diagnostics LIVE Smoke Test** GitHub workflow performs the
same check using the `DEPLOYMENT_GEMINI_API_KEY` secret and `DEPLOYMENT_GEMINI_MODEL`
variable. It has `contents: read` only, no OIDC permission, no AWS credentials,
and no deployment or rollback commands. It uses small synthetic sanitized
failure evidence and no mock client. A fallback writes its safe failure stage
and category to the Actions summary and fails the smoke job without affecting
ECS. A successful run reports `LIVE_VALIDATED`, request `SUCCESS`, structured
validation `PASS`, evidence validation `PASS`, the selected model,
classification, risk, evidence IDs, and human-review decision.

Synthetic evidence is used because intentionally breaking ECS for assessment
evidence would create unnecessary production risk.

## Limitations

This is an advisory Gemini feature, not an autonomous operations platform.
Gemini summarises successful deployment results, assists with failure
diagnostics, and suggests possible causes and troubleshooting actions. It does
not deploy, monitor, roll back, or autonomously repair the system. Deployment
decisions, validation, rollback, and infrastructure operations remain
deterministic and controlled by the existing automation tools.

- Gemini does not directly deploy the application, approve releases, modify
  production, execute remediation, or initiate rollback.
- GitHub Actions remains responsible for CI/CD orchestration; Ansible remains
  responsible for ECS deployment sequencing, validation, and rollback; Amazon
  ECS/Fargate remains the runtime and container orchestrator.
- CloudWatch remains the AWS logging and operational-metrics service. This
  repository does not make Gemini a replacement for CloudWatch or a continuous
  production-monitoring platform.
- Gemini does not guarantee that a diagnosis is correct. Its output is
  probabilistic, advisory, and subject to schema and evidence validation.

- Evidence is intentionally limited to bounded workflow and Ansible/ECS
  deployment facts; it does not ingest CloudWatch or full application logs.
- Gemini recommendations are probabilistic and advisory.
- A failure before evidence preparation receives a safe fallback summary with
  unavailable fields rather than fabricated evidence.
- External Gemini availability, credentials, quota, and model access remain
  operational dependencies for `LIVE_VALIDATED` and `LIVE_UNVALIDATED` modes.

## Configuration identifiers

The externally configured GitHub secret is `DEPLOYMENT_GEMINI_API_KEY`, the
repository variable is `DEPLOYMENT_GEMINI_MODEL`, and the workflow-dispatch
input is `run_gemini_deployment_demo`. These identifiers are used consistently
by the workflows, scripts, tests, and documentation.
