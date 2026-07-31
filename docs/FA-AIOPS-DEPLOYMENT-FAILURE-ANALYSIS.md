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

## SIMULATED LOCAL FAILURE EVIDENCE

Run the safe local demonstration from the repository root:

```powershell
npm run aiops:demo
```

The demonstration creates an in-memory simulated backend deployment failure:

- revision 29 repeatedly stops before `/health` becomes available;
- the backend service fails to stabilize;
- deterministic rollback evidence says revision 28 was restored successfully; and
- the overall simulated deployment result remains `FAILED`.

The raw fixture contains obviously fake sensitive and noisy data, including an
Authorization value, AWS token, session secret, database password, environment
object, raw task-definition fragment, oversized log text, transcript content,
and prompt-injection-shaped diagnostic text. The production sanitizer rebuilds
the document from its allowlist, removes unsupported fields and fake values,
and applies the existing string and payload bounds.

The sanitized document is then passed to the production `analyzeDiagnostics()`
path with an in-process mocked Gemini client. The mock performs no network
request, but its response must still pass the production schema and evidence
validation. The demo fails if sanitization, data-boundary, schema,
human-review, or failed-deployment invariants are violated.

The presentation output explicitly reports:

```text
RAW SIMULATED FAILURE
  -> SANITIZATION
  -> SANITIZED DIAGNOSTICS
  -> AIOPS ANALYSIS
  -> HUMAN REVIEW REQUIRED: TRUE
  -> DEPLOYMENT RESULT REMAINS: FAILED
  -> NO AUTOMATIC ACTION TAKEN
```

This is **simulated local evidence**. It is not proof that a real failed ECS
deployment has invoked Gemini in production. The command requires no AWS
credentials, ECS access, network access, Gemini key, application process, or
cloud resource.

## GitHub Actions FA demonstration

The dedicated
`.github/workflows/aiops-demo.yml` workflow provides the same safe scenario in
a real GitHub Actions execution environment. It is named
`AIOps FA Demonstration` and can only be started manually with
`workflow_dispatch`.

```text
GitHub Actions
  -> synthetic revision 29 failure
  -> production sanitizer
  -> sanitization invariants
  -> production analyzer and schema validation
  -> advisory Actions Summary
  -> mandatory human review
```

The job grants only `contents: read`. It has no `id-token: write`, AWS
credential action, AWS CLI call, Ansible command, deployment command, rollback
command, push operation, or automatic remediation capability.

The analysis step receives only the dedicated `AIOPS_GEMINI_API_KEY` secret.
When that secret is configured and Gemini returns a valid response, the summary
labels the mode `LIVE GEMINI`. If the secret is unavailable, or live analysis
is unavailable, the workflow uses the existing schema-validated local response
and clearly labels the mode `MOCKED` or
`MOCKED FALLBACK (LIVE GEMINI UNAVAILABLE)`. The application
`GEMINI_API_KEY` is never used.

Fake credential values are removed before analysis. The prompt-injection-shaped
diagnostic remains inside the analyzer's explicitly marked untrusted-data
boundary so that the real prompt-injection guard is exercised, but the text is
not rendered in the GitHub Actions Summary.

This workflow is deliberately separate from `deploy.yml`:

| Production | FA demonstration |
|---|---|
| Real failed deployment or verification | Synthetic backend revision failure |
| Deterministic Ansible rollback first | Simulated successful rollback evidence |
| Sanitized failure artifact | In-memory fixture sanitized in the runner |
| Failure-only AIOps job | Manual demonstration job |
| Failed deployment remains failed | Synthetic result remains `FAILED` |

Synthetic evidence is used because deliberately breaking ECS purely for
assessment evidence would create unnecessary production risk.

### Presentation sequence

1. Open GitHub Actions and select **AIOps FA Demonstration**.
2. Select **Run workflow** on `main`.
3. Open **Prepare synthetic sanitized diagnostics** and show the bounded,
   secret-free result.
4. Open **Run guarded AIOps analysis and write summary** and show the selected
   `LIVE GEMINI` or explicitly labelled fallback mode.
5. Open the run Summary and show the classification, human-review requirement,
   preserved `FAILED` result, and zero AWS/deployment/rollback actions.
6. Open `deploy.yml` and show that production AIOps remains conditioned on an
   actual failed deploy with a prepared sanitized diagnostic artifact.

## Limitations

- Version 1 uses only the bounded data already produced by Ansible and ECS deployment APIs; it does not ingest CloudWatch or full application logs.
- The diagnosis is probabilistic and advisory. Operators must validate it against authoritative AWS and application evidence.
- Failures before the tracked Ansible deployment step do not produce this artifact and therefore do not invoke AIOps.
- A missing or invalid AIOps Gemini secret produces an unavailable analysis without affecting deployment failure handling.
- The local FA demonstration uses a mocked AI response to prove integration,
  sanitization, schema validation, and safety boundaries without contacting
  Gemini or AWS.
