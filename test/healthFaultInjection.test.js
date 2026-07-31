'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const workflowPath = path.join(projectRoot, '.github', 'workflows', 'deploy.yml');
const originalFaultValue = process.env.FA_DEMO_HEALTH_FAILURE;

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'fa-health-test-session-secret';
const app = require('../app');

let server;
let port;

function request(requestPath) {
  return new Promise((resolve, reject) => {
    const clientRequest = http.get({
      host: '127.0.0.1',
      port,
      path: requestPath,
      headers: { Connection: 'close' }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });

    clientRequest.setTimeout(3000, () => {
      clientRequest.destroy(new Error(`Timed out requesting ${requestPath}.`));
    });
    clientRequest.once('error', reject);
  });
}

function setFaultValue(value) {
  if (value === undefined) {
    delete process.env.FA_DEMO_HEALTH_FAILURE;
  } else {
    process.env.FA_DEMO_HEALTH_FAILURE = value;
  }
}

test.before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => {
      port = server.address().port;
      resolve();
    });
  });
});

test.after(async () => {
  setFaultValue(originalFaultValue);
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('health fault injection is disabled unless the value is exactly lowercase true', async () => {
  for (const faultValue of [undefined, 'false', 'TRUE', '1', 'yes', '']) {
    setFaultValue(faultValue);
    const health = await request('/health');

    assert.equal(health.statusCode, 200);
    assert.deepEqual(JSON.parse(health.body), { status: 'ok' });
  }

  const staticAsset = await request('/css/style.css');
  assert.equal(staticAsset.statusCode, 200);
  assert.match(staticAsset.body, /body\s*\{/);
});

test('explicit health fault returns only the safe 503 payload and leaves the process running', async () => {
  setFaultValue('true');
  const health = await request('/health');

  assert.equal(health.statusCode, 503);
  assert.deepEqual(JSON.parse(health.body), {
    status: 'unhealthy',
    reason: 'fa-demo-health-failure'
  });
  assert.doesNotMatch(
    health.body,
    /secret|credential|token|password|api.?key|stack|environment/i
  );
  assert.equal(server.listening, true);

  const repeatedHealth = await request('/health');
  assert.equal(repeatedHealth.statusCode, 503);

  const staticAsset = await request('/css/style.css');
  assert.equal(staticAsset.statusCode, 200);
  assert.match(staticAsset.body, /body\s*\{/);
});

test('manual workflow input injects the fault only into an explicitly requested backend revision', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const taskDefinitionStep = workflow.split(
    '      - name: Create task-definition revisions for both ECS services'
  )[1].split('      - name: Install constrained Ansible deployment tooling')[0];

  assert.match(
    workflow,
    /inject_health_failure:\s*\n\s+description:[^\n]+\n\s+required: true\s*\n\s+default: false\s*\n\s+type: boolean/
  );
  assert.match(
    taskDefinitionStep,
    /github\.event_name == 'workflow_dispatch' && inputs\.deploy && inputs\.inject_health_failure/
  );
  assert.match(
    taskDefinitionStep,
    /map\(select\(\.name != "FA_DEMO_HEALTH_FAILURE"\)\)/
  );
  assert.match(
    taskDefinitionStep,
    /if \$inject_health_failure == "true" then\s+\[\{"name": "FA_DEMO_HEALTH_FAILURE", "value": "true"\}\]/
  );

  const frontendRevision = taskDefinitionStep.split(
    "          ' backend-task-definition.json > new-backend-task-definition.json"
  )[1];
  assert.doesNotMatch(frontendRevision, /FA_DEMO_HEALTH_FAILURE/);
});
