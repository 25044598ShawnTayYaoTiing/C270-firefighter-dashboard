# FA Ansible ECS Express Deployment

## Purpose and architecture

Ansible is the application deployment and verification layer for the existing AWS ECS Express services. It does not replace GitHub Actions, ECR, ECS, IAM, or runtime configuration.

```text
Developer push
  -> GitHub Actions: tests, npm audit, Gitleaks, Semgrep, Trivy, Docker build
  -> ECR: push exact scanned backend and frontend images
  -> GitHub OIDC: temporary GitHubActionsDeployRole credentials
  -> Ansible on the GitHub Actions runner (localhost)
       -> preflight existing ECS Express services
       -> deploy backend and wait for its exact service deployment to become SUCCESSFUL
       -> verify backend /health
       -> deploy frontend and wait for its exact service deployment to become SUCCESSFUL
       -> verify frontend HTTP availability
  -> existing ECS Express backend and frontend services
```

GitHub Actions remains the CI/CD orchestrator. Docker is the containerisation layer, ECR is the image registry, Ansible performs ordered deployment/configuration validation, and ECS is the managed container runtime.

## Ownership boundary

The existing workflow continues to read the live task definitions, change only the selected container image to an immutable ECR image tag, and register new revisions. Moving this proven rendering into Ansible could risk task roles, execution roles, networking, managed-database configuration, Gemini configuration, and Google Speech-to-Text workload-identity settings.

GitHub Actions passes the current, previous, and newly registered task-definition ARNs to Ansible. Ansible owns service updates, backend-first stabilization, application checks, and failure rollback. No second ECS deployment mechanism runs in parallel.

## Repository structure

```text
ansible/
  ansible.cfg
  requirements.txt
  requirements.yml
  inventories/production.yml
  deploy.yml
  roles/ecs_express_deploy/
    defaults/main.yml
    files/waitForServiceDeployment.js
    tasks/{preflight,backend,frontend,capture_deployment_baseline,wait_for_service,rollback}.yml
```

The production inventory contains only localhost with a local connection. Ansible never creates EC2 instances and never SSHs into ECS tasks.

The official `amazon.aws` collection performs the OIDC credential preflight. ECS Express uses an API not managed by the standard Ansible ECS service module, so the role invokes the existing AWS CLI's `update-express-gateway-service` command with explicit arguments. Each command changes only the intended existing service revision.

## Deployment behavior and safety

1. Ansible asserts the existing non-secret inputs, verifies temporary OIDC credentials, and reads both existing ECS Express services. It fails before mutation if a service is missing or inactive.
2. It updates the backend only when the active revision differs from the requested immutable revision.
3. Before each update it snapshots existing service-deployment ARNs. The update response supplies the target service-revision ARN, `describe-service-revisions` verifies that revision uses the requested task definition, and `list-service-deployments` identifies the new deployment absent from the snapshot.
4. It polls that exact deployment with `describe-service-deployments` for up to 30 minutes. Only `SUCCESSFUL` passes; pending, in-progress, stop-requested, and rollback-in-progress states continue polling, while stopped or failed/complete rollback outcomes fail the requested deployment.
5. After authoritative deployment success, it retries the backend JSON `/health` endpoint 18 times with a ten-second delay.
6. Only after backend health passes does it update and verify the frontend with the same deployment-aware waiter and existing HTTP smoke test.
7. If ECS already completed an automatic rollback to the exact saved prior service revision, Ansible verifies that authoritative result. Otherwise it requests the saved task definition, tracks the new rollback deployment rather than an older successful deployment, and verifies backend health afterward. The original deployment remains failed even when rollback succeeds.

The playbook does not force a deployment, recreate services, change networking, load balancers, roles, secrets, task-definition properties, deployment-controller settings, managed database, Gemini, or Google Speech-to-Text/WIF configuration.

## Security

GitHub Actions preserves the existing OIDC flow. Ansible and boto3 consume the temporary runner credentials established by `configure-aws-credentials`; no AWS access keys, database passwords, Gemini keys, Google service-account files, or other secret values are stored in Ansible files.

Tests, production npm audit, Gitleaks, Semgrep, Trivy HIGH/CRITICAL blocking scans, image integrity checks, ECR pushes, and OIDC identity validation all finish before Ansible runs. Ansible preserves the task definitions created by the workflow, including the backend task role and Google Speech-to-Text WIF environment configuration.

## GitHub configuration

No GitHub variables or secrets are added. The existing variables are passed to Ansible as non-secret inputs.

| Name | Type | Existing | Purpose | Expected format |
|---|---|---:|---|---|
| `AWS_REGION` | Variable | Yes | Region for AWS CLI, boto3, and ECS | AWS region |
| `AWS_ROLE_TO_ASSUME` | Variable | Yes | Existing GitHub OIDC role | IAM role ARN |
| `ECR_BACKEND_REPOSITORY` | Variable | Yes | Backend ECR repository | Repository name |
| `ECR_FRONTEND_REPOSITORY` | Variable | Yes | Frontend ECR repository | Repository name |
| `ECS_BACKEND_SERVICE_ARN` | Variable | Yes | Existing backend ECS Express service | ECS service ARN |
| `ECS_FRONTEND_SERVICE_ARN` | Variable | Yes | Existing frontend ECS Express service | ECS service ARN |
| `APP_HEALTH_URL` | Variable | Yes | Public backend JSON health endpoint | HTTPS URL ending `/health` |
| `APP_SMOKE_URL` | Variable | Yes | Public frontend endpoint | HTTPS origin URL |

There are no new GitHub Actions secrets. Existing runtime secrets remain in the ECS task/runtime configuration and are not passed to Ansible.

## Validation

These commands perform only local/static validation when supplied with dummy values; they do not update AWS:

```powershell
python -m pip install --user -r ansible/requirements.txt
ansible-galaxy collection install --force -r ansible/requirements.yml
ansible-playbook -i ansible/inventories/production.yml ansible/deploy.yml --syntax-check
ansible-lint ansible/
npm test
npm audit --omit=dev --audit-level=high
docker compose config --quiet
```

## FA evidence checklist

Capture real evidence after a successful workflow run:

1. GitHub Actions gates passing before OIDC and deployment.
2. Immutable ECR image tags and task-definition revision summary.
3. Ansible output for preflight, backend stabilization, backend health, frontend stabilization, and frontend HTTP validation.
4. ECS console showing the existing backend and frontend services active on their latest revisions.
5. Public frontend availability and backend `/health` response.
6. The repository Ansible role and absence of static AWS credentials.
