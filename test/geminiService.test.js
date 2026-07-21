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
