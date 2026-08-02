# FA DevOps — Verified Deployment Evidence

This document records one production deployment used as time-bound Final Assessment evidence. It is not a guarantee that later deployments or external services will have the same result.

## Evidence source

- Commit: [`0fa36fc`](https://github.com/25044598ShawnTayYaoTiing/C270-firefighter-dashboard/commit/0fa36fc6ccf664479fac232bb4358fe25cde68b5)
- GitHub Actions: [DevSecOps CI/CD run 30708343101](https://github.com/25044598ShawnTayYaoTiing/C270-firefighter-dashboard/actions/runs/30708343101)

## Authoritative deployment result

| Check | Recorded result |
|---|---|
| Deployment outcome | `SUCCESS` |
| Backend ECS stabilisation | `PASS` |
| Backend health | `PASS` — `/health` returned HTTP 200 with `{"status":"ok"}` |
| Frontend ECS stabilisation | `PASS` |
| Frontend smoke test | `PASS` — HTTP 200 |
| Rollback | Not required |
| Backend task definition | `default-firefighter-backend:45` |
| Frontend task definition | `default-firefighter-frontend:36` |
| Image identity | Both images used the full commit SHA as their tag |
| Recorded deployment duration | 1,215 seconds |

ECS deployment state, Ansible verification, backend health, frontend smoke testing, and rollback results are deterministic and authoritative.

## Gemini summary validation

| Check | Recorded result |
|---|---|
| Live Gemini request | Attempted and returned successfully |
| Model | `gemini-3.5-flash-lite` |
| Structured response validation | `PASS` |
| Evidence validation | `FAIL` — required evidence identifier `E6` was omitted |
| Corrective evidence retry | Attempted once |
| Official assessment source | `DETERMINISTIC FALLBACK` |
| Deterministic classification | `HEALTHY_DEPLOYMENT` |
| Deterministic risk level | `LOW` |

The live response was not promoted to the official assessment because it failed evidence validation. This demonstrates the intended authority boundary: Gemini can summarise results and suggest troubleshooting steps, but an unvalidated response cannot alter or replace the deterministic deployment result.

## Interpretation

This run verifies that the pipeline can:

- pass its CI and DevSecOps gates;
- promote the scanned backend and frontend images;
- complete backend-first ECS Express Mode deployment through Ansible;
- verify backend health and frontend availability; and
- run the isolated post-deployment Gemini stage with deterministic fallback when evidence validation fails.

For the current implementation and presentation guidance, see the [FA DevOps Evidence Guide](FA-DEVOPS-EVIDENCE-GUIDE.md) and [Gemini-Assisted Deployment Summary and Failure Diagnostics](FA-GEMINI-DEPLOYMENT-SUMMARY-AND-DIAGNOSTICS.md).
