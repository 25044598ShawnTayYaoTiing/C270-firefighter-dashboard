'use strict';

// FA contribution owner: Shawn Tay Yao Ting
// Purpose: Converts deployment diagnostics into a bounded, allowlisted, and redacted evidence document.
// Demo focus: Show that secrets, raw environments, transcripts, and task definitions never reach Gemini.

const fs = require('node:fs');
const path = require('node:path');

const UNAVAILABLE = 'unavailable';
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_STRING_LENGTH = 1024;
const MAX_RECENT_DEPLOYMENTS = 5;
const MAX_TOTAL_BYTES = 32 * 1024;
const TRUNCATION_SUFFIX = '...[truncated]';

// Scalar redaction removes credential-shaped text and bounds every diagnostic string.
// Safe values then enter fixed service and deployment evidence structures only.
function truncateString(value, maximumLength = MAX_STRING_LENGTH) {
  const text = String(value);

  if (text.length <= maximumLength) {
    return text;
  }

  if (maximumLength <= TRUNCATION_SUFFIX.length) {
    return TRUNCATION_SUFFIX.slice(0, maximumLength);
  }

  return `${text.slice(0, maximumLength - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
}

function redactSensitiveText(value) {
  let text = String(value);

  text = text
    .replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gi,
      '[REDACTED_PRIVATE_KEY]'
    )
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^@\s/]+)@/gi,
      '$1[REDACTED]@'
    )
    .replace(
      /([?&](?:api[-_]?key|access[-_]?token|auth|authorization|client[-_]?secret|password|secret|session[-_]?token|sig|signature|token|x-amz-credential|x-amz-security-token|x-amz-signature)=)[^&#\s]+/gi,
      '$1[REDACTED]'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED_AWS_ACCESS_KEY]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED_API_KEY]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '[REDACTED_TOKEN]')
    .replace(
      /\b([A-Z][A-Z0-9_]*(?:ACCESS_TOKEN|API_KEY|AUTH_TOKEN|PASSWORD|PRIVATE_KEY|SECRET_ACCESS_KEY|SESSION_TOKEN))\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2[REDACTED]'
    )
    .replace(
      /\b(api[-_ ]?key|authorization|client[-_ ]?secret|cookie|password|passwd|secret|session[-_ ]?token|set-cookie|x-amz-security-token|x-goog-api-key)\b(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1$2[REDACTED]'
    )
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateString(text);
}

function sanitizeScalar(value) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    return UNAVAILABLE;
  }

  const sanitized = redactSensitiveText(value);
  return sanitized || UNAVAILABLE;
}

function sanitizeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function sanitizeRecentDeployments(value) {
  if (!Array.isArray(value)) {
    return [{
      serviceDeploymentArn: UNAVAILABLE,
      status: UNAVAILABLE,
      statusReason: UNAVAILABLE,
      targetServiceRevisionArn: UNAVAILABLE,
      startedAt: UNAVAILABLE,
      finishedAt: UNAVAILABLE
    }];
  }

  return value.slice(0, MAX_RECENT_DEPLOYMENTS).map((deployment) => {
    const safeDeployment = deployment && typeof deployment === 'object' && !Array.isArray(deployment)
      ? deployment
      : {};

    return {
      serviceDeploymentArn: sanitizeScalar(safeDeployment.serviceDeploymentArn),
      status: sanitizeScalar(safeDeployment.status),
      statusReason: sanitizeScalar(safeDeployment.statusReason),
      targetServiceRevisionArn: sanitizeScalar(safeDeployment.targetServiceRevisionArn),
      startedAt: sanitizeScalar(safeDeployment.startedAt),
      finishedAt: sanitizeScalar(safeDeployment.finishedAt)
    };
  });
}

// Service sanitization explicitly selects operational fields instead of copying raw AWS responses.
// Demo focus: Point out deployment state and reason fields while excluded fields remain absent.
function sanitizeService(value) {
  const service = value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    identifier: sanitizeScalar(service.identifier),
    previousTaskDefinition: sanitizeScalar(service.previousTaskDefinition),
    expectedTaskDefinition: sanitizeScalar(service.expectedTaskDefinition),
    activeTaskDefinition: sanitizeScalar(service.activeTaskDefinition),
    status: sanitizeScalar(service.status),
    statusReason: sanitizeScalar(service.statusReason),
    serviceDeploymentArn: sanitizeScalar(service.serviceDeploymentArn),
    targetServiceRevisionArn: sanitizeScalar(service.targetServiceRevisionArn),
    deploymentStatus: sanitizeScalar(service.deploymentStatus),
    deploymentStatusReason: sanitizeScalar(service.deploymentStatusReason),
    deploymentLifecycleStage: sanitizeScalar(service.deploymentLifecycleStage),
    requestedTaskDefinitionArn: sanitizeScalar(service.requestedTaskDefinitionArn),
    circuitBreakerStatus: sanitizeScalar(service.circuitBreakerStatus),
    recentDeployments: sanitizeRecentDeployments(service.recentDeployments)
  };
}

function compactStrings(value, maximumLength) {
  if (typeof value === 'string') {
    return truncateString(value, maximumLength);
  }

  if (Array.isArray(value)) {
    return value.map((item) => compactStrings(item, maximumLength));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, compactStrings(item, maximumLength)])
    );
  }

  return value;
}

// Total-size enforcement compacts bounded text and rejects evidence that still exceeds the limit.
// The analyzer receives a predictable maximum payload after this final safety check.
function enforceTotalPayloadSize(document) {
  let boundedDocument = document;

  for (const stringLimit of [MAX_STRING_LENGTH, 512, 256, 128, 64]) {
    boundedDocument = compactStrings(boundedDocument, stringLimit);
    if (Buffer.byteLength(JSON.stringify(boundedDocument), 'utf8') <= MAX_TOTAL_BYTES) {
      return boundedDocument;
    }
  }

  throw new Error('Sanitized diagnostic payload exceeds the maximum allowed size.');
}

// Top-level allowlisting rebuilds the complete success/failure document before redaction output.
// Deterministic deployment and rollback facts remain authoritative regardless of later AI analysis.
function sanitizeDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Diagnostics must be a JSON object.');
  }

  const github = value.github && typeof value.github === 'object' && !Array.isArray(value.github)
    ? value.github
    : {};
  const deployment = value.deployment
    && typeof value.deployment === 'object'
    && !Array.isArray(value.deployment)
    ? value.deployment
    : {};
  const pipeline = value.pipeline
    && typeof value.pipeline === 'object'
    && !Array.isArray(value.pipeline)
    ? value.pipeline
    : {};
  const images = value.images && typeof value.images === 'object' && !Array.isArray(value.images)
    ? value.images
    : {};
  const failure = value.failure && typeof value.failure === 'object' && !Array.isArray(value.failure)
    ? value.failure
    : {};
  const services = value.services && typeof value.services === 'object' && !Array.isArray(value.services)
    ? value.services
    : {};
  const verification = value.verification
    && typeof value.verification === 'object'
    && !Array.isArray(value.verification)
    ? value.verification
    : {};
  const rollback = value.rollback && typeof value.rollback === 'object' && !Array.isArray(value.rollback)
    ? value.rollback
    : {};
  const backendRollback = rollback.backend
    && typeof rollback.backend === 'object'
    && !Array.isArray(rollback.backend)
    ? rollback.backend
    : {};
  const frontendRollback = rollback.frontend
    && typeof rollback.frontend === 'object'
    && !Array.isArray(rollback.frontend)
    ? rollback.frontend
    : {};

  const allowlistedDocument = {
    schemaVersion: sanitizeScalar(value.schemaVersion),
    timestamp: sanitizeScalar(value.timestamp),
    github: {
      runId: sanitizeScalar(github.runId),
      commitSha: sanitizeScalar(github.commitSha),
      branch: sanitizeScalar(github.branch)
    },
    deployment: {
      outcome: sanitizeScalar(deployment.outcome || value.deploymentResult),
      durationSeconds: sanitizeScalar(deployment.durationSeconds)
    },
    pipeline: {
      tests: sanitizeScalar(pipeline.tests),
      securityGates: sanitizeScalar(pipeline.securityGates),
      containerScanning: sanitizeScalar(pipeline.containerScanning),
      ecsStabilization: sanitizeScalar(pipeline.ecsStabilization),
      backendHealth: sanitizeScalar(pipeline.backendHealth),
      frontendSmoke: sanitizeScalar(pipeline.frontendSmoke)
    },
    images: {
      backend: sanitizeScalar(images.backend),
      frontend: sanitizeScalar(images.frontend)
    },
    failure: {
      stage: sanitizeScalar(failure.stage),
      task: sanitizeScalar(failure.task),
      message: sanitizeScalar(failure.message)
    },
    services: {
      backend: sanitizeService(services.backend),
      frontend: sanitizeService(services.frontend)
    },
    verification: {
      backendHealth: sanitizeScalar(verification.backendHealth),
      frontendSmoke: sanitizeScalar(verification.frontendSmoke)
    },
    rollback: {
      backend: {
        attempted: sanitizeBoolean(backendRollback.attempted),
        result: sanitizeScalar(backendRollback.result),
        postRollbackHealth: sanitizeScalar(backendRollback.postRollbackHealth),
        serviceDeploymentArn: sanitizeScalar(backendRollback.serviceDeploymentArn),
        deploymentStatus: sanitizeScalar(backendRollback.deploymentStatus),
        deploymentStatusReason: sanitizeScalar(backendRollback.deploymentStatusReason)
      },
      frontend: {
        attempted: sanitizeBoolean(frontendRollback.attempted),
        result: sanitizeScalar(frontendRollback.result),
        serviceDeploymentArn: sanitizeScalar(frontendRollback.serviceDeploymentArn),
        deploymentStatus: sanitizeScalar(frontendRollback.deploymentStatus),
        deploymentStatusReason: sanitizeScalar(frontendRollback.deploymentStatusReason)
      }
    }
  };

  return enforceTotalPayloadSize(allowlistedDocument);
}

// File mode reads local diagnostics, applies the same production sanitizer, and writes private JSON.
// This is the hand-off used by deployment evidence preparation and isolated demonstrations.
function sanitizeDiagnosticsFile(inputPath, outputPath) {
  const inputSize = fs.statSync(inputPath).size;
  if (inputSize > MAX_INPUT_BYTES) {
    throw new Error('Diagnostic input exceeds the maximum allowed size.');
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const sanitized = sanitizeDiagnostics(input);
  const resolvedOutputPath = path.resolve(outputPath);

  fs.mkdirSync(path.dirname(resolvedOutputPath), { recursive: true });
  fs.writeFileSync(resolvedOutputPath, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });

  return sanitized;
}

if (require.main === module) {
  const [inputPath, outputPath] = process.argv.slice(2);

  if (!inputPath || !outputPath) {
    console.error('Usage: node sanitizeDiagnostics.js <input.json> <output.json>');
    process.exitCode = 1;
  } else {
    try {
      const sanitized = sanitizeDiagnosticsFile(inputPath, outputPath);
      const byteLength = Buffer.byteLength(JSON.stringify(sanitized), 'utf8');
      console.log(`[Gemini Deployment Summary] Sanitized deployment diagnostics (${byteLength} bytes).`);
    } catch (error) {
      console.error(`[Gemini Deployment Summary] Diagnostic sanitization failed: ${redactSensitiveText(error.message)}`);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  MAX_INPUT_BYTES,
  MAX_STRING_LENGTH,
  MAX_TOTAL_BYTES,
  UNAVAILABLE,
  redactSensitiveText,
  sanitizeDiagnostics,
  sanitizeDiagnosticsFile,
  truncateString
};
