# Security Policy

## Supported version

Security fixes are applied to the current `main` branch of this prototype. Deployments must pass the repository's DevSecOps gates before reaching ECS.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability, leaked credential, or production configuration problem. Use GitHub's private vulnerability-reporting feature when it is enabled for this repository; otherwise contact the repository maintainers through the course-approved private channel. Include the affected file or endpoint, impact, reproduction steps, and any safe remediation suggestion. Do not include live credentials in the report.

## Secret-handling rules

- Store credentials only in local `.env`, GitHub Secrets, or ECS runtime configuration.
- Keep `.env`, `.env.*`, private keys, and certificate files out of Git.
- Never pass secrets as Docker build arguments or copy them into an image.
- Never paste credentials into workflow logs, screenshots, issues, pull requests, or this documentation.
- Rotate a credential immediately when it may have been exposed, even if it has since been removed from Git history.

## Dependency-update process

Dependabot proposes weekly npm, Docker, and GitHub Actions updates. Every dependency update must run `npm ci`, `npm test`, and `npm audit --omit=dev --audit-level=high`; container-related updates must also pass the Trivy image gate. Use compatible releases first and do not use `npm audit fix --force` as a routine remediation.

## Vulnerability exceptions

The pipeline has no blanket vulnerability ignores. An exception is allowed only when there is no safe fix and all of the following are documented in the pull request and the FA evidence:

- the exact CVE or advisory ID;
- affected component and reachable impact analysis;
- compensating controls and residual risk;
- maintainer approval; and
- an expiry/review date.

Any exception must be narrowly scoped to that one finding. It must not be used to bypass Gitleaks, production dependency audit, Semgrep, or the HIGH/CRITICAL Trivy gate.

## Incident response for a leaked credential

1. Revoke or rotate the credential at its provider immediately.
2. Remove it from the runtime configuration and Git history as appropriate; assume historical copies are compromised.
3. Replace it through GitHub Secrets or ECS configuration, never source code.
4. Investigate deployments and provider audit logs for misuse.
5. Run the Gitleaks gate again and record the remediation privately.
6. If AWS credentials were exposed, disable the access key or affected role sessions and review IAM activity before restoring access.
