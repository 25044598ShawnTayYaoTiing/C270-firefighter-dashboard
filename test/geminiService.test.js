const test = require('node:test');
const assert = require('node:assert/strict');
const geminiService = require('../services/geminiService');
const aiController = require('../controllers/aiController');

const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ORIGINAL_GEMINI_MODEL = process.env.GEMINI_MODEL;
const REPORT_FIELDS = [
  'incident_type',
  'location',
  'incident_datetime',
  'incident_summary',
  'hazards',
  'injured_or_trapped_persons',
  'response_status',
  'missing_information',
  'officer_notes'
];

function setGeminiEnv(apiKey, model) {
  if (apiKey === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = apiKey;
  }

  if (model === undefined) {
    delete process.env.GEMINI_MODEL;
  } else {
    process.env.GEMINI_MODEL = model;
  }
}

function restoreGeminiEnv() {
  setGeminiEnv(ORIGINAL_GEMINI_API_KEY, ORIGINAL_GEMINI_MODEL);
  geminiService._private.resetClientFactory();
}

function responseText(text) {
  return {
    text() {
      return text;
    }
  };
}

function responseForReport(overrides = {}) {
  return responseText(`json\n${JSON.stringify({
    incident_type: 'Residential Fire',
    location: 'Block 10, Example Street, unit 04-05',
    incident_datetime: '',
    incident_summary: 'Smoke reported from a flat.',
    hazards: 'Smoke',
    injured_or_trapped_persons: 'None stated',
    response_status: 'Pending Review',
    missing_information: '',
    officer_notes: '',
    ...overrides
  })}`);
}

test.afterEach(restoreGeminiEnv);

test('Gemini health check reports configuration without calling the model', async () => {
  let clientCreated = false;
  geminiService._private.setClientFactory(() => {
    clientCreated = true;
    return {};
  });

  setGeminiEnv(undefined, undefined);
  const missingHealth = await geminiService.checkHealth();
  assert.equal(missingHealth.available, false);
  assert.equal(clientCreated, false);

  setGeminiEnv('test-api-key', 'gemini-3.5-flash');
  const configuredHealth = await geminiService.checkHealth();
  assert.equal(configuredHealth.available, true);
  assert.equal(configuredHealth.provider, 'Gemini AI');
  assert.equal(configuredHealth.model, 'gemini-3.5-flash');
  assert.equal(clientCreated, false);
});

test('cleanTranscript calls Gemini Flash and returns cleaned text only', async () => {
  let requestBody;
  setGeminiEnv('test-api-key', 'gemini-3.5-flash');
  geminiService._private.setClientFactory(() => ({
    models: {
      generateContent: async (request) => {
        requestBody = request;
        return {
          text: 'Kitchen fire reported at Block 123.'
        };
      }
    }
  }));

  const cleanedTranscript = await geminiService.cleanTranscript('kitchen fire block 123');

  assert.equal(cleanedTranscript, 'Kitchen fire reported at Block 123.');
  assert.equal(requestBody.model, 'gemini-3.5-flash');
  assert.match(requestBody.contents, /Clean this transcript/);
  assert.equal(requestBody.config.temperature, 0.1);
  assert.match(requestBody.config.systemInstruction, /Do not invent/);
});

test('generateReport parses and normalizes all expected report fields', async () => {
  let requestBody;
  setGeminiEnv('test-api-key', 'gemini-3.5-flash');
  geminiService._private.setClientFactory(() => ({
    models: {
      generateContent: async (request) => {
        requestBody = request;
        return {
          text: JSON.stringify({
            incident_type: 'Fire',
            location: 'Yishun Avenue 5',
            incident_summary: 'Caller reported smoke from a kitchen.',
            response_status: 'Pending Review'
          })
        };
      }
    }
  }));

  const report = await geminiService.generateReport('Smoke from kitchen at Yishun Avenue 5.');

  REPORT_FIELDS.forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(report, field), `${field} is present`);
  });
  assert.equal(report.incident_type, 'Fire');
  assert.equal(report.location, 'Yishun Avenue 5');
  assert.equal(report.incident_datetime, '');
  assert.equal(report.hazards, '');
  assert.equal(report.response_status, 'Pending Review');
  assert.equal(requestBody.config.responseMimeType, 'application/json');
  assert.deepEqual(requestBody.config.responseSchema.required, REPORT_FIELDS);
});

test('clean transcript controller returns original transcript when Gemini fails', async () => {
  const originalClean = geminiService.cleanTranscript;
  let responseBody;
  geminiService.cleanTranscript = async () => {
    throw new Error('service unavailable');
  };

  try {
    await aiController.cleanTranscript({ body: { transcript: 'raw emergency transcript' } }, {
      json(value) {
        responseBody = value;
        return this;
      }
    });

    assert.equal(responseBody.success, false);
    assert.equal(responseBody.cleanedTranscript, 'raw emergency transcript');
  } finally {
    geminiService.cleanTranscript = originalClean;
  }
});

test('generate report controller returns editable fallback report when Gemini fails', async () => {
  const originalGenerate = geminiService.generateReport;
  let responseBody;
  geminiService.generateReport = async () => {
    throw new Error('service unavailable');
  };

  try {
    await aiController.generateReport({ body: { transcript: 'raw emergency transcript' } }, {
      json(value) {
        responseBody = value;
        return this;
      }
    });

    assert.equal(responseBody.success, false);
    assert.equal(responseBody.fallback, true);
    REPORT_FIELDS.forEach((field) => {
      assert.ok(Object.prototype.hasOwnProperty.call(responseBody.report, field), `${field} is present`);
    });
    assert.equal(responseBody.report.response_status, 'Pending Review');
    assert.match(responseBody.report.missing_information, /service was unavailable/i);
  } finally {
    geminiService.generateReport = originalGenerate;
  }
});

test('Gemini retries transient cleanup failures at most three times', { concurrency: false }, async () => {
  let attempts = 0;
  let clientOptions;

  setGeminiEnv('test-key', 'gemini-3.5-flash');
  geminiService._private.setRetryDelays([0, 0]);
  geminiService._private.setClientFactory((apiKey, options) => {
    clientOptions = options;
    return {
      models: {
        async generateContent() {
          attempts += 1;
          if (attempts < 3) throw Object.assign(new Error('ServiceUnavailable'), { status: 503 });
          return responseText('Punctuation restored without changing incident facts.');
        }
      }
    };
  });

  const result = await geminiService.cleanTranscript('smoke at block 10 unit 04-05');

  assert.equal(result, 'Punctuation restored without changing incident facts.');
  assert.equal(attempts, 3);
  assert.equal(clientOptions.httpOptions.retryOptions.attempts, 1);
  assert.ok(clientOptions.httpOptions.timeout >= 1000);
});

test('Gemini does not retry permanent request failures', { concurrency: false }, async () => {
  let attempts = 0;

  setGeminiEnv('test-key', 'gemini-3.5-flash');
  geminiService._private.setRetryDelays([0, 0]);
  geminiService._private.setClientFactory(() => ({
    models: {
      async generateContent() {
        attempts += 1;
        throw Object.assign(new Error('Bad request'), { status: 400 });
      }
    }
  }));

  await assert.rejects(
    geminiService.cleanTranscript('test transcript'),
    (error) => error.name === 'GeminiServiceError' && error.status === 400 && !error.retryable
  );
  assert.equal(attempts, 1);
});

test('Gemini report parsing accepts unfenced JSON and normalizes fields', { concurrency: false }, async () => {
  setGeminiEnv('test-key', 'gemini-3.5-flash');
  geminiService._private.setClientFactory(() => ({
    models: {
      async generateContent() {
        return responseForReport({ officer_notes: 'Confirm access route.' });
      }
    }
  }));

  const report = await geminiService.generateReport('Fire reported at Block 10, unit 04-05.');

  assert.equal(report.incident_type, 'Residential Fire');
  assert.equal(report.location, 'Block 10, Example Street, unit 04-05');
  assert.equal(report.officer_notes, 'Confirm access route.');
  assert.equal(report.incident_datetime, '');
});

test('Gemini report parsing returns a safe error for malformed JSON', { concurrency: false }, async () => {
  setGeminiEnv('test-key', 'gemini-3.5-flash');
  geminiService._private.setClientFactory(() => ({
    models: {
      async generateContent() {
        return responseText('```json\nnot valid json\n```');
      }
    }
  }));

  await assert.rejects(
    geminiService.generateReport('Smoke reported at an unknown location.'),
    (error) => error.name === 'GeminiServiceError' && error.operation === 'report drafting'
  );
});

test('AI controller returns a transient error and manual fallback without saving a report', { concurrency: false }, async () => {
  const originalGenerate = geminiService.generateReport;
  let responseBody;
  let responseStatus;

  geminiService.generateReport = async () => {
    throw Object.assign(new Error('temporary'), { retryable: true, status: 503 });
  };

  try {
    await aiController.generateReport(
      { body: { transcript: 'Smoke reported at Block 10.' } },
      {
        status(value) {
          responseStatus = value;
          return this;
        },
        json(value) {
          responseBody = value;
          return this;
        }
      }
    );
  } finally {
    geminiService.generateReport = originalGenerate;
  }

  assert.equal(responseStatus, 503);
  assert.equal(responseBody.success, false);
  assert.equal(responseBody.fallback, true);
  assert.match(responseBody.error, /temporarily busy/i);
  assert.equal(responseBody.report.response_status, 'Pending Review');
});

test('AI controller rejects an empty transcript before calling Gemini', { concurrency: false }, async () => {
  let responseStatus;
  let responseBody;

  await aiController.cleanTranscript(
    { body: { transcript: '   ' } },
    {
      status(value) {
        responseStatus = value;
        return this;
      },
      json(value) {
        responseBody = value;
        return this;
      }
    }
  );

  assert.equal(responseStatus, 400);
  assert.equal(responseBody.success, false);
  assert.equal(responseBody.error, 'Transcript is required.');
});
