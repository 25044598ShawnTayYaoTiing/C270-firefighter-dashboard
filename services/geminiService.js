require('dotenv').config({ quiet: true });

const { GoogleGenAI, Type } = require('@google/genai');

// AI Features: Gemini Flash service configuration for transcript cleanup and incident draft generation.
const PROVIDER_NAME = 'Gemini AI';
const MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_DELAYS_MS = [1000, 2500];
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
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

const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: REPORT_FIELDS.reduce((properties, field) => {
    properties[field] = {
      type: Type.STRING
    };
    return properties;
  }, {}),
  required: REPORT_FIELDS,
  propertyOrdering: REPORT_FIELDS
};

const CLEAN_TRANSCRIPT_SYSTEM_INSTRUCTION = [
  'You clean emergency call transcripts for firefighter incident reporting.',
  'Correct spelling mistakes and improve punctuation/readability.',
  'Keep the meaning exactly the same.',
  'Do not invent any new location, injury, hazard, incident, time, urgency, or person details.',
  'If a phrase is unclear, keep it and mark it as [unclear: original phrase].',
  'Return only the cleaned transcript text.'
].join(' ');

const REPORT_SYSTEM_INSTRUCTION = [
  'You generate concise firefighter incident report drafts from transcripts.',
  'Use only details found in the transcript.',
  'Do not invent missing details.',
  'Put unclear or missing details into missing_information.',
  'Default response_status to "Pending Review".',
  'Return valid JSON only, with no markdown.',
  'incident_datetime must be YYYY-MM-DDTHH:mm when known, otherwise an empty string.'
].join(' ');

let clientFactory = (apiKey) => new GoogleGenAI({ apiKey });
let cachedApiKey = '';
let cachedClient = null;
let retryDelaysMs = DEFAULT_RETRY_DELAYS_MS.slice();
let lastRequest = {
  operation: '',
  status: 'not_started',
  httpStatus: null,
  at: null
};

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function getModel() {
  return String(process.env.GEMINI_MODEL || '').trim();
}

function getTimeoutMs() {
  const configured = Number.parseInt(process.env.GEMINI_TIMEOUT_MS || '', 10);
  return Number.isFinite(configured) && configured >= 1000 ? configured : DEFAULT_TIMEOUT_MS;
}

function assertConfigured() {
  if (!getApiKey()) {
    throw new Error('Gemini AI is not configured.');
  }

  if (!getModel()) {
    throw new Error('Gemini model is not configured.');
  }
}

function getClient() {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('Gemini AI is not configured.');
  }

  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedApiKey = apiKey;
    cachedClient = clientFactory(apiKey, {
      httpOptions: {
        timeout: getTimeoutMs(),
        // The service owns retry behavior so each request has at most three attempts.
        retryOptions: { attempts: 1 }
      }
    });
  }

  return cachedClient;
}

function extractResponseText(response) {
  if (typeof response.text === 'function') {
    return String(response.text() || '').trim();
  }

  if (typeof response.text === 'string') {
    return response.text.trim();
  }

  const parts = response.candidates
    && response.candidates[0]
    && response.candidates[0].content
    && response.candidates[0].content.parts;

  if (Array.isArray(parts)) {
    return parts
      .map((part) => part && part.text)
      .filter(Boolean)
      .join('')
      .trim();
  }

  return '';
}

function getHttpStatus(error) {
  const status = error && (error.status || error.statusCode || (error.response && error.response.status));
  const numericStatus = Number(status);
  return Number.isInteger(numericStatus) && numericStatus > 0 ? numericStatus : null;
}

function isNetworkError(error) {
  const code = String(error && error.code || '').toUpperCase();
  const message = String(error && error.message || '').toLowerCase();

  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED', 'ENOTFOUND'].includes(code)
    || message.includes('fetch failed')
    || message.includes('network')
    || message.includes('timed out')
    || message.includes('timeout');
}

function isRetryableError(error, status) {
  return RETRYABLE_STATUS_CODES.has(status) || (!status && isNetworkError(error));
}

function buildGeminiError(error, operation, status, retryable) {
  if (error && error.name === 'GeminiServiceError') return error;

  const wrapped = new Error(`Gemini ${operation} failed.`);
  wrapped.name = 'GeminiServiceError';
  wrapped.operation = operation;
  wrapped.status = status;
  wrapped.retryable = retryable;
  wrapped.cause = error;
  return wrapped;
}

function recordRequest(operation, status, httpStatus = null) {
  lastRequest = {
    operation,
    status,
    httpStatus,
    at: new Date().toISOString()
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function callGemini(contents, config, operation) {
  assertConfigured();

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await getClient().models.generateContent({
        model: getModel(),
        contents,
        config
      });
      const text = extractResponseText(response);

      if (!text) {
        const emptyResponseError = new Error('Gemini returned an empty response.');
        emptyResponseError.code = 'EMPTY_RESPONSE';
        throw emptyResponseError;
      }

      recordRequest(operation, 'success');
      return text;
    } catch (error) {
      const status = getHttpStatus(error);
      const retryable = isRetryableError(error, status) || error.code === 'EMPTY_RESPONSE';
      lastError = buildGeminiError(error, operation, status, retryable);

      if (!retryable || attempt === MAX_ATTEMPTS) {
        recordRequest(operation, 'failed', status);
        console.error('[Gemini] request failed', {
          operation,
          status,
          attempt,
          maxAttempts: MAX_ATTEMPTS
        });
        throw lastError;
      }

      recordRequest(operation, 'retrying', status);
      console.warn('[Gemini] transient request failure; retrying', {
        operation,
        status,
        attempt,
        maxAttempts: MAX_ATTEMPTS
      });
      await wait(retryDelaysMs[attempt - 1] || retryDelaysMs[retryDelaysMs.length - 1] || 0);
    }
  }

  throw lastError;
}

function stripMarkdownFence(value) {
  return String(value || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseJsonObject(value) {
  const unfenced = stripMarkdownFence(value).replace(/^\s*json\s*/i, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini did not return a JSON object.');
  }

  const parsed = JSON.parse(unfenced.slice(start, end + 1));

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini did not return a JSON object.');
  }

  return parsed;
}

function normalizeReport(report) {
  return REPORT_FIELDS.reduce((normalized, field) => {
    const value = report && report[field];
    if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`Gemini returned an invalid value for ${field}.`);
    }

    const fallback = field === 'response_status' ? 'Pending Review' : '';
    normalized[field] = typeof value === 'string' ? value.trim() : value === undefined || value === null ? fallback : String(value);
    return normalized;
  }, {
    response_status: 'Pending Review'
  });
}

// AI Features: asks Gemini Flash to clean transcript text without inventing incident details.
exports.cleanTranscript = async (transcript) => {
  return callGemini(
    `Clean this transcript:\n\n${transcript}`,
    {
      systemInstruction: CLEAN_TRANSCRIPT_SYSTEM_INSTRUCTION,
      temperature: 0.1
    },
    'transcript cleanup'
  );
};

// AI Features: asks Gemini Flash to produce an editable incident report draft from a transcript.
exports.generateReport = async (transcript) => {
  const response = await callGemini(
    [
      'Create JSON with exactly these keys:',
      REPORT_FIELDS.join(', '),
      '',
      'Transcript:',
      transcript
    ].join('\n'),
    {
      systemInstruction: REPORT_SYSTEM_INSTRUCTION,
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: REPORT_SCHEMA
    },
    'report drafting'
  );

  try {
    return normalizeReport(parseJsonObject(response));
  } catch (error) {
    recordRequest('report drafting', 'invalid_response');
    console.error('[Gemini] report response parsing failed', {
      operation: 'report drafting'
    });
    throw buildGeminiError(error, 'report drafting', null, false);
  }
};

// AI Features: exposes non-secret Gemini configuration used by the active AI backend flow.
exports.getConfig = () => ({
  provider: PROVIDER_NAME,
  model: getModel(),
  apiKeyConfigured: Boolean(getApiKey()),
  modelConfigured: Boolean(getModel())
});

// AI Features: lightweight configuration health for the active AI provider. No model call is made here.
exports.checkHealth = async () => {
  const config = exports.getConfig();

  return {
    available: config.apiKeyConfigured && config.modelConfigured,
    configured: config.apiKeyConfigured && config.modelConfigured,
    provider: config.provider,
    model: config.model,
    lastRequest
  };
};

exports._private = {
  parseJsonObject,
  normalizeReport,
  setClientFactory(factory) {
    clientFactory = factory;
    cachedApiKey = '';
    cachedClient = null;
  },
  setRetryDelays(delays) {
    retryDelaysMs = Array.isArray(delays) ? delays.map((delay) => Math.max(0, Number(delay) || 0)) : DEFAULT_RETRY_DELAYS_MS.slice();
  },
  resetClientFactory() {
    clientFactory = (apiKey) => new GoogleGenAI({ apiKey });
    cachedApiKey = '';
    cachedClient = null;
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS.slice();
  }
};
