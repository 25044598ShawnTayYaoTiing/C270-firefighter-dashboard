'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_DEPLOYMENT_GEMINI_MODEL,
  analyzeDiagnostics,
  formatFailureForLog,
  renderSummary,
  safeErrorText
} = require('./analyzeDeploymentFailure');

function createSyntheticSmokeDiagnostics() {
  return {
    schemaVersion: '1.1',
    timestamp: '2026-08-01T00:00:00Z',
    github: {
      runId: 'live-gemini-smoke',
      commitSha: 'synthetic-safe-evidence',
      branch: 'main'
    },
    deployment: {
      outcome: 'FAILED',
      durationSeconds: 90
    },
    pipeline: {
      tests: 'PASS',
      securityGates: 'PASS',
      containerScanning: 'PASS',
      ecsStabilization: 'FAIL',
      backendHealth: 'NOT_REACHED',
      frontendSmoke: 'NOT_REACHED'
    },
    images: {
      backend: 'example.invalid/firefighter-backend:synthetic',
      frontend: 'example.invalid/firefighter-frontend:synthetic'
    },
    failure: {
      stage: 'backend_deployment',
      task: 'Wait for authoritative ECS service deployment state - backend',
      message: 'Synthetic service deployment reached ROLLBACK_SUCCESSFUL after its circuit breaker triggered.'
    },
    services: {
      backend: {
        identifier: 'synthetic-backend-service',
        previousTaskDefinition: 'synthetic-backend:37',
        expectedTaskDefinition: 'synthetic-backend:38',
        activeTaskDefinition: 'synthetic-backend:37',
        status: 'ACTIVE',
        statusReason: 'Previous healthy revision remains active.',
        serviceDeploymentArn: 'synthetic-service-deployment/backend/fault',
        targetServiceRevisionArn: 'synthetic-service-revision/backend/38',
        deploymentStatus: 'ROLLBACK_SUCCESSFUL',
        deploymentStatusReason: 'Circuit breaker threshold was exceeded.',
        deploymentLifecycleStage: 'CLEAN_UP',
        requestedTaskDefinitionArn: 'synthetic-backend:38',
        circuitBreakerStatus: 'TRIGGERED',
        recentDeployments: [{
          serviceDeploymentArn: 'synthetic-service-deployment/backend/fault',
          status: 'ROLLBACK_SUCCESSFUL',
          statusReason: 'Circuit breaker threshold was exceeded.',
          targetServiceRevisionArn: 'synthetic-service-revision/backend/38',
          startedAt: '2026-08-01T00:00:00Z',
          finishedAt: '2026-08-01T00:01:30Z'
        }]
      },
      frontend: {
        identifier: 'synthetic-frontend-service',
        previousTaskDefinition: 'synthetic-frontend:28',
        expectedTaskDefinition: 'synthetic-frontend:29',
        activeTaskDefinition: 'synthetic-frontend:28',
        status: 'ACTIVE',
        statusReason: 'Frontend deployment was not started.',
        serviceDeploymentArn: 'unavailable',
        targetServiceRevisionArn: 'unavailable',
        deploymentStatus: 'NOT_REQUIRED',
        deploymentStatusReason: 'Backend-first deployment failed.',
        deploymentLifecycleStage: 'unavailable',
        requestedTaskDefinitionArn: 'synthetic-frontend:29',
        circuitBreakerStatus: 'unavailable',
        recentDeployments: []
      }
    },
    verification: {
      backendHealth: 'not-reached',
      frontendSmoke: 'not-reached'
    },
    rollback: {
      backend: {
        attempted: true,
        result: 'succeeded',
        postRollbackHealth: 'passed',
        serviceDeploymentArn: 'synthetic-service-deployment/backend/fault',
        deploymentStatus: 'ROLLBACK_SUCCESSFUL',
        deploymentStatusReason: 'Previous healthy revision was restored.'
      },
      frontend: {
        attempted: false,
        result: 'not-required',
        serviceDeploymentArn: 'unavailable',
        deploymentStatus: 'NOT_REQUIRED',
        deploymentStatusReason: 'Frontend was not updated.'
      }
    }
  };
}

function renderSmokeSummary(result) {
  return [
    '# Gemini Deployment Summary and Failure Diagnostics LIVE Smoke Test',
    '',
    '> **SYNTHETIC SANITIZED EVIDENCE - NO AWS OR DEPLOYMENT AUTHORITY**',
    '',
    renderSummary(result).replace('# Gemini Deployment Summary', '## Production analyzer result')
  ].join('\n');
}

function writeWorkflowSummary(summary, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (!summaryPath) {
    console.log(summary);
    return;
  }

  fs.appendFileSync(path.resolve(summaryPath), `${summary}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

async function runLiveSmokeTest(options = {}) {
  const apiKey = String(
    Object.hasOwn(options, 'apiKey')
      ? options.apiKey
      : process.env.DEPLOYMENT_GEMINI_API_KEY || ''
  ).trim();
  const model = String(
    options.model
      || process.env.DEPLOYMENT_GEMINI_MODEL
      || DEFAULT_DEPLOYMENT_GEMINI_MODEL
  ).trim();

  return analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey,
    model,
    deploymentOutcome: 'FAILED'
  });
}

async function runCli() {
  const result = await runLiveSmokeTest();
  writeWorkflowSummary(renderSmokeSummary(result));

  if (result.available) {
    console.log(`[Gemini Deployment Smoke] ${result.mode} succeeded with model=${result.model}.`);
    console.log(`[Gemini Deployment Smoke] classification=${result.analysis.classification}.`);
    console.log(
      `[Gemini Deployment Smoke] request=${result.validation.geminiRequest} `
      + `structured=${result.validation.structuredResponse} `
      + `evidence=${result.validation.evidence} `
      + `correctiveRetry=${result.validation.correctiveRetryAttempted ? 'YES' : 'NO'}.`
    );
    return;
  }

  console.error(
    `[Gemini Deployment Smoke] ${result.mode} did not produce a validated assessment. ${formatFailureForLog(result.failure)}`
  );
  process.exitCode = 1;
}

if (require.main === module) {
  runCli().catch((error) => {
    const message = safeErrorText(
      error && error.message || 'Unexpected smoke-test failure.',
      [process.env.DEPLOYMENT_GEMINI_API_KEY]
    );
    console.error(`[Gemini Deployment Smoke] Smoke runner failed safely: ${message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createSyntheticSmokeDiagnostics,
  renderSmokeSummary,
  runLiveSmokeTest,
  writeWorkflowSummary
};
