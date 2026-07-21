require('dotenv').config({ quiet: true });

const { GoogleGenAI, Type } = require('@google/genai');

// AI Features: Gemini Flash service configuration for transcript cleanup and incident draft generation.
const PROVIDER_NAME = 'Gemini AI';
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

function getApiKey() {
  return String(process.env.GEMINI_API_KEY || '').trim();
}

function getModel() {
  return String(process.env.GEMINI_MODEL || '').trim();
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
    cachedClient = clientFactory(apiKey);
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

async function callGemini(contents, config) {
  assertConfigured();

  const response = await getClient().models.generateContent({
    model: getModel(),
    contents,
    config
  });
  const text = extractResponseText(response);

  if (!text) {
    throw new Error('Gemini returned an empty response.');
  }

  return text;
}

function stripMarkdownFence(value) {
  return String(value || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseJsonObject(value) {
  const unfenced = stripMarkdownFence(value);
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini did not return a JSON object.');
  }

  return JSON.parse(unfenced.slice(start, end + 1));
}

function normalizeReport(report) {
  return REPORT_FIELDS.reduce((normalized, field) => {
    const value = report && report[field];
    normalized[field] = typeof value === 'string' ? value.trim() : value ? String(value) : '';
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
    }
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
    }
  );

  return normalizeReport(parseJsonObject(response));
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
    model: config.model
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
  resetClientFactory() {
    clientFactory = (apiKey) => new GoogleGenAI({ apiKey });
    cachedApiKey = '';
    cachedClient = null;
  }
};
