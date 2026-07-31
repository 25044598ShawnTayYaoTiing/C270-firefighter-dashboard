'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MAX_INPUT_BYTES,
  MAX_STRING_LENGTH,
  MAX_TOTAL_BYTES,
  redactSensitiveText,
  sanitizeDiagnostics,
  truncateString
} = require('../sanitizeDiagnostics');
const {
  DEFAULT_AIOPS_GEMINI_MODEL,
  analyzeDiagnostics
} = require('../analyzeDeploymentFailure');
const {
  DETERMINISTIC_DEPLOYMENT_RESULT,
  FAKE_SENSITIVE_VALUES,
  PROMPT_INJECTION_TEXT,
  createRawSimulatedFailure
} = require('./simulatedFailure');
const {
  MOCK_ANALYSIS,
  createMockClientFactory,
  evaluateSanitization
} = require('./runDemo');

const MODES = Object.freeze({
  live: 'LIVE GEMINI',
  mocked: 'MOCKED',
  mockedFallback: 'MOCKED FALLBACK (LIVE GEMINI UNAVAILABLE)'
});

function assertSanitizationChecks(checks) {
  for (const [name, absent] of Object.entries(checks.fakeValuesAbsent)) {
    assert.equal(absent, true, `fake sensitive value survived sanitization: ${name}`);
  }

  for (const [name, passed] of Object.entries(checks)) {
    if (name !== 'fakeValuesAbsent') {
      assert.equal(passed, true, `workflow demo safety invariant failed: ${name}`);
    }
  }
}

function writePrivateJson(outputPath, value) {
  const resolvedPath = path.resolve(outputPath);
  fs.writeFileSync(resolvedPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function prepareSyntheticDiagnostics(outputPath = null) {
  const rawDiagnostics = createRawSimulatedFailure();
  const sanitizedDiagnostics = sanitizeDiagnostics(rawDiagnostics);
  const sanitization = evaluateSanitization(rawDiagnostics, sanitizedDiagnostics);

  assertSanitizationChecks(sanitization);

  if (outputPath) {
    writePrivateJson(outputPath, sanitizedDiagnostics);
  }

  return {
    sanitizedDiagnostics,
    sanitization,
    deploymentResult: DETERMINISTIC_DEPLOYMENT_RESULT
  };
}

function readPreparedDiagnostics(inputPath) {
  const inputSize = fs.statSync(inputPath).size;
  assert.ok(inputSize <= MAX_INPUT_BYTES, 'prepared diagnostics exceed the input limit');

  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  return sanitizeDiagnostics(parsed);
}

function resolveOption(options, name, environmentName) {
  if (Object.hasOwn(options, name)) {
    return String(options[name] || '').trim();
  }

  return String(process.env[environmentName] || '').trim();
}

async function runMockedAnalysis(diagnostics) {
  const capture = {
    modelCalls: 0,
    request: null
  };
  const result = await analyzeDiagnostics(diagnostics, {
    apiKey: ['github', 'demo', 'placeholder'].join('-'),
    model: 'github-actions-schema-validation-mock',
    clientFactory: createMockClientFactory(MOCK_ANALYSIS, capture)
  });

  assert.equal(result.available, true);
  assert.equal(capture.modelCalls, 1);

  return result;
}

async function runWorkflowAnalysis(diagnostics, options = {}) {
  const rawDiagnostics = createRawSimulatedFailure();
  const normalizedDiagnostics = sanitizeDiagnostics(diagnostics);
  const sanitization = evaluateSanitization(rawDiagnostics, normalizedDiagnostics);
  const apiKey = resolveOption(options, 'apiKey', 'AIOPS_GEMINI_API_KEY');
  const model = resolveOption(options, 'model', 'AIOPS_GEMINI_MODEL')
    || DEFAULT_AIOPS_GEMINI_MODEL;

  assertSanitizationChecks(sanitization);

  let mode = MODES.mocked;
  let liveAttempted = false;
  let analysisResult;

  if (apiKey) {
    liveAttempted = true;
    const liveOptions = {
      apiKey,
      model
    };

    if (options.liveClientFactory) {
      liveOptions.clientFactory = options.liveClientFactory;
    }

    analysisResult = await analyzeDiagnostics(normalizedDiagnostics, liveOptions);
    if (analysisResult.available) {
      mode = MODES.live;
    } else {
      mode = MODES.mockedFallback;
      analysisResult = await runMockedAnalysis(normalizedDiagnostics);
    }
  } else {
    analysisResult = await runMockedAnalysis(normalizedDiagnostics);
  }

  assert.equal(analysisResult.available, true);
  assert.equal(analysisResult.analysis.humanReviewRequired, true);
  assert.equal(analysisResult.humanReviewRequired, true);

  return {
    mode,
    liveAttempted,
    selectedModel: model,
    analysisResult,
    sanitization,
    deploymentResult: DETERMINISTIC_DEPLOYMENT_RESULT,
    authorityBoundary: {
      awsCredentialsAvailable: false,
      oidcPermission: false,
      awsCalls: 0,
      deploymentActions: 0,
      rollbackActions: 0,
      automaticRemediationActions: 0
    }
  };
}

function safeSummaryText(value) {
  const withoutPromptText = redactSensitiveText(value)
    .replaceAll(PROMPT_INJECTION_TEXT, '[UNTRUSTED DIAGNOSTIC TEXT OMITTED]');

  return truncateString(withoutPromptText, 512)
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]<>#])/g, '\\$1');
}

function yesNo(value) {
  return value ? 'YES' : 'NO';
}

function renderWorkflowSummary(result) {
  const analysis = result.analysisResult.analysis;
  const lines = [
    '# AIOps FA Demonstration',
    '',
    '> **SIMULATED LOCAL FAILURE EVIDENCE RUN IN GITHUB ACTIONS**',
    '',
    '| Item | Result |',
    '|---|---|',
    '| Execution environment | GitHub Actions |',
    '| Failure source | Synthetic ECS deployment evidence |',
    '| Backend | Revision 29 → FAILED |',
    '| Rollback evidence | Revision 28 restored; health passed |',
    '',
    '## Sanitization',
    '',
    `- Authorization header removed: **${yesNo(result.sanitization.fakeValuesAbsent.authorization)}**`,
    `- AWS token removed: **${yesNo(result.sanitization.fakeValuesAbsent.awsAccessToken)}**`,
    `- Database password removed: **${yesNo(result.sanitization.fakeValuesAbsent.databasePassword)}**`,
    `- Session secret removed: **${yesNo(result.sanitization.fakeValuesAbsent.sessionSecret)}**`,
    `- Environment data removed: **${yesNo(result.sanitization.environmentRemoved)}**`,
    `- Raw task definition removed: **${yesNo(result.sanitization.rawTaskDefinitionRemoved)}**`,
    `- Raw logs removed: **${yesNo(result.sanitization.rawLogsRemoved)}**`,
    `- Diagnostic string bounded: **${yesNo(result.sanitization.failureMessageBounded)}**`,
    `- Total payload bounded: **${yesNo(result.sanitization.payloadBounded)}**`,
    `- Prompt-injection-shaped text treated as untrusted data: **${yesNo(result.sanitization.promptInjectionRetainedAsData)}**`,
    '',
    '## AIOps',
    '',
    `- Mode: **${safeSummaryText(result.mode)}**`,
    `- Selected Gemini model: **${safeSummaryText(result.selectedModel)}**`,
    `- Live Gemini attempted: **${yesNo(result.liveAttempted)}**`,
    `- Classification: **${safeSummaryText(analysis.classification)}**`,
    `- Confidence: **${analysis.confidence.toFixed(2)}**`,
    `- Evidence fields: ${analysis.evidence.map((item) => `\`${safeSummaryText(item)}\``).join(', ')}`,
    `- Likely cause: ${safeSummaryText(analysis.likelyRootCause)}`,
    `- Recommended checks: ${safeSummaryText(analysis.recommendedNextAction)}`,
    `- Human review required: **${analysis.humanReviewRequired ? 'TRUE' : 'FALSE'}**`,
    `- Deployment result remains: **${safeSummaryText(result.deploymentResult)}**`,
    '',
    '## Authority boundary',
    '',
    `- AWS credentials available: **${yesNo(result.authorityBoundary.awsCredentialsAvailable)}**`,
    `- OIDC permission: **${yesNo(result.authorityBoundary.oidcPermission)}**`,
    `- AWS calls: **${result.authorityBoundary.awsCalls}**`,
    `- Deployment actions: **${result.authorityBoundary.deploymentActions}**`,
    `- Rollback actions: **${result.authorityBoundary.rollbackActions}**`,
    `- Automatic remediation: **${result.authorityBoundary.automaticRemediationActions}**`,
    '',
    'The analysis is advisory. No AI-produced text is executed.'
  ];
  const summary = lines.join('\n');

  for (const value of Object.values(FAKE_SENSITIVE_VALUES)) {
    assert.equal(summary.includes(value), false, 'fake sensitive value reached summary');
  }
  assert.equal(
    summary.includes(PROMPT_INJECTION_TEXT),
    false,
    'prompt-injection-shaped diagnostic text reached summary'
  );
  assert.match(summary, /Human review required: \*\*TRUE\*\*/);
  assert.match(summary, /Deployment result remains: \*\*FAILED\*\*/);

  return summary;
}

function appendWorkflowSummary(summary, summaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (!summaryPath) {
    console.log(summary);
    return;
  }

  fs.appendFileSync(path.resolve(summaryPath), `${summary}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

async function runCli() {
  const [command, diagnosticsPath = 'aiops-demo-sanitized.json'] = process.argv.slice(2);

  if (command === 'prepare') {
    const prepared = prepareSyntheticDiagnostics(diagnosticsPath);
    const byteLength = Buffer.byteLength(
      JSON.stringify(prepared.sanitizedDiagnostics),
      'utf8'
    );

    console.log('[AIOps FA Demo] Synthetic backend revision 29 failure loaded.');
    console.log('[AIOps FA Demo] Fake sensitive fields removed before analysis.');
    console.log(
      `[AIOps FA Demo] Sanitized diagnostics bounded (${byteLength}/${MAX_TOTAL_BYTES} bytes; `
      + `${prepared.sanitizedDiagnostics.failure.message.length}/${MAX_STRING_LENGTH} message characters).`
    );
    console.log('[AIOps FA Demo] Deployment result remains FAILED.');
    return;
  }

  if (command === 'analyze') {
    const diagnostics = readPreparedDiagnostics(diagnosticsPath);
    const result = await runWorkflowAnalysis(diagnostics);
    const summary = renderWorkflowSummary(result);

    appendWorkflowSummary(summary);
    console.log(`[AIOps FA Demo] Analysis mode: ${result.mode}.`);
    console.log(`[AIOps FA Demo] Selected Gemini model: ${result.selectedModel}.`);
    console.log(`[AIOps FA Demo] Classification: ${result.analysisResult.analysis.classification}.`);
    console.log('[AIOps FA Demo] Human review required: TRUE.');
    console.log('[AIOps FA Demo] Deployment result remains FAILED.');
    console.log('[AIOps FA Demo] AWS/OIDC/deployment authority: NONE.');
    return;
  }

  throw new Error('Usage: node runWorkflowDemo.js <prepare|analyze> [diagnostics.json]');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`[AIOps FA Demo] Safety validation failed: ${redactSensitiveText(error.message)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  MODES,
  appendWorkflowSummary,
  prepareSyntheticDiagnostics,
  readPreparedDiagnostics,
  renderWorkflowSummary,
  runWorkflowAnalysis,
  safeSummaryText
};
