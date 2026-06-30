require('dotenv').config();

const OLLAMA_HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:1.5b';

async function requestWithTimeout(url, options = {}, timeoutMs = 1500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function callOllama(messages, timeoutMs = 30000) {
  // The backend is the only place that talks to Ollama; browser code calls Express.
  const response = await requestWithTimeout(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages,
      options: {
        temperature: 0.1
      }
    })
  }, timeoutMs);

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  const content = data && data.message && data.message.content;

  if (!content) {
    throw new Error('Ollama returned an empty response.');
  }

  return content.trim();
}

async function checkHealth() {
  try {
    const response = await requestWithTimeout(`${OLLAMA_HOST}/api/tags`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    return {
      available: response.ok
    };
  } catch (error) {
    return {
      available: false
    };
  }
}

function stripMarkdownFence(value) {
  return value
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
}

function parseJsonObject(value) {
  const unfenced = stripMarkdownFence(value);
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Ollama did not return a JSON object.');
  }

  return JSON.parse(unfenced.slice(start, end + 1));
}

function normalizeReport(report) {
  const fields = [
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

  return fields.reduce((normalized, field) => {
    const value = report[field];
    normalized[field] = typeof value === 'string' ? value.trim() : value ? String(value) : '';
    return normalized;
  }, {
    response_status: 'Pending Review'
  });
}

function normalizeLocationExtraction(value) {
  const confidence = ['Low', 'Medium', 'High'].includes(value.confidence)
    ? value.confidence
    : 'Low';

  return {
    cleaned_location: typeof value.cleaned_location === 'string' ? value.cleaned_location.trim() : '',
    detected_area: typeof value.detected_area === 'string' ? value.detected_area.trim() : '',
    block_number: typeof value.block_number === 'string' ? value.block_number.trim() : '',
    street_name: typeof value.street_name === 'string' ? value.street_name.trim() : '',
    unit_number: typeof value.unit_number === 'string' ? value.unit_number.trim() : '',
    confidence,
    missing_location_details: typeof value.missing_location_details === 'string'
      ? value.missing_location_details.trim()
      : ''
  };
}

exports.cleanTranscript = async (transcript) => {
  return callOllama([
    {
      role: 'system',
      content: [
        'You clean emergency call transcripts for firefighter incident reporting.',
        'Correct spelling mistakes and improve punctuation/readability.',
        'Keep the meaning exactly the same.',
        'Do not invent any new location, injury, hazard, incident, time, urgency, or person details.',
        'If a phrase is unclear, keep it and mark it as [unclear: original phrase].',
        'Return only the cleaned transcript text.'
      ].join(' ')
    },
    {
      role: 'user',
      content: `Clean this transcript:\n\n${transcript}`
    }
  ]);
};

exports.generateReport = async (transcript) => {
  const response = await callOllama([
    {
      role: 'system',
      content: [
        'You generate concise firefighter incident report drafts from transcripts.',
        'Use only details found in the transcript.',
        'Do not invent missing details.',
        'Put unclear or missing details into missing_information.',
        'Default response_status to "Pending Review".',
        'Return valid JSON only, with no markdown.',
        'incident_datetime must be YYYY-MM-DDTHH:mm when known, otherwise an empty string.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        'Create JSON with exactly these keys:',
        'incident_type, location, incident_datetime, incident_summary, hazards, injured_or_trapped_persons, response_status, missing_information, officer_notes.',
        '',
        'Transcript:',
        transcript
      ].join('\n')
    }
  ]);

  return normalizeReport(parseJsonObject(response));
};

exports.extractIncidentLocation = async ({ location, summary, transcript }, timeoutMs = 8000) => {
  const response = await callOllama([
    {
      role: 'system',
      content: [
        'You extract and normalize Singapore incident location text for a firefighter dashboard.',
        'Use only details found in the provided location, summary, or transcript.',
        'Do not invent block numbers, street names, unit numbers, landmarks, areas, latitude, or longitude.',
        'Never return coordinates.',
        'If only a general area is found, return that area in detected_area.',
        'If the location is unclear, set confidence to Low.',
        'Return valid JSON only, with no markdown.'
      ].join(' ')
    },
    {
      role: 'user',
      content: [
        'Return JSON with exactly these keys:',
        'cleaned_location, detected_area, block_number, street_name, unit_number, confidence, missing_location_details.',
        'confidence must be Low, Medium, or High.',
        '',
        `Location field: ${location || ''}`,
        `Report summary: ${summary || ''}`,
        `Transcript: ${transcript || ''}`
      ].join('\n')
    }
  ], timeoutMs);

  return normalizeLocationExtraction(parseJsonObject(response));
};

exports.getConfig = () => ({
  host: OLLAMA_HOST,
  model: OLLAMA_MODEL
});

exports.checkHealth = checkHealth;
