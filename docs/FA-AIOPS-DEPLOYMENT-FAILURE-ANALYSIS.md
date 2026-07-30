# FA AIOps Deployment-Failure Analysis

## Purpose

This repository adds a small read-only AIOps layer to the existing deployment workflow. It does not replace deterministic CI/CD, deployment verification, or rollback.

```text
Normal:
GitHub Actions -> security gates -> ECR -> Ansible -> ECS -> success

Failure:
GitHub Actions
  -> Ansible deployment or verification failure
  -> deterministic rollback and rollback verification
  -> allowlisted diagnostics
  -> sanitizer
  -> isolated AIOps job
  -> Gemini classification
  -> advisory GitHub Actions summary
  -> mandatory human review
```

GitHub Actions remains the CI/CD orchestrator. Ansible remains solely responsible for backend-first deployment, `/health`, frontend smoke testing, and rollback. Gemini can only observe the resulting sanitized failure record and recommend a human next step.

## Diagnostic artifact

After a tracked deployment or verification failure, and only after rollback results are known, Ansible writes `deployment-diagnostics.json` in its runner workspace. The fixed schema contains:

- run ID, commit SHA, branch, schema version, and timestamp;
- failed stage, task, and failure message;
- backend and frontend service identifiers;
- previous, expected, and failure-time active task definitions;
- bounded ECS status, status reason, and up to five recent deployment records;
- backend health and frontend smoke-test outcomes; and
- rollback attempted/result fields plus post-rollback backend health.

Unavailable values are represented explicitly. The document does not contain environment dumps, task-definition bodies, application payloads, transcripts, headers, cookies, database values, or credentials.

Before upload, `scripts/aiops/sanitizeDiagnostics.js` rebuilds the document from a nested allowlist, redacts credential-like text, strips control characters, limits deployment arrays, truncates individual strings, and enforces a total payload limit. Only this sanitized output is uploaded, with seven-day artifact retention. The analysis script applies the same sanitizer again after download.

## Guardrailed Gemini analysis

The separate AIOps job uses the existing locked `@google/genai` dependency with the dedicated `AIOPS_GEMINI_API_KEY` GitHub Actions secret. It does not use the application's `GEMINI_API_KEY`. The optional `AIOPS_GEMINI_MODEL` repository variable can select the Flash model; otherwise the repository's current Flash default is used.

The analyzer has a fixed instruction, no tools, no function calling, no shell capability, and no AWS client. Diagnostic strings are explicitly marked as untrusted data. The model must return one classification from:

- `ECS_ROLLOUT_FAILURE`
- `BACKEND_HEALTH_FAILURE`
- `FRONTEND_SMOKE_FAILURE`
- `ROLLBACK_FAILURE`
- `AUTHORIZATION_FAILURE`
- `CONFIGURATION_FAILURE`
- `NETWORK_FAILURE`
- `UNKNOWN`

The structured response also contains bounded confidence, evidence field paths, a likely cause, a recommended human next action, and `humanReviewRequired: true`. Evidence paths are validated and rendered using the original sanitized diagnostic values, preventing the model from supplying invented operational evidence. Unsupported fields, false human-review flags, invalid confidence, or malformed JSON make the result unavailable.

If the Gemini request or response validation fails, the summary says `AI analysis unavailable`. This never changes the failed deploy job, Ansible rollback outcome, or workflow conclusion.

## Security isolation

```text
Deploy job
  -> contents: read + id-token: write
  -> GitHub OIDC temporary AWS role
  -> ECR, task-definition registration, and Ansible/ECS
  -> no AIOPS_GEMINI_API_KEY

AIOps job
  -> contents: read only
  -> AIOPS_GEMINI_API_KEY only in the Gemini step
  -> no id-token: write
  -> no AWS credential action
  -> no deployment or rollback command
```

GitHub Actions jobs have isolated workspaces and credentials. AWS OIDC credentials created in the deploy job are not available in the AIOps job. The AIOps job cannot deploy, rollback, modify IAM, edit infrastructure, or execute remediation.

## Trigger and output

The advisory job runs only when all three conditions are true:

1. the authoritative deploy job finished;
2. its result is `failure`; and
3. the deploy job successfully produced and uploaded sanitized diagnostics.

The GitHub Actions Summary is clearly labelled:

> **AI-GENERATED OPERATIONAL ANALYSIS — ADVISORY ONLY**

It displays the validated classification, confidence, allowlisted evidence, likely cause, recommended human action, deterministic rollback status, and mandatory human-review status.

## FA framing

This is reasonably described as **AIOps deployment-failure analysis** and a **guardrailed agent-like operational workflow**. It demonstrates event-driven automation, telemetry minimization, AI-assisted classification, credential isolation, deterministic rollback, and human oversight. It is deliberately not described as a fully autonomous agent because it has no authority to make changes.

## Limitations

- Version 1 uses only the bounded data already produced by Ansible and ECS deployment APIs; it does not ingest CloudWatch or full application logs.
- The diagnosis is probabilistic and advisory. Operators must validate it against authoritative AWS and application evidence.
- Failures before the tracked Ansible deployment step do not produce this artifact and therefore do not invoke AIOps.
- A missing or invalid AIOps Gemini secret produces an unavailable analysis without affecting deployment failure handling.
