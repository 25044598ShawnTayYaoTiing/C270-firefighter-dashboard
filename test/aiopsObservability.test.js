'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_AIOPS_GEMINI_MODEL,
  FAILURE_CATEGORIES,
  FAILURE_STAGES,
  analyzeDiagnostics,
  classifyGeminiApiError,
  formatFailureForLog,
  renderSummary
} = require('../scripts/aiops/analyzeDeploymentFailure');
const {
  createSyntheticSmokeDiagnostics,
  renderSmokeSummary,
  runLiveSmokeTest
} = require('../scripts/aiops/runLiveGeminiSmoke');

function validFailureAnalysis(overrides = {}) {
  return {
    deploymentOutcome: 'FAILED',
    classification: 'ECS_ROLLOUT_FAILURE',
    riskLevel: 'HIGH',
    confidence: 0.94,
    evidence: [
      'failure.stage',
      'services.backend.status',
      'rollback.backend.result',
      'rollback.backend.postRollbackHealth'
    ],
    operationalSummary: 'The synthetic backend deployment failed and rolled back safely.',
    likelyRootCause: 'The synthetic deployment circuit breaker was triggered.',
    notableObservations: ['The frontend deployment did not start.'],
    recommendedNextAction: 'Have an operator review the bounded deployment diagnostics.',
    humanReviewRequired: true,
    ...overrides
  };
}

function clientReturningText(text) {
  return {
    models: {
      async generateContent() {
        return { text };
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
      evidence: ['services.backend.unavailableRawSecret']
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
