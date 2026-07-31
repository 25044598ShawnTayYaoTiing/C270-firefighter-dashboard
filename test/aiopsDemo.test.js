'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_STRING_LENGTH,
  MAX_TOTAL_BYTES,
  sanitizeDiagnostics
} = require('../scripts/aiops/sanitizeDiagnostics');
const {
  FIXED_SYSTEM_INSTRUCTION,
  analyzeDiagnostics
} = require('../scripts/aiops/analyzeDeploymentFailure');
const {
  DETERMINISTIC_DEPLOYMENT_RESULT,
  FAKE_SENSITIVE_VALUES,
  PROMPT_INJECTION_TEXT,
  createRawSimulatedFailure
} = require('../scripts/aiops/demo/simulatedFailure');
const {
  MOCK_ANALYSIS,
  createMockClientFactory,
  formatDemoOutput,
  runLocalDemo
} = require('../scripts/aiops/demo/runDemo');

test('local AIOps demo removes fake secrets and bounds the simulated failure', () => {
  const rawDiagnostics = createRawSimulatedFailure();
  const sanitized = sanitizeDiagnostics(rawDiagnostics);
  const serialized = JSON.stringify(sanitized);

  for (const value of Object.values(FAKE_SENSITIVE_VALUES)) {
    assert.doesNotMatch(serialized, new RegExp(value));
  }

  assert.equal('headers' in sanitized, false);
  assert.equal('awsCredentials' in sanitized, false);
  assert.equal('environment' in sanitized, false);
  assert.equal('database' in sanitized, false);
  assert.equal('rawTaskDefinition' in sanitized, false);
  assert.equal('logs' in sanitized, false);
  assert.equal('transcript' in sanitized, false);
  assert.equal(
    'rawStoppedTask' in sanitized.services.backend.recentDeployments[0],
    false
  );
  assert.ok(rawDiagnostics.failure.message.length > MAX_STRING_LENGTH);
  assert.ok(sanitized.failure.message.length <= MAX_STRING_LENGTH);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= MAX_TOTAL_BYTES);
});

test('local AIOps demo sends only sanitized untrusted data through the real analyzer', async () => {
  const demo = await runLocalDemo();
  const request = demo.capture.request;

  assert.equal(demo.analysisResult.available, true);
  assert.equal(request.config.systemInstruction, FIXED_SYSTEM_INSTRUCTION);
  assert.match(request.contents, new RegExp(PROMPT_INJECTION_TEXT));
  assert.ok(
    request.contents.indexOf('untrusted data')
      < request.contents.indexOf(PROMPT_INJECTION_TEXT)
  );
  assert.match(request.contents, /<allowlisted-evidence>/);
  assert.ok(request.contents.includes(JSON.stringify(demo.analysisResult.evidenceCatalog)));

  for (const value of Object.values(FAKE_SENSITIVE_VALUES)) {
    assert.doesNotMatch(request.contents, new RegExp(value));
  }
});

test('local mocked analysis follows the validated schema and requires human review', async () => {
  const demo = await runLocalDemo();

  assert.deepEqual(demo.analysisResult.analysis, MOCK_ANALYSIS);
  assert.equal(demo.analysisResult.analysis.humanReviewRequired, true);
  assert.equal(demo.analysisResult.humanReviewRequired, true);
  assert.equal('tools' in demo.capture.request, false);
  assert.equal('tools' in demo.capture.request.config, false);
  assert.equal('functionCallingConfig' in demo.capture.request.config, false);
});

test('local demo cannot accept a mocked analysis that disables human review', async () => {
  const capture = { modelCalls: 0, request: null };
  const result = await analyzeDiagnostics(createRawSimulatedFailure(), {
    apiKey: ['local', 'demo', 'placeholder'].join('-'),
    model: 'local-schema-validation-mock',
    clientFactory: createMockClientFactory({
      ...MOCK_ANALYSIS,
      humanReviewRequired: false
    }, capture)
  });

  assert.equal(result.available, false);
  assert.equal(result.message, 'AI analysis unavailable');
  assert.equal(result.humanReviewRequired, true);
});

test('local demo preserves FAILED status and has no external execution capability', async () => {
  const demo = await runLocalDemo();
  const output = formatDemoOutput(demo);
  const demoSourcePaths = [
    path.join(__dirname, '..', 'scripts', 'aiops', 'demo', 'simulatedFailure.js'),
    path.join(__dirname, '..', 'scripts', 'aiops', 'demo', 'runDemo.js')
  ];
  const demoSource = demoSourcePaths
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');

  assert.equal(DETERMINISTIC_DEPLOYMENT_RESULT, 'FAILED');
  assert.equal(demo.deploymentResult, 'FAILED');
  assert.deepEqual(demo.runtimeBoundary, {
    awsCredentialsRequired: false,
    awsCalls: 0,
    networkRequests: 0,
    commandExecutions: 0,
    automaticRemediationActions: 0
  });
  assert.doesNotMatch(
    demoSource,
    /require\(['"](?:@aws-sdk|aws-sdk|node:child_process|node:http|node:https|node:net|node:tls)/
  );
  assert.doesNotMatch(
    demoSource,
    /\b(?:exec|execFile|fork|spawn|fetch)\s*\(/
  );
  assert.match(output, /SIMULATED LOCAL FAILURE EVIDENCE/);
  assert.match(output, /HUMAN REVIEW REQUIRED: TRUE/);
  assert.match(output, /DEPLOYMENT RESULT REMAINS: FAILED/);
  assert.match(output, /AWS calls performed: 0/);
  assert.match(output, /Network\/cloud requests performed: 0/);
  assert.match(output, /Commands executed: 0/);
  assert.match(output, /Automatic remediation actions: 0/);
});
