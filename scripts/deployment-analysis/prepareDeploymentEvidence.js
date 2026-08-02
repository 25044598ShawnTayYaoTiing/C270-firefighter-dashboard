'use strict';

// FA contribution owner: Shawn Tay Yao Ting
// Purpose: Builds one sanitized evidence format from successful or failed deterministic deployments.
// Demo focus: Compare pipeline PASS/FAIL facts with the later advisory Gemini interpretation.

const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_INPUT_BYTES,
  redactSensitiveText,
  sanitizeDiagnostics
} = require('./sanitizeDiagnostics');

const SUPPORTED_OUTCOMES = new Set(['SUCCESS', 'FAILED']);

// Normalization maps workflow results into fixed deployment and verification status values.
// The next stage combines these values with bounded service evidence and image identifiers.
function normalizeOutcome(value) {
  const outcome = String(value || '').trim().toUpperCase();

  if (!SUPPORTED_OUTCOMES.has(outcome)) {
    throw new Error('Deployment outcome must be SUCCESS or FAILED.');
  }

  return outcome;
}

function normalizeCheckResult(value) {
  const result = String(value || '').trim().toLowerCase();

  if (['pass', 'passed', 'success', 'succeeded', 'successful', 'true'].includes(result)) {
    return 'PASS';
  }

  if (['fail', 'failed', 'failure', 'false'].includes(result)) {
    return 'FAIL';
  }

  if (['not-reached', 'not reached', 'skipped'].includes(result)) {
    return 'NOT_REACHED';
  }

  return 'UNAVAILABLE';
}

function deploymentDurationSeconds(startedAtEpoch, now = Date.now()) {
  const start = Number(startedAtEpoch);
  const finish = Math.floor(Number(now) / 1000);

  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(finish) || finish < start) {
    return 'unavailable';
  }

  return Math.min(finish - Math.floor(start), 7 * 24 * 60 * 60);
}

function deriveStabilizationResult(outcome, failureStage) {
  if (outcome === 'SUCCESS') {
    return 'PASS';
  }

  const stage = String(failureStage || '').toLowerCase();
  if (stage.includes('health') || stage.includes('smoke')) {
    return 'PASS';
  }

  if (stage.includes('deployment') || stage.includes('stabilization')) {
    return 'FAIL';
  }

  return 'UNAVAILABLE';
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildServiceEvidence(rawService, environment, prefix, outcome) {
  const service = safeObject(rawService);
  const expectedTaskDefinition = service.expectedTaskDefinition
    || environment[`${prefix}_TASK_DEFINITION_ARN`];

  return {
    identifier: service.identifier || environment[`${prefix}_SERVICE_ARN`],
    previousTaskDefinition: service.previousTaskDefinition
      || environment[`PREVIOUS_${prefix}_TASK_DEFINITION_ARN`],
    expectedTaskDefinition,
    activeTaskDefinition: outcome === 'SUCCESS'
      ? expectedTaskDefinition
      : service.activeTaskDefinition,
    status: outcome === 'SUCCESS' ? 'ACTIVE' : service.status,
    statusReason: outcome === 'SUCCESS'
      ? 'The correlated ECS service deployment reached SUCCESSFUL before application verification.'
      : service.statusReason,
    serviceDeploymentArn: service.serviceDeploymentArn,
    targetServiceRevisionArn: service.targetServiceRevisionArn,
    deploymentStatus: outcome === 'SUCCESS' ? 'SUCCESSFUL' : service.deploymentStatus,
    deploymentStatusReason: outcome === 'SUCCESS'
      ? 'The authoritative ECS service deployment completed successfully.'
      : service.deploymentStatusReason,
    deploymentLifecycleStage: service.deploymentLifecycleStage,
    requestedTaskDefinitionArn: expectedTaskDefinition,
    circuitBreakerStatus: service.circuitBreakerStatus,
    recentDeployments: Array.isArray(service.recentDeployments)
      ? service.recentDeployments
      : []
  };
}

// Evidence construction selects tests, security, ECS, health, smoke, revision, and rollback facts.
// No environment dump or raw task definition is accepted into the output document.
function buildDeploymentEvidence(options = {}) {
  const outcome = normalizeOutcome(options.outcome);
  const rawDiagnostics = safeObject(options.rawDiagnostics);
  const environment = safeObject(options.environment);
  const rawGithub = safeObject(rawDiagnostics.github);
  const rawFailure = safeObject(rawDiagnostics.failure);
  const rawServices = safeObject(rawDiagnostics.services);
  const rawVerification = safeObject(rawDiagnostics.verification);
  const rawRollback = safeObject(rawDiagnostics.rollback);

  const evidence = {
    ...rawDiagnostics,
    schemaVersion: '1.1',
    timestamp: new Date(options.now || Date.now()).toISOString(),
    github: {
      runId: rawGithub.runId || environment.GITHUB_RUN_ID,
      commitSha: rawGithub.commitSha || environment.GITHUB_SHA,
      branch: rawGithub.branch || environment.GITHUB_REF_NAME
    },
    deployment: {
      outcome,
      durationSeconds: deploymentDurationSeconds(
        environment.DEPLOYMENT_STARTED_AT_EPOCH,
        options.now || Date.now()
      )
    },
    pipeline: {
      tests: 'PASS',
      securityGates: 'PASS',
      containerScanning: 'PASS',
      ecsStabilization: deriveStabilizationResult(outcome, rawFailure.stage),
      backendHealth: outcome === 'SUCCESS'
        ? 'PASS'
        : normalizeCheckResult(rawVerification.backendHealth),
      frontendSmoke: outcome === 'SUCCESS'
        ? 'PASS'
        : normalizeCheckResult(rawVerification.frontendSmoke)
    },
    images: {
      backend: environment.BACKEND_ECR_IMAGE,
      frontend: environment.FRONTEND_ECR_IMAGE
    },
    failure: outcome === 'FAILED' ? rawFailure : {},
    services: {
      backend: buildServiceEvidence(
        rawServices.backend,
        environment,
        'BACKEND',
        outcome
      ),
      frontend: buildServiceEvidence(
        rawServices.frontend,
        environment,
        'FRONTEND',
        outcome
      )
    },
    verification: outcome === 'SUCCESS'
      ? { backendHealth: 'passed', frontendSmoke: 'passed' }
      : rawVerification,
    rollback: outcome === 'SUCCESS'
      ? {
        backend: { attempted: false, result: 'not-required', postRollbackHealth: 'not-required' },
        frontend: { attempted: false, result: 'not-required' }
      }
      : rawRollback
  };

  return sanitizeDiagnostics(evidence);
}

// File helpers enforce input limits and write only the sanitizer-approved document.
// Demo focus: Show deployment-diagnostics.json as the isolated job's sole operational input.
function readDiagnosticsFile(inputPath) {
  if (!inputPath) {
    return {};
  }

  if (fs.statSync(inputPath).size > MAX_INPUT_BYTES) {
    throw new Error('Diagnostic input exceeds the maximum allowed size.');
  }

  return JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}

function writeEvidenceFile(outputPath, evidence) {
  const resolvedPath = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

// CLI mode is invoked by deploy.yml after Ansible completes or fails.
// A successful write enables artifact upload; failure leaves the advisory job on safe fallback.
function runCli() {
  const [outcome, outputPath, inputPath] = process.argv.slice(2);

  if (!outcome || !outputPath) {
    throw new Error(
      'Usage: node prepareDeploymentEvidence.js <SUCCESS|FAILED> <output.json> [input.json]'
    );
  }

  const evidence = buildDeploymentEvidence({
    outcome,
    rawDiagnostics: readDiagnosticsFile(inputPath),
    environment: process.env
  });
  writeEvidenceFile(outputPath, evidence);
  console.log(`[Gemini Deployment Summary] Sanitized ${normalizeOutcome(outcome)} deployment evidence prepared.`);
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(`[Gemini Deployment Summary] Deployment evidence preparation failed: ${redactSensitiveText(error.message)}`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildDeploymentEvidence,
  deploymentDurationSeconds,
  deriveStabilizationResult,
  normalizeCheckResult,
  normalizeOutcome,
  readDiagnosticsFile,
  writeEvidenceFile
};
