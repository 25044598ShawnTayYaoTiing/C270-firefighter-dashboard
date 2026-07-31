# FA AIOps Deployment Assessment and Failure Analysis

## Purpose

The repository adds a small read-only AIOps assessment after every completed
AWS deployment job. It does not replace deterministic CI/CD, Ansible
verification, or rollback.

```text
Tests and security gates
  -> build and Trivy
  -> GitHub OIDC deployment job
  -> ECR and ECS Express deployment
  -> backend health and frontend smoke verification
  -> sanitized deployment evidence
  -> isolated AIOps job
  -> Gemini or deterministic fallback
  -> GitHub Actions Summary
```

Successful deployments receive a concise health and risk assessment. Failed
deployments retain the deeper failure classification, likely cause,
recommended checks, rollback evidence, and mandatory human review. A failed
deploy job remains failed regardless of the AIOps result.

GitHub Actions remains the CI/CD orchestrator. Ansible remains solely
responsible for backend-first deployment, bounded ECS stabilization, backend
`/health`, frontend smoke testing, and rollback.

## Sanitized evidence

`scripts/aiops/prepareDeploymentEvidence.js` creates one fixed evidence format
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

`scripts/aiops/sanitizeDiagnostics.js` then rebuilds either document from a
nested allowlist before redaction. It strips unsupported fields, redacts
credential-shaped text, removes control characters, limits deployment arrays,
truncates individual strings, and enforces a total payload limit. The analyzer
applies the same sanitizer again after download.

The artifact never includes environment dumps, task-definition bodies,
application payloads, transcripts, headers, cookies, database values, API
keys, AWS credentials, or tokens. Artifact retention is seven days.

## Structured assessment

The isolated job uses the dedicated `AIOPS_GEMINI_API_KEY` GitHub Actions
secret. It never uses the application's `GEMINI_API_KEY`. The
`AIOPS_GEMINI_MODEL` repository variable selects the model, with
`gemini-3.5-flash-lite` as the default.

The production analyzer uses a fixed instruction, structured JSON output, no
tools, no function calling, and no autonomous action interface. Its validated
response contains:

- deployment outcome;
- classification and risk level;
- bounded confidence and evidence paths;
- operational summary;
- likely cause for failures;
- notable observations;
- recommended checks or actions for a human; and
- whether human review is required.

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

If Gemini is unavailable, malformed, or returns unsupported evidence, the
analyzer emits a clearly labelled `FALLBACK` assessment from deterministic
pipeline facts. The summary records whether LIVE Gemini was attempted and a
bounded, redacted failure stage and category. API transport failures are kept
separate from response parsing, schema validation, and evidence-path
validation. Safe HTTP status and provider code fields are included when
available; credentials, headers, raw response bodies, and environment data are
never included. A complete successful all-pass record remains
`HEALTHY_DEPLOYMENT / LOW`; failed or incomplete records require review. The
fallback cannot change deployment state.

## GitHub Actions summary

Every completed deploy job produces `# AIOps Deployment Summary` with:

- execution mode, model, outcome, classification, risk, and duration;
- test, security, scan, stabilization, health, and smoke evidence;
- safe image and task-definition identifiers;
- operational summary, observations, and recommended checks;
- failure cause and rollback evidence when applicable; and
- the explicit no-authority safety boundary.

The AIOps job condition is:

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
  -> no AIOPS_GEMINI_API_KEY

AIOps job
  -> contents: read only
  -> AIOPS_GEMINI_API_KEY only in the Gemini step
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
npm run aiops:demo
```

It uses fake failure evidence and a mocked Gemini client while exercising the
production sanitizer, analyzer schema, prompt-injection boundary, and failed
deployment invariants. It performs no AWS, Gemini, or other network request.

For an integrated presentation, manually run **DevSecOps CI/CD** with
`run_aiops_demo=true`. The workflow first completes the real deployment and
its normal AIOps success assessment. It then runs the synthetic scenario in
the same isolated job and labels it:

> **FA DEMO — SYNTHETIC FAILURE EVIDENCE**

The summary keeps the real deployment `SUCCESS` separate from the synthetic
scenario `FAILED`. The standalone **AIOps FA Demonstration** workflow remains
available when a deployment is not desired.

For a fast, unmocked check of the production Gemini client, structured-output
schema, response parser, and validator, run:

```powershell
$secureKey = Read-Host 'AIOPS_GEMINI_API_KEY' -AsSecureString
$env:AIOPS_GEMINI_API_KEY = [Net.NetworkCredential]::new('', $secureKey).Password
$env:AIOPS_GEMINI_MODEL = 'gemini-3.5-flash-lite'
npm run aiops:smoke:live
Remove-Item Env:AIOPS_GEMINI_API_KEY
Remove-Item Env:AIOPS_GEMINI_MODEL
```

The manual-only **AIOps LIVE Gemini Smoke Test** GitHub workflow performs the
same check using the `AIOPS_GEMINI_API_KEY` secret and `AIOPS_GEMINI_MODEL`
variable. It has `contents: read` only, no OIDC permission, no AWS credentials,
and no deployment or rollback commands. It uses small synthetic sanitized
failure evidence and no mock client. A fallback writes its safe failure stage
and category to the Actions summary and fails the smoke job without affecting
ECS.

Synthetic evidence is used because intentionally breaking ECS for assessment
evidence would create unnecessary production risk.

## Limitations

- Evidence is intentionally limited to bounded workflow and Ansible/ECS
  deployment facts; it does not ingest CloudWatch or full application logs.
- Gemini recommendations are probabilistic and advisory.
- A failure before evidence preparation receives a safe fallback summary with
  unavailable fields rather than fabricated evidence.
- External Gemini availability, credentials, quota, and model access remain
  operational dependencies for `LIVE GEMINI` mode.
