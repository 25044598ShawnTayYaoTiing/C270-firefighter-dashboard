'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeDiagnostics } = require('../scripts/aiops/sanitizeDiagnostics');
const {
  DEFAULT_AIOPS_GEMINI_MODEL,
  FAILURE_CATEGORIES,
  FAILURE_STAGES,
  analyzeDiagnostics,
  classifyGeminiApiError,
  createEvidenceCatalog,
  formatFailureForLog,
  renderSummary
} = require('../scripts/aiops/analyzeDeploymentFailure');
const {
  createSyntheticSmokeDiagnostics,
  renderSmokeSummary,
  runLiveSmokeTest
} = require('../scripts/aiops/runLiveGeminiSmoke');

function evidenceIdsFor(diagnostics, fieldPaths) {
  const catalog = createEvidenceCatalog(sanitizeDiagnostics(diagnostics));
  return fieldPaths.map((fieldPath) => {
    const entry = catalog.find((item) => item.field === fieldPath);
    assert.ok(entry, `missing evidence catalog entry for ${fieldPath}`);
    return entry.id;
  });
}

function validFailureAnalysis(overrides = {}, diagnostics = createSyntheticSmokeDiagnostics()) {
  return {
    deploymentOutcome: 'FAILED',
    classification: 'ECS_ROLLOUT_FAILURE',
    riskLevel: 'HIGH',
    confidence: 0.94,
    supportedEvidence: evidenceIdsFor(diagnostics, [
      'failure.stage',
      'services.backend.deploymentStatus',
      'rollback.backend.result',
      'rollback.backend.postRollbackHealth'
    ]),
    operationalSummary: 'The synthetic backend deployment failed and rolled back safely.',
    likelyRootCause: 'The synthetic deployment circuit breaker was triggered.',
    recommendedNextAction: 'Have an operator review the bounded deployment diagnostics.',
    humanReviewRequired: true,
    ...overrides
  };
}

function clientReturningText(text, capture = null) {
  return {
    models: {
      async generateContent(request) {
        if (capture) {
          capture.push(request);
        }
        return { text };
      }
    }
  };
}

function clientReturningSequence(responses, capture = []) {
  let index = 0;
  return {
    models: {
      async generateContent(request) {
        capture.push(request);
        const response = responses[Math.min(index, responses.length - 1)];
        index += 1;
        return { text: JSON.stringify(response) };
      }
    }
  };
}

function apiError({ name = 'ApiError', status, code, message }) {
  const error = new Error(message);
  error.name = name;
  if (status !== undefined) {
    error.status = status;
  }
  if (code !== undefined) {
    error.code = code;
  }
  return error;
}

test('Gemini API errors are safely classified without retaining secret values', () => {
  const secret = 'unit-test-private-aiops-key';
  const bearer = 'not-a-real-bearer-token';
  const cases = [
    {
      error: apiError({
        status: 401,
        message: JSON.stringify({
          error: {
            code: 401,
            status: 'UNAUTHENTICATED',
            message: `API key ${secret} is invalid. Authorization: Bearer ${bearer}`
          }
        })
      }),
      category: FAILURE_CATEGORIES.auth,
      httpStatus: 401,
      providerCode: 'UNAUTHENTICATED'
    },
    {
      error: apiError({
        status: 429,
        message: JSON.stringify({
          error: { code: 429, status: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded.' }
        })
      }),
      category: FAILURE_CATEGORIES.rateLimit,
      httpStatus: 429,
      providerCode: 'TOO_MANY_REQUESTS'
    },
    {
      error: apiError({
        status: 429,
        message: JSON.stringify({
          error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Project quota exhausted.' }
        })
      }),
      category: FAILURE_CATEGORIES.quota,
      httpStatus: 429,
      providerCode: 'RESOURCE_EXHAUSTED'
    },
    {
      error: apiError({
        status: 404,
        message: JSON.stringify({
          error: { code: 404, status: 'NOT_FOUND', message: 'Requested model was not found.' }
        })
      }),
      category: FAILURE_CATEGORIES.model,
      httpStatus: 404,
      providerCode: 'NOT_FOUND'
    },
    {
      error: apiError({ name: 'TypeError', code: 'ENOTFOUND', message: 'fetch failed' }),
      category: FAILURE_CATEGORIES.network,
      httpStatus: null,
      providerCode: 'ENOTFOUND'
    },
    {
      error: apiError({ name: 'AbortError', code: 'ETIMEDOUT', message: 'Request timed out' }),
      category: FAILURE_CATEGORIES.timeout,
      httpStatus: null,
      providerCode: 'ETIMEDOUT'
    },
    {
      error: apiError({ status: 500, message: 'Provider internal error' }),
      category: FAILURE_CATEGORIES.api,
      httpStatus: 500,
      providerCode: null
    },
    {
      error: new Error('Unexpected SDK failure'),
      category: FAILURE_CATEGORIES.unknown,
      httpStatus: null,
      providerCode: null
    }
  ];

  for (const expected of cases) {
    const failure = classifyGeminiApiError(expected.error, { apiKey: secret });
    const serialized = JSON.stringify(failure);
    const logLine = formatFailureForLog(failure);

    assert.equal(failure.stage, FAILURE_STAGES.api);
    assert.equal(failure.category, expected.category);
    assert.equal(failure.httpStatus, expected.httpStatus);
    assert.equal(failure.providerCode, expected.providerCode);
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.doesNotMatch(serialized, new RegExp(bearer));
    assert.doesNotMatch(logLine, new RegExp(secret));
    assert.doesNotMatch(logLine, new RegExp(bearer));
    assert.ok(failure.message.length <= 320);
  }
});

test('API, parsing, schema, and evidence failures remain distinct fallback stages', async () => {
  const diagnostics = createSyntheticSmokeDiagnostics();
  const baseOptions = {
    apiKey: 'unit-test-key',
    model: 'unit-test-model'
  };
  const providerError = apiError({
    status: 503,
    message: JSON.stringify({
      error: { code: 503, status: 'UNAVAILABLE', message: 'Provider temporarily unavailable.' }
    })
  });
  const apiFailure = await analyzeDiagnostics(diagnostics, {
    ...baseOptions,
    clientFactory: () => ({
      models: {
        async generateContent() {
          throw providerError;
        }
      }
    })
  });
  const parseFailure = await analyzeDiagnostics(diagnostics, {
    ...baseOptions,
    clientFactory: () => clientReturningText('not valid JSON')
  });
  const schemaFailure = await analyzeDiagnostics(diagnostics, {
    ...baseOptions,
    clientFactory: () => clientReturningText(JSON.stringify({
      ...validFailureAnalysis(),
      executeCommand: 'never allowed'
    }))
  });
  const evidenceFailure = await analyzeDiagnostics(diagnostics, {
    ...baseOptions,
    clientFactory: () => clientReturningText(JSON.stringify(validFailureAnalysis({
      supportedEvidence: ['E999']
    })))
  });

  assert.deepEqual(
    [apiFailure.failure.stage, apiFailure.failure.category],
    [FAILURE_STAGES.api, FAILURE_CATEGORIES.api]
  );
  assert.deepEqual(
    [parseFailure.failure.stage, parseFailure.failure.category],
    [FAILURE_STAGES.parsing, FAILURE_CATEGORIES.responseParse]
  );
  assert.deepEqual(
    [schemaFailure.failure.stage, schemaFailure.failure.category],
    [FAILURE_STAGES.schema, FAILURE_CATEGORIES.schemaValidation]
  );
  assert.deepEqual(
    [evidenceFailure.failure.stage, evidenceFailure.failure.category],
    [FAILURE_STAGES.evidenceValidation, FAILURE_CATEGORIES.evidenceValidation]
  );

  for (const result of [apiFailure, parseFailure, schemaFailure, evidenceFailure]) {
    assert.equal(result.available, false);
    assert.equal(result.mode, 'FALLBACK');
    assert.equal(result.liveGeminiAttempted, true);
  }
});

test('valid allowlisted evidence IDs are accepted and enforced by the response schema', async () => {
  const diagnostics = createSyntheticSmokeDiagnostics();
  const capture = [];
  const expected = validFailureAnalysis({}, diagnostics);
  const result = await analyzeDiagnostics(diagnostics, {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningText(JSON.stringify(expected), capture)
  });
  const schemaIds = capture[0].config.responseSchema
    .properties.supportedEvidence.items.enum;
  const summary = renderSmokeSummary(result);

  assert.equal(result.available, true);
  assert.equal(result.mode, 'LIVE GEMINI');
  assert.deepEqual(result.analysis.supportedEvidence, expected.supportedEvidence);
  assert.equal(result.validation.geminiRequest, 'SUCCESS');
  assert.equal(result.validation.structuredResponse, 'PASS');
  assert.equal(result.validation.evidence, 'PASS');
  assert.equal(result.validation.correctiveRetryAttempted, false);
  assert.deepEqual(schemaIds, result.evidenceCatalog.map((entry) => entry.id));
  assert.ok(expected.supportedEvidence.every((evidenceId) => schemaIds.includes(evidenceId)));
  assert.match(summary, /Mode: \*\*LIVE GEMINI\*\*/);
  assert.match(summary, /Gemini request: \*\*SUCCESS\*\*/);
  assert.match(summary, /Structured validation: \*\*PASS\*\*/);
  assert.match(summary, /Evidence validation: \*\*PASS\*\*/);
  assert.match(summary, /\*\*Evidence used:\*\*/);
  assert.match(summary, /Human review required: \*\*YES\*\*/);
});

test('unknown evidence IDs remain rejected after one bounded correction attempt', async () => {
  const capture = [];
  const invalid = validFailureAnalysis({ supportedEvidence: ['E999'] });
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningSequence([invalid, invalid], capture)
  });

  assert.equal(capture.length, 2);
  assert.equal(result.available, false);
  assert.equal(result.mode, 'FALLBACK');
  assert.equal(result.failure.stage, FAILURE_STAGES.evidenceValidation);
  assert.equal(result.failure.category, FAILURE_CATEGORIES.evidenceValidation);
  assert.deepEqual(result.failure.unsupportedEvidenceIds, ['E999']);
  assert.equal(result.validation.evidence, 'FAIL');
  assert.equal(result.validation.correctiveRetryAttempted, true);
});

test('model-authored observation fields are rejected instead of becoming evidence', async () => {
  const inventedObservation = {
    ...validFailureAnalysis(),
    notableObservations: ['An unrecorded metric crossed a threshold.']
  };
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningText(JSON.stringify(inventedObservation))
  });

  assert.equal(result.available, false);
  assert.equal(result.mode, 'FALLBACK');
  assert.equal(result.failure.stage, FAILURE_STAGES.schema);
  assert.equal(result.failure.category, FAILURE_CATEGORIES.schemaValidation);
});

test('grounded inference is allowed only in analysis fields', async () => {
  const inference = validFailureAnalysis({
    operationalSummary: 'The selected evidence indicates a failed rollout followed by recovery.',
    likelyRootCause: 'The circuit breaker likely reacted to the failed rollout evidence.'
  });
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningText(JSON.stringify(inference))
  });

  assert.equal(result.available, true);
  assert.equal(result.analysis.operationalSummary, inference.operationalSummary);
  assert.equal(result.analysis.likelyRootCause, inference.likelyRootCause);
  assert.deepEqual(result.analysis.supportedEvidence, inference.supportedEvidence);
  assert.equal(Object.hasOwn(result.analysis, 'notableObservations'), false);
});

test('recommendations are advice and never become observed evidence', async () => {
  const recommendation = 'Have an operator inspect bounded startup diagnostics.';
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningText(JSON.stringify(validFailureAnalysis({
      recommendedNextAction: recommendation
    })))
  });
  const summary = renderSummary(result);
  const evidenceSection = summary.split('**Evidence used:**')[1]
    .split('**Recommended checks/actions:**')[0];

  assert.equal(result.available, true);
  assert.ok(result.analysis.supportedEvidence.every((item) => /^E\d+$/.test(item)));
  assert.doesNotMatch(evidenceSection, new RegExp(recommendation));
  assert.match(summary, new RegExp(recommendation));
});

test('one corrective evidence retry can recover to validated LIVE mode', async () => {
  const capture = [];
  const invalid = validFailureAnalysis({ supportedEvidence: ['E999'] });
  const valid = validFailureAnalysis();
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningSequence([invalid, valid], capture)
  });

  assert.equal(capture.length, 2);
  assert.equal(result.available, true);
  assert.equal(result.mode, 'LIVE GEMINI');
  assert.equal(result.validation.evidence, 'PASS');
  assert.equal(result.validation.correctiveRetryAttempted, true);
  assert.match(capture[1].contents, /CORRECTIVE RETRY/);
  assert.match(capture[1].contents, /E999/);
  assert.match(capture[1].contents, /using only IDs from the allowed supportedEvidence list/);
});

test('an invalid corrective response remains FALLBACK and can never report LIVE mode', async () => {
  const capture = [];
  const firstInvalid = validFailureAnalysis({ supportedEvidence: ['E999'] });
  const secondInvalid = validFailureAnalysis({ supportedEvidence: ['E998'] });
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: 'unit-test-key',
    model: 'unit-test-model',
    clientFactory: () => clientReturningSequence([firstInvalid, secondInvalid], capture)
  });

  assert.equal(capture.length, 2);
  assert.equal(result.available, false);
  assert.notEqual(result.mode, 'LIVE GEMINI');
  assert.equal(result.mode, 'FALLBACK');
  assert.deepEqual(result.failure.unsupportedEvidenceIds, ['E998']);
  assert.equal(result.validation.geminiRequest, 'SUCCESS');
  assert.equal(result.validation.structuredResponse, 'PASS');
  assert.equal(result.validation.evidence, 'FAIL');
});

test('fallback summary reports the safe live failure without exposing API credentials', async () => {
  const secret = 'summary-only-private-key';
  const result = await analyzeDiagnostics(createSyntheticSmokeDiagnostics(), {
    apiKey: secret,
    model: DEFAULT_AIOPS_GEMINI_MODEL,
    clientFactory: () => ({
      models: {
        async generateContent() {
          throw apiError({
            status: 403,
            message: JSON.stringify({
              error: {
                code: 403,
                status: 'PERMISSION_DENIED',
                message: `Credential ${secret} does not have access.`
              }
            })
          });
        }
      }
    })
  });
  const summary = renderSummary(result);
  const smokeSummary = renderSmokeSummary(result);
  const serialized = JSON.stringify(result);

  assert.match(summary, /Mode: \*\*FALLBACK\*\*/);
  assert.match(summary, /Live Gemini attempted: \*\*YES\*\*/);
  assert.match(summary, /Failure stage: \*\*API\*\*/);
  assert.match(summary, /Safe failure category: \*\*GEMINI\\_AUTH\\_ERROR\*\*/);
  assert.match(summary, /HTTP status: \*\*403\*\*/);
  assert.match(summary, /Provider error code: \*\*PERMISSION\\_DENIED\*\*/);
  assert.doesNotMatch(summary, new RegExp(secret));
  assert.doesNotMatch(smokeSummary, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(secret));
});

test('missing live credential is reported as not attempted rather than a false LIVE result', async () => {
  const result = await runLiveSmokeTest({
    apiKey: '',
    model: DEFAULT_AIOPS_GEMINI_MODEL
  });
  const summary = renderSmokeSummary(result);

  assert.equal(result.available, false);
  assert.equal(result.mode, 'FALLBACK');
  assert.equal(result.liveGeminiAttempted, false);
  assert.equal(result.failure.stage, FAILURE_STAGES.api);
  assert.equal(result.failure.category, FAILURE_CATEGORIES.auth);
  assert.match(summary, /Live Gemini attempted: \*\*NO\*\*/);
});

test('dedicated LIVE smoke workflow is manual, unmocked, and has no AWS or OIDC authority', () => {
  const root = path.join(__dirname, '..');
  const workflow = fs.readFileSync(
    path.join(root, '.github', 'workflows', 'aiops-live-smoke.yml'),
    'utf8'
  );
  const smokeScript = fs.readFileSync(
    path.join(root, 'scripts', 'aiops', 'runLiveGeminiSmoke.js'),
    'utf8'
  );

  assert.match(workflow, /^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule):/m);
  assert.match(workflow, /^permissions:\s*\n\s+contents: read\s*$/m);
  assert.match(workflow, /secrets\.AIOPS_GEMINI_API_KEY/);
  assert.match(workflow, /vars\.AIOPS_GEMINI_MODEL/);
  assert.match(workflow, /npm run aiops:smoke:live/);
  assert.doesNotMatch(workflow, /id-token:\s*write/);
  assert.doesNotMatch(workflow, /configure-aws-credentials/);
  assert.doesNotMatch(workflow, /\baws\s+(?:ecs|ecr|sts)\b/);
  assert.doesNotMatch(workflow, /ansible-playbook|docker\s+(?:build|push|run)/);
  assert.match(smokeScript, /analyzeDiagnostics\(createSyntheticSmokeDiagnostics\(\)/);
  assert.doesNotMatch(smokeScript, /clientFactory|createMock|MOCK_/);
  assert.doesNotMatch(smokeScript, /@aws-sdk|\baws\s+(?:ecs|ecr|sts)\b/);
});
