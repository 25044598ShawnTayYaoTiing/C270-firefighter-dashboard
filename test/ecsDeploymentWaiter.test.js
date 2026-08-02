'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  evaluateDeploymentState,
  selectSpecificDeployment,
  timeoutResult,
  waitForServiceDeployment
} = require('../ansible/roles/ecs_express_deploy/files/waitForServiceDeployment');

const projectRoot = path.join(__dirname, '..');
const expectedTaskDefinitionArn = 'arn:aws:ecs:ap-southeast-1:111122223333:task-definition/backend:36';
const expectedServiceRevisionArn = 'arn:aws:ecs:ap-southeast-1:111122223333:service-revision/default/backend/new';
const previousServiceRevisionArn = 'arn:aws:ecs:ap-southeast-1:111122223333:service-revision/default/backend/previous';
const oldDeploymentArn = 'arn:aws:ecs:ap-southeast-1:111122223333:service-deployment/default/backend/old';
const newDeploymentArn = 'arn:aws:ecs:ap-southeast-1:111122223333:service-deployment/default/backend/new';

function observation(overrides = {}) {
  return {
    serviceDeploymentArn: newDeploymentArn,
    targetServiceRevisionArn: expectedServiceRevisionArn,
    requestedTaskDefinitionArn: expectedTaskDefinitionArn,
    status: 'IN_PROGRESS',
    statusReason: 'Canary tasks are being evaluated.',
    lifecycleStage: 'BAKE_TIME',
    rollbackServiceRevisionArn: 'unavailable',
    ...overrides
  };
}

test('ACTIVE service metadata cannot override an IN_PROGRESS deployment', () => {
  const result = evaluateDeploymentState(observation({
    serviceStatus: 'ACTIVE',
    activeTaskDefinitionArn: expectedTaskDefinitionArn
  }), {
    operation: 'deployment',
    expectedServiceRevisionArn
  });

  assert.equal(result.outcome, 'wait');
  assert.match(result.reason, /IN_PROGRESS/);
});

test('the specifically correlated SUCCESSFUL deployment is accepted', () => {
  const result = evaluateDeploymentState(observation({
    status: 'SUCCESSFUL',
    statusReason: 'Deployment completed.',
    lifecycleStage: 'CLEAN_UP'
  }), {
    operation: 'deployment',
    expectedServiceRevisionArn
  });

  assert.equal(result.outcome, 'success');
});

test('all non-terminal ECS deployment states continue bounded polling', async (t) => {
  for (const status of [
    'PENDING',
    'IN_PROGRESS',
    'STOP_REQUESTED',
    'ROLLBACK_REQUESTED',
    'ROLLBACK_IN_PROGRESS'
  ]) {
    await t.test(status, () => {
      const result = evaluateDeploymentState(observation({ status }), {
        operation: 'deployment',
        expectedServiceRevisionArn
      });
      assert.equal(result.outcome, 'wait');
    });
  }
});

test('STOPPED and ROLLBACK_FAILED are authoritative deployment failures', async (t) => {
  for (const status of ['STOPPED', 'ROLLBACK_FAILED']) {
    await t.test(status, () => {
      const result = evaluateDeploymentState(observation({ status }), {
        operation: 'deployment',
        expectedServiceRevisionArn
      });

      assert.equal(result.outcome, 'failure');
      assert.match(result.reason, new RegExp(status));
    });
  }
});

test('rollback in progress continues waiting for an authoritative terminal state', () => {
  const result = evaluateDeploymentState(observation({ status: 'ROLLBACK_IN_PROGRESS' }), {
    operation: 'rollback',
    expectedServiceRevisionArn
  });

  assert.equal(result.outcome, 'wait');
});

test('ROLLBACK_SUCCESSFUL is rollback success only for the expected prior revision', () => {
  const result = evaluateDeploymentState(observation({
    status: 'ROLLBACK_SUCCESSFUL',
    rollbackServiceRevisionArn: previousServiceRevisionArn
  }), {
    operation: 'rollback',
    expectedServiceRevisionArn: previousServiceRevisionArn
  });

  assert.equal(result.outcome, 'success');

  const wrongRevision = evaluateDeploymentState(observation({
    status: 'ROLLBACK_SUCCESSFUL',
    rollbackServiceRevisionArn: 'arn:aws:ecs:ap-southeast-1:111122223333:service-revision/default/backend/wrong'
  }), {
    operation: 'rollback',
    expectedServiceRevisionArn: previousServiceRevisionArn
  });
  assert.equal(wrongRevision.outcome, 'failure');
});

test('automatic rollback means the requested forward deployment failed', () => {
  const result = evaluateDeploymentState(observation({
    status: 'ROLLBACK_SUCCESSFUL',
    rollbackServiceRevisionArn: previousServiceRevisionArn
  }), {
    operation: 'deployment',
    expectedServiceRevisionArn
  });

  assert.equal(result.outcome, 'failure');
  assert.match(result.reason, /did not succeed/);
});

test('an old successful deployment cannot mask the new in-progress deployment', () => {
  const selection = selectSpecificDeployment([
    {
      serviceDeploymentArn: oldDeploymentArn,
      targetServiceRevisionArn: expectedServiceRevisionArn,
      status: 'SUCCESSFUL'
    },
    {
      serviceDeploymentArn: newDeploymentArn,
      targetServiceRevisionArn: expectedServiceRevisionArn,
      status: 'IN_PROGRESS'
    }
  ], expectedServiceRevisionArn, [oldDeploymentArn]);

  assert.equal(selection.outcome, 'found');
  assert.equal(selection.deployment.serviceDeploymentArn, newDeploymentArn);

  const result = evaluateDeploymentState(observation(selection.deployment), {
    operation: 'deployment',
    expectedServiceRevisionArn
  });
  assert.equal(result.outcome, 'wait');
});

test('timeout fails with bounded deployment identity and state diagnostics', () => {
  const result = timeoutResult(observation({
    status: 'IN_PROGRESS',
    statusReason: 'Canary health checks have not completed.'
  }), {
    expectedServiceRevisionArn,
    requestedTaskDefinitionArn: expectedTaskDefinitionArn
  });

  assert.equal(result.outcome, 'timeout');
  assert.equal(result.serviceDeploymentArn, newDeploymentArn);
  assert.match(result.reason, /Timed out/);
  assert.match(result.reason, /IN_PROGRESS/);
  assert.match(result.reason, /Canary health checks/);
});

test('a public 200 response from old tasks cannot complete an in-progress deployment', () => {
  const result = evaluateDeploymentState(observation({
    publicHealthStatus: 200,
    publicHealthBody: { status: 'ok' },
    status: 'IN_PROGRESS'
  }), {
    operation: 'deployment',
    expectedServiceRevisionArn
  });

  assert.equal(result.outcome, 'wait');
});

test('waiter correlates task definition to revision to new deployment before succeeding', async () => {
  let clock = 0;
  let describeCalls = 0;
  const calls = [];
  const runAwsJson = (_region, args) => {
    calls.push(args[0]);

    if (args[0] === 'describe-service-revisions') {
      return {
        serviceRevisions: [{
          serviceRevisionArn: expectedServiceRevisionArn,
          taskDefinition: expectedTaskDefinitionArn
        }]
      };
    }
    if (args[0] === 'list-service-deployments') {
      return {
        serviceDeployments: [
          {
            serviceDeploymentArn: oldDeploymentArn,
            targetServiceRevisionArn: expectedServiceRevisionArn,
            status: 'SUCCESSFUL'
          },
          {
            serviceDeploymentArn: newDeploymentArn,
            targetServiceRevisionArn: expectedServiceRevisionArn,
            status: 'IN_PROGRESS'
          }
        ]
      };
    }

    describeCalls += 1;
    return {
      serviceDeployments: [{
        serviceDeploymentArn: newDeploymentArn,
        targetServiceRevision: { arn: expectedServiceRevisionArn },
        status: describeCalls === 1 ? 'IN_PROGRESS' : 'SUCCESSFUL',
        statusReason: describeCalls === 1 ? 'Canary is baking.' : 'Deployment completed.',
        lifecycleStage: describeCalls === 1 ? 'BAKE_TIME' : 'CLEAN_UP'
      }]
    };
  };

  const result = await waitForServiceDeployment({
    region: 'ap-southeast-1',
    serviceArn: 'arn:aws:ecs:ap-southeast-1:111122223333:service/default/backend',
    requestedTaskDefinitionArn: expectedTaskDefinitionArn,
    expectedServiceRevisionArn,
    baselineArns: [oldDeploymentArn],
    operation: 'deployment',
    timeoutSeconds: 30,
    pollIntervalSeconds: 1
  }, {
    runAwsJson,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    writeProgress: () => {}
  });

  assert.equal(result.outcome, 'success');
  assert.equal(result.serviceDeploymentArn, newDeploymentArn);
  assert.deepEqual(calls, [
    'describe-service-revisions',
    'list-service-deployments',
    'describe-service-deployments',
    'describe-service-deployments'
  ]);
});

test('waiter times out safely when the specifically correlated deployment never appears', async () => {
  let clock = 0;
  const result = await waitForServiceDeployment({
    region: 'ap-southeast-1',
    serviceArn: 'arn:aws:ecs:ap-southeast-1:111122223333:service/default/backend',
    requestedTaskDefinitionArn: expectedTaskDefinitionArn,
    expectedServiceRevisionArn,
    baselineArns: [oldDeploymentArn],
    operation: 'deployment',
    timeoutSeconds: 2,
    pollIntervalSeconds: 1
  }, {
    runAwsJson: (_region, args) => (
      args[0] === 'describe-service-revisions'
        ? {
            serviceRevisions: [{
              serviceRevisionArn: expectedServiceRevisionArn,
              taskDefinition: expectedTaskDefinitionArn
            }]
          }
        : { serviceDeployments: [] }
    ),
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    writeProgress: () => {}
  });

  assert.equal(result.outcome, 'timeout');
  assert.equal(result.targetServiceRevisionArn, expectedServiceRevisionArn);
  assert.match(result.reason, /not-visible/);
});

test('Ansible performs health checks only after authoritative deployment success', () => {
  const waiter = fs.readFileSync(path.join(
    projectRoot,
    'ansible',
    'roles',
    'ecs_express_deploy',
    'tasks',
    'wait_for_service.yml'
  ), 'utf8');
  const helper = fs.readFileSync(path.join(
    projectRoot,
    'ansible',
    'roles',
    'ecs_express_deploy',
    'files',
    'waitForServiceDeployment.js'
  ), 'utf8');
  const backend = fs.readFileSync(path.join(
    projectRoot,
    'ansible',
    'roles',
    'ecs_express_deploy',
    'tasks',
    'backend.yml'
  ), 'utf8');
  const rollbackController = fs.readFileSync(path.join(
    projectRoot,
    'ansible',
    'roles',
    'ecs_express_deploy',
    'tasks',
    'rollback.yml'
  ), 'utf8');
  const rollbackBackend = fs.readFileSync(path.join(
    projectRoot,
    'ansible',
    'roles',
    'ecs_express_deploy',
    'tasks',
    'rollback_backend.yml'
  ), 'utf8');

  assert.doesNotMatch(waiter, /describe-express-gateway-service/);
  assert.match(helper, /describe-service-revisions/);
  assert.match(helper, /list-service-deployments/);
  assert.match(helper, /describe-service-deployments/);
  assert.match(backend, /service\.targetConfiguration\.\{serviceRevisionArn:serviceRevisionArn,taskDefinitionArn:taskDefinitionArn\}/);
  assert.match(backend, /ecs_express_deploy_backend_deployment_baseline/);
  assert.ok(
    rollbackController.indexOf('import_tasks: rollback_backend.yml')
      < rollbackController.indexOf('import_tasks: rollback_frontend.yml')
  );
  assert.match(rollbackBackend, /ecs_express_deploy_wait_operation: rollback/);
  assert.ok(
    backend.indexOf('Wait for backend ECS Express service stability')
      < backend.indexOf('Verify backend application health endpoint')
  );
  assert.ok(
    rollbackBackend.indexOf('Wait for authoritative backend rollback deployment')
      < rollbackBackend.indexOf('Verify backend health after rollback')
  );
});
