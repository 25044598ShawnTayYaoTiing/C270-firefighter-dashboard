'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  FAKE_SENSITIVE_VALUES,
  PROMPT_INJECTION_TEXT
} = require('../scripts/aiops/demo/simulatedFailure');
const {
  MOCK_ANALYSIS,
  createMockClientFactory
} = require('../scripts/aiops/demo/runDemo');
const {
  DEFAULT_AIOPS_GEMINI_MODEL
} = require('../scripts/aiops/analyzeDeploymentFailure');
const {
  MODES,
  prepareSyntheticDiagnostics,
  renderWorkflowSummary,
  runWorkflowAnalysis
} = require('../scripts/aiops/demo/runWorkflowDemo');

test('GitHub AIOps demo workflow is manual and has no AWS or OIDC authority', () => {
  const workflowPath = path.join(
    __dirname,
    '..',
    '.github',
    'workflows',
    'aiops-demo.yml'
  );
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /^permissions:\s*\n\s+contents: read\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /aws-actions\/configure-aws-credentials/);
  assert.doesNotMatch(workflow, /\baws\s+(?:ecs|ecr|sts)\b/);
  assert.doesNotMatch(workflow, /ansible-playbook/);
  assert.doesNotMatch(workflow, /\bgit\s+push\b/);
  assert.doesNotMatch(workflow, /\bgh\s+pr\s+merge\b/);
  assert.match(workflow, /secrets\.AIOPS_GEMINI_API_KEY/);
  assert.match(workflow, /vars\.AIOPS_GEMINI_MODEL/);
  assert.match(workflow, new RegExp(DEFAULT_AIOPS_GEMINI_MODEL));
  assert.doesNotMatch(workflow, /secrets\.GEMINI_API_KEY/);
});

test('GitHub AIOps demo uses a validated mocked fallback when no secret is available', async () => {
  const prepared = prepareSyntheticDiagnostics();
  const result = await runWorkflowAnalysis(prepared.sanitizedDiagnostics, {
    apiKey: ''
  });
  const summary = renderWorkflowSummary(result);

  assert.equal(result.mode, MODES.mocked);
  assert.equal(result.liveAttempted, false);
  assert.equal(result.selectedModel, DEFAULT_AIOPS_GEMINI_MODEL);
  assert.equal(result.analysisResult.available, true);
  assert.equal(result.analysisResult.analysis.humanReviewRequired, true);
  assert.equal(result.deploymentResult, 'FAILED');
  assert.match(summary, /Mode: \*\*MOCKED\*\*/);
  assert.match(summary, new RegExp(`Selected Gemini model: \\*\\*${DEFAULT_AIOPS_GEMINI_MODEL}\\*\\*`));
  assert.match(summary, /Live Gemini attempted: \*\*NO\*\*/);
});

test('GitHub AIOps demo supports live mode through the production analyzer', async () => {
  const prepared = prepareSyntheticDiagnostics();
  const capture = { modelCalls: 0, request: null };
  const apiKey = ['test', 'only', 'placeholder'].join('-');
  const result = await runWorkflowAnalysis(prepared.sanitizedDiagnostics, {
    apiKey,
    model: 'test-live-model',
    liveClientFactory: createMockClientFactory(MOCK_ANALYSIS, capture)
  });

  assert.equal(result.mode, MODES.live);
  assert.equal(result.liveAttempted, true);
  assert.equal(result.selectedModel, 'test-live-model');
  assert.equal(capture.modelCalls, 1);
  assert.equal(capture.request.model, 'test-live-model');
  assert.equal(result.analysisResult.analysis.humanReviewRequired, true);
  assert.equal('tools' in capture.request, false);
  assert.equal('tools' in capture.request.config, false);
  assert.equal('functionCallingConfig' in capture.request.config, false);
  assert.equal('temperature' in capture.request.config, false);
  assert.match(capture.request.contents, new RegExp(PROMPT_INJECTION_TEXT));
  assert.doesNotMatch(renderWorkflowSummary(result), new RegExp(apiKey));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey));

  for (const value of Object.values(FAKE_SENSITIVE_VALUES)) {
    assert.doesNotMatch(capture.request.contents, new RegExp(value));
  }
});

test('GitHub AIOps demo clearly labels a mocked fallback after a live failure', async () => {
  const prepared = prepareSyntheticDiagnostics();
  const apiKey = ['test', 'fallback', 'placeholder'].join('-');
  const result = await runWorkflowAnalysis(prepared.sanitizedDiagnostics, {
    apiKey,
    model: 'test-fallback-model',
    liveClientFactory: () => ({
      models: {
        async generateContent() {
          throw new Error('simulated Gemini outage');
        }
      }
    })
  });
  const summary = renderWorkflowSummary(result);

  assert.equal(result.mode, MODES.mockedFallback);
  assert.equal(result.liveAttempted, true);
  assert.equal(result.selectedModel, 'test-fallback-model');
  assert.match(summary, /Mode: \*\*MOCKED FALLBACK \(LIVE GEMINI UNAVAILABLE\)\*\*/);
  assert.match(summary, /Selected Gemini model: \*\*test-fallback-model\*\*/);
  assert.match(summary, /Live Gemini attempted: \*\*YES\*\*/);
  assert.doesNotMatch(summary, new RegExp(apiKey));
});

test('GitHub AIOps summary excludes fake values and untrusted prompt text', async () => {
  const prepared = prepareSyntheticDiagnostics();
  const result = await runWorkflowAnalysis(prepared.sanitizedDiagnostics, {
    apiKey: ''
  });
  const summary = renderWorkflowSummary(result);

  for (const value of Object.values(FAKE_SENSITIVE_VALUES)) {
    assert.doesNotMatch(summary, new RegExp(value));
  }

  assert.doesNotMatch(summary, new RegExp(PROMPT_INJECTION_TEXT));
  assert.match(summary, /Human review required: \*\*TRUE\*\*/);
  assert.match(summary, /Deployment result remains: \*\*FAILED\*\*/);
  assert.match(summary, /AWS credentials available: \*\*NO\*\*/);
  assert.match(summary, /OIDC permission: \*\*NO\*\*/);
  assert.match(summary, /AWS calls: \*\*0\*\*/);
  assert.match(summary, /Deployment actions: \*\*0\*\*/);
  assert.match(summary, /Rollback actions: \*\*0\*\*/);
  assert.match(summary, /Automatic remediation: \*\*0\*\*/);
});
