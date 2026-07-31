'use strict';

const { spawnSync } = require('node:child_process');

const WAITING_STATES = new Set([
  'PENDING',
  'IN_PROGRESS',
  'STOP_REQUESTED',
  'ROLLBACK_REQUESTED',
  'ROLLBACK_IN_PROGRESS'
]);
const FAILURE_STATES = new Set(['STOPPED', 'ROLLBACK_FAILED']);
const KNOWN_STATES = new Set([
  ...WAITING_STATES,
  ...FAILURE_STATES,
  'SUCCESSFUL',
  'ROLLBACK_SUCCESSFUL'
]);
const MAX_DIAGNOSTIC_LENGTH = 512;

function boundedText(value, fallback = 'unavailable') {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, MAX_DIAGNOSTIC_LENGTH);
}

function normalizeDeployment(deployment = {}, requestedTaskDefinitionArn = 'unavailable') {
  const target = deployment.targetServiceRevision || {};
  const rollback = deployment.rollback || {};
  const circuitBreaker = deployment.deploymentCircuitBreaker || {};
  const alarms = deployment.alarms || {};

  return {
    serviceDeploymentArn: boundedText(deployment.serviceDeploymentArn),
    targetServiceRevisionArn: boundedText(target.arn),
    requestedTaskDefinitionArn: boundedText(requestedTaskDefinitionArn),
    status: boundedText(deployment.status).toUpperCase(),
    statusReason: boundedText(deployment.statusReason),
    lifecycleStage: boundedText(deployment.lifecycleStage),
    rollbackServiceRevisionArn: boundedText(rollback.serviceRevisionArn),
    rollbackReason: boundedText(rollback.reason),
    targetRequestedTaskCount: Number.isInteger(target.requestedTaskCount)
      ? target.requestedTaskCount
      : null,
    targetRunningTaskCount: Number.isInteger(target.runningTaskCount)
      ? target.runningTaskCount
      : null,
    targetPendingTaskCount: Number.isInteger(target.pendingTaskCount)
      ? target.pendingTaskCount
      : null,
    circuitBreakerStatus: boundedText(circuitBreaker.status),
    circuitBreakerFailureCount: Number.isInteger(circuitBreaker.failureCount)
      ? circuitBreaker.failureCount
      : null,
    alarmsStatus: boundedText(alarms.status),
    triggeredAlarmNames: Array.isArray(alarms.triggeredAlarmNames)
      ? alarms.triggeredAlarmNames.slice(0, 10).map((name) => boundedText(name))
      : []
  };
}

function selectSpecificDeployment(deployments, expectedServiceRevisionArn, baselineArns = []) {
  const baseline = new Set(baselineArns);
  const matches = (Array.isArray(deployments) ? deployments : []).filter((deployment) => (
    deployment
    && deployment.targetServiceRevisionArn === expectedServiceRevisionArn
    && !baseline.has(deployment.serviceDeploymentArn)
  ));

  if (matches.length > 1) {
    return {
      outcome: 'failure',
      reason: `Found ${matches.length} new deployments for the expected service revision; correlation is ambiguous.`,
      deployment: null
    };
  }

  if (matches.length === 0) {
    return {
      outcome: 'wait',
      reason: 'The deployment for the expected service revision is not visible yet.',
      deployment: null
    };
  }

  return { outcome: 'found', reason: '', deployment: matches[0] };
}

function evaluateDeploymentState(deployment, options = {}) {
  const operation = options.operation === 'rollback' ? 'rollback' : 'deployment';
  const expectedServiceRevisionArn = String(options.expectedServiceRevisionArn || '');
  const status = String(deployment.status || '').toUpperCase();
  const targetServiceRevisionArn = String(deployment.targetServiceRevisionArn || '');
  const rollbackServiceRevisionArn = String(deployment.rollbackServiceRevisionArn || '');

  if (
    operation === 'rollback'
    && status === 'ROLLBACK_SUCCESSFUL'
    && rollbackServiceRevisionArn === expectedServiceRevisionArn
  ) {
    return {
      outcome: 'success',
      reason: 'ECS completed rollback to the expected service revision.'
    };
  }

  if (targetServiceRevisionArn !== expectedServiceRevisionArn) {
    return {
      outcome: 'failure',
      reason: 'The observed deployment targets a different service revision.'
    };
  }

  if (WAITING_STATES.has(status)) {
    return {
      outcome: 'wait',
      reason: `The authoritative deployment state is ${status}.`
    };
  }

  if (status === 'SUCCESSFUL') {
    return {
      outcome: 'success',
      reason: 'The expected ECS service deployment completed successfully.'
    };
  }

  if (status === 'ROLLBACK_SUCCESSFUL') {
    return {
      outcome: 'failure',
      reason: 'The requested deployment did not succeed; ECS completed a rollback.'
    };
  }

  if (FAILURE_STATES.has(status)) {
    return {
      outcome: 'failure',
      reason: `The authoritative deployment state is ${status}.`
    };
  }

  return {
    outcome: 'failure',
    reason: KNOWN_STATES.has(status)
      ? `The deployment reached unsupported terminal state ${status}.`
      : `ECS returned unknown deployment state ${status || 'UNAVAILABLE'}.`
  };
}

function timeoutResult(lastObservation, options = {}) {
  const observed = lastObservation || {
    serviceDeploymentArn: 'unavailable',
    targetServiceRevisionArn: options.expectedServiceRevisionArn || 'unavailable',
    requestedTaskDefinitionArn: options.requestedTaskDefinitionArn || 'unavailable',
    status: 'unavailable',
    statusReason: 'No matching deployment became visible before the timeout.',
    lifecycleStage: 'unavailable'
  };

  return {
    ...observed,
    outcome: 'timeout',
    reason: boundedText(
      `Timed out waiting for deployment ${observed.serviceDeploymentArn}; `
      + `last state=${observed.status}, reason=${observed.statusReason}.`
    )
  };
}

function parseArguments(argv) {
  const values = {};

  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith('--') || value === undefined) {
      throw new Error('Waiter arguments must use --name value pairs.');
    }
    values[key.slice(2)] = value;
  }

  const required = [
    'region',
    'service-arn',
    'expected-task-definition-arn',
    'expected-service-revision-arn',
    'baseline-deployment-arns-json',
    'operation',
    'timeout-seconds',
    'poll-interval-seconds'
  ];
  for (const name of required) {
    if (!values[name]) {
      throw new Error(`Missing required --${name} argument.`);
    }
  }

  const baselineArns = JSON.parse(values['baseline-deployment-arns-json']);
  if (!Array.isArray(baselineArns)) {
    throw new Error('The deployment baseline must be a JSON array.');
  }

  const timeoutSeconds = Number.parseInt(values['timeout-seconds'], 10);
  const pollIntervalSeconds = Number.parseInt(values['poll-interval-seconds'], 10);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) {
    throw new Error('The deployment timeout must be a positive integer.');
  }
  if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 1) {
    throw new Error('The polling interval must be a positive integer.');
  }
  if (!['deployment', 'rollback'].includes(values.operation)) {
    throw new Error('The operation must be deployment or rollback.');
  }

  return {
    region: values.region,
    serviceArn: values['service-arn'],
    requestedTaskDefinitionArn: values['expected-task-definition-arn'],
    expectedServiceRevisionArn: values['expected-service-revision-arn'],
    baselineArns,
    operation: values.operation,
    timeoutSeconds,
    pollIntervalSeconds
  };
}

function runAwsJson(region, operationArguments) {
  const result = spawnSync('aws', [
    'ecs',
    ...operationArguments,
    '--region', region,
    '--output', 'json',
    '--no-cli-pager',
    '--cli-connect-timeout', '5',
    '--cli-read-timeout', '15'
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 30000,
    windowsHide: true
  });

  if (result.error) {
    throw new Error(`AWS CLI invocation failed: ${boundedText(result.error.message)}.`);
  }
  if (result.status !== 0) {
    throw new Error(`AWS ECS API call failed: ${boundedText(result.stderr)}.`);
  }

  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    throw new Error(`AWS ECS returned invalid JSON: ${boundedText(error.message)}.`);
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeProgress(observation, reason) {
  process.stderr.write(
    '[ECS deployment waiter] '
    + `deployment=${observation.serviceDeploymentArn || 'not-visible'} `
    + `revision=${observation.targetServiceRevisionArn || 'not-visible'} `
    + `state=${observation.status || 'not-visible'} `
    + `stage=${observation.lifecycleStage || 'not-visible'} `
    + `reason=${boundedText(reason)}\n`
  );
}

async function waitForServiceDeployment(options, dependencies = {}) {
  const callAws = dependencies.runAwsJson || runAwsJson;
  const currentTime = dependencies.now || Date.now;
  const pause = dependencies.sleep || sleep;
  const reportProgress = dependencies.writeProgress || writeProgress;
  const deadline = currentTime() + (options.timeoutSeconds * 1000);
  let deploymentArn = '';
  let lastObservation = null;
  let lastProgressKey = '';
  let revisionVerified = false;

  while (currentTime() < deadline) {
    if (!revisionVerified) {
      const revisionResponse = callAws(options.region, [
        'describe-service-revisions',
        '--service-revision-arns', options.expectedServiceRevisionArn
      ]);
      const revision = (revisionResponse.serviceRevisions || []).find(
        (candidate) => candidate.serviceRevisionArn === options.expectedServiceRevisionArn
      );

      if (!revision) {
        lastObservation = {
          serviceDeploymentArn: 'not-visible',
          targetServiceRevisionArn: options.expectedServiceRevisionArn,
          requestedTaskDefinitionArn: options.requestedTaskDefinitionArn,
          status: 'PENDING',
          statusReason: 'The expected service revision is not visible yet.',
          lifecycleStage: 'unavailable'
        };
      } else if (revision.taskDefinition !== options.requestedTaskDefinitionArn) {
        return {
          ...lastObservation,
          outcome: 'failure',
          serviceDeploymentArn: 'not-correlated',
          targetServiceRevisionArn: options.expectedServiceRevisionArn,
          requestedTaskDefinitionArn: options.requestedTaskDefinitionArn,
          status: 'CORRELATION_FAILED',
          statusReason: 'The target service revision does not use the requested task definition.',
          reason: 'Task definition to service revision correlation failed.'
        };
      } else {
        revisionVerified = true;
      }
    }

    if (revisionVerified && !deploymentArn) {
      const listResponse = callAws(options.region, [
        'list-service-deployments',
        '--service', options.serviceArn,
        '--max-results', '100'
      ]);
      const selection = selectSpecificDeployment(
        listResponse.serviceDeployments,
        options.expectedServiceRevisionArn,
        options.baselineArns
      );

      if (selection.outcome === 'failure') {
        return {
          outcome: 'failure',
          serviceDeploymentArn: 'ambiguous',
          targetServiceRevisionArn: options.expectedServiceRevisionArn,
          requestedTaskDefinitionArn: options.requestedTaskDefinitionArn,
          status: 'CORRELATION_FAILED',
          statusReason: selection.reason,
          lifecycleStage: 'unavailable',
          reason: selection.reason
        };
      }

      if (selection.outcome === 'found') {
        deploymentArn = selection.deployment.serviceDeploymentArn;
      } else {
        lastObservation = {
          serviceDeploymentArn: 'not-visible',
          targetServiceRevisionArn: options.expectedServiceRevisionArn,
          requestedTaskDefinitionArn: options.requestedTaskDefinitionArn,
          status: 'PENDING',
          statusReason: selection.reason,
          lifecycleStage: 'unavailable'
        };
      }
    }

    if (deploymentArn) {
      const describeResponse = callAws(options.region, [
        'describe-service-deployments',
        '--service-deployment-arns', deploymentArn
      ]);
      const described = (describeResponse.serviceDeployments || []).find(
        (deployment) => deployment.serviceDeploymentArn === deploymentArn
      );

      if (described) {
        lastObservation = normalizeDeployment(described, options.requestedTaskDefinitionArn);
        const evaluation = evaluateDeploymentState(lastObservation, options);
        const result = { ...lastObservation, ...evaluation };
        const progressKey = `${result.status}|${result.lifecycleStage}|${result.statusReason}`;

        if (progressKey !== lastProgressKey) {
          reportProgress(result, result.reason);
          lastProgressKey = progressKey;
        }

        if (result.outcome !== 'wait') {
          return result;
        }
      }
    }

    if (lastObservation) {
      const progressKey = `${lastObservation.status}|${lastObservation.statusReason}`;
      if (progressKey !== lastProgressKey) {
        reportProgress(lastObservation, lastObservation.statusReason);
        lastProgressKey = progressKey;
      }
    }

    await pause(options.pollIntervalSeconds * 1000);
  }

  return timeoutResult(lastObservation, options);
}

async function runCli() {
  let result;

  try {
    const options = parseArguments(process.argv.slice(2));
    result = await waitForServiceDeployment(options);
  } catch (error) {
    result = {
      outcome: 'failure',
      serviceDeploymentArn: 'unavailable',
      targetServiceRevisionArn: 'unavailable',
      requestedTaskDefinitionArn: 'unavailable',
      status: 'WAITER_ERROR',
      statusReason: boundedText(error.message),
      lifecycleStage: 'unavailable',
      reason: boundedText(error.message)
    };
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.outcome === 'success' ? 0 : 2;
}

if (require.main === module) {
  runCli();
}

module.exports = {
  FAILURE_STATES,
  KNOWN_STATES,
  WAITING_STATES,
  boundedText,
  evaluateDeploymentState,
  normalizeDeployment,
  selectSpecificDeployment,
  timeoutResult,
  waitForServiceDeployment
};
