const ollamaService = require('../services/ollamaService');

const REQUIRED_FIELDS = [
  { key: 'location', label: 'Incident Location' },
  { key: 'type', label: 'Incident Type' },
  { key: 'dateTime', label: 'Date and Time' },
  { key: 'summary', label: 'Incident Summary' },
  { key: 'status', label: 'Response Status' },
  { key: 'hazards', label: 'Hazards' },
  { key: 'injured', label: 'Injured or Trapped Persons' }
];

const SINGAPORE_BOUNDS = {
  minLat: 1.15,
  maxLat: 1.50,
  minLng: 103.55,
  maxLng: 104.15
};

const AI_LOCATION_TIMEOUT_MS = 2000;
const MAX_AI_LOCATION_LOOKUPS = 3;

const LOCATION_COORDINATES = [
  { match: 'jurong west', label: 'Jurong West', lat: 1.3404, lng: 103.7090 },
  { match: 'bedok', label: 'Bedok', lat: 1.3236, lng: 103.9273 },
  { match: 'tampines', label: 'Tampines', lat: 1.3496, lng: 103.9568 },
  { match: 'woodlands', label: 'Woodlands', lat: 1.4360, lng: 103.7860 },
  { match: 'yishun', label: 'Yishun', lat: 1.4294, lng: 103.8354 },
  { match: 'ang mo kio', label: 'Ang Mo Kio', lat: 1.3691, lng: 103.8454 },
  { match: 'toa payoh', label: 'Toa Payoh', lat: 1.3343, lng: 103.8563 },
  { match: 'bukit batok', label: 'Bukit Batok', lat: 1.3496, lng: 103.7499 },
  { match: 'hougang', label: 'Hougang', lat: 1.3612, lng: 103.8863 },
  { match: 'clementi', label: 'Clementi', lat: 1.3162, lng: 103.7649 }
];

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function formatDateTime(value) {
  if (!value) return 'Not recorded';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date).replace(',', ',');
}

function toDateInput(value) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (part) => String(part).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function calculateCompletion(values) {
  const missingFields = REQUIRED_FIELDS
    .filter((field) => !hasValue(values[field.key]))
    .map((field) => field.label);
  const filledCount = REQUIRED_FIELDS.length - missingFields.length;
  const percent = Math.round((filledCount / REQUIRED_FIELDS.length) * 100);

  return {
    percent,
    missingFields,
    message: percent === 100
      ? 'Required fields complete.'
      : percent < 70
        ? 'Critical details still missing.'
        : 'Only a few details remain.'
  };
}

function toNullableNumber(value) {
  if (!hasValue(value)) return null;

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isSingaporeCoordinate(latitude, longitude) {
  return latitude >= SINGAPORE_BOUNDS.minLat
    && latitude <= SINGAPORE_BOUNDS.maxLat
    && longitude >= SINGAPORE_BOUNDS.minLng
    && longitude <= SINGAPORE_BOUNDS.maxLng;
}

function mapIncident(row) {
  const incidentId = row.incident_id || '';
  const incidentType = row.incident_type || 'Unspecified';
  const responseStatus = row.response_status || 'Draft';
  const completion = calculateCompletion({
    location: row.location,
    type: incidentType,
    dateTime: row.incident_datetime,
    summary: row.incident_summary,
    status: responseStatus,
    hazards: row.hazards,
    injured: row.injured_or_trapped_persons
  });

  return {
    id: incidentId,
    incident_id: incidentId,
    type: incidentType,
    incident_type: incidentType,
    location: row.location || '',
    status: responseStatus,
    response_status: responseStatus,
    createdDate: formatDateTime(row.incident_datetime),
    lastUpdated: formatDateTime(row.updated_at || row.created_at),
    incidentDate: row.incident_datetime ? new Date(row.incident_datetime) : null,
    updatedDate: row.updated_at ? new Date(row.updated_at) : null,
    dateInput: toDateInput(row.incident_datetime),
    responseTime: 'Not recorded',
    summary: row.incident_summary || '',
    hazards: row.hazards || 'None.',
    injured: row.injured_or_trapped_persons || 'No injured or trapped persons reported.',
    missingInfo: row.missing_information || 'None.',
    officerNotes: row.officer_notes || 'None.',
    transcript: row.transcript || 'No transcript provided.',
    latitude: toNullableNumber(row.latitude),
    longitude: toNullableNumber(row.longitude),
    completion
  };
}

function getTranscriptText(report) {
  return report.transcript === 'No transcript provided.'
    ? ''
    : report.transcript || '';
}

function findAreaMatch(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return null;

  return LOCATION_COORDINATES.find((area) => text.includes(area.match)) || null;
}

function getReportLocationText(report) {
  return [
    report.location,
    report.summary,
    getTranscriptText(report)
  ].filter(Boolean).join(' ').toLowerCase();
}

function areaAppearsInReport(report, areaLabel) {
  const area = LOCATION_COORDINATES.find((item) => item.label === areaLabel);

  return area
    ? getReportLocationText(report).includes(area.match)
    : false;
}

function getDatabaseCoordinates(report) {
  const latitude = toNullableNumber(report.latitude);
  const longitude = toNullableNumber(report.longitude);

  if (latitude === null || longitude === null) return null;

  if (!isSingaporeCoordinate(latitude, longitude)) {
    return {
      invalidReason: 'Stored coordinates are outside supported Singapore map bounds.'
    };
  }

  return {
    lat: latitude,
    lng: longitude,
    source: 'database'
  };
}

function getAreaCoordinates(value, source) {
  const match = findAreaMatch(value);

  return match
    ? {
        lat: match.lat,
        lng: match.lng,
        area: match.label,
        source
      }
    : null;
}

function getMapIncidentSnapshot(report) {
  return {
    id: report.id,
    incident_id: report.incident_id || report.id,
    incident_type: report.incident_type || report.type,
    location: report.location || '',
    response_status: report.response_status || report.status,
    transcript: getTranscriptText(report),
    latitude: toNullableNumber(report.latitude),
    longitude: toNullableNumber(report.longitude)
  };
}

async function getAiLocation(report, aiBudget) {
  if (!aiBudget.enabled || aiBudget.remaining <= 0) return null;

  aiBudget.remaining -= 1;

  try {
    return await ollamaService.extractIncidentLocation({
      location: report.location,
      summary: report.summary,
      transcript: getTranscriptText(report)
    }, AI_LOCATION_TIMEOUT_MS);
  } catch (error) {
    return null;
  }
}

async function resolveIncidentLocation(report, aiBudget) {
  const databaseCoordinates = getDatabaseCoordinates(report);
  const invalidDatabaseReason = databaseCoordinates && databaseCoordinates.invalidReason;

  if (databaseCoordinates && !invalidDatabaseReason) {
    return {
      mapped: true,
      coordinates: databaseCoordinates,
      cleanedLocation: report.location,
      aiLocation: null
    };
  }

  const locationCoordinates = getAreaCoordinates(report.location, 'location-keyword');
  if (locationCoordinates) {
    return {
      mapped: true,
      coordinates: locationCoordinates,
      cleanedLocation: report.location,
      aiLocation: null
    };
  }

  const transcriptCoordinates = getAreaCoordinates(getTranscriptText(report), 'transcript-keyword');
  if (transcriptCoordinates) {
    return {
      mapped: true,
      coordinates: transcriptCoordinates,
      cleanedLocation: report.location,
      aiLocation: null
    };
  }

  const aiLocation = await getAiLocation(report, aiBudget);

  if (aiLocation) {
    const aiCoordinates = getAreaCoordinates(aiLocation.detected_area, 'ai-detected-area')
      || getAreaCoordinates(aiLocation.cleaned_location, 'ai-cleaned-location');

    if (aiCoordinates && areaAppearsInReport(report, aiCoordinates.area)) {
      return {
        mapped: true,
        coordinates: aiCoordinates,
        cleanedLocation: aiLocation.cleaned_location || report.location,
        aiLocation
      };
    }
  }

  return {
    mapped: false,
    reason: invalidDatabaseReason
      || (aiLocation && aiLocation.missing_location_details)
      || 'Location needs manual verification before it can be mapped.',
    cleanedLocation: aiLocation && aiLocation.cleaned_location
      ? aiLocation.cleaned_location
      : report.location,
    aiLocation
  };
}

async function buildMapData(reports) {
  const markers = [];
  const unmapped = [];
  const incidents = reports.map(getMapIncidentSnapshot);
  const aiHealth = await ollamaService.checkHealth().catch(() => ({ available: false }));
  const aiBudget = {
    enabled: aiHealth.available,
    remaining: MAX_AI_LOCATION_LOOKUPS
  };

  for (const report of reports) {
    const incident = getMapIncidentSnapshot(report);
    const resolution = await resolveIncidentLocation(report, aiBudget);
    const common = {
      ...incident,
      id: report.id,
      type: report.type,
      status: report.status,
      url: `/incidents/${report.id}`,
      cleanedLocation: resolution.cleanedLocation || report.location || '',
      aiConfidence: resolution.aiLocation ? resolution.aiLocation.confidence : '',
      locationSource: resolution.coordinates ? resolution.coordinates.source : ''
    };

    if (!resolution.mapped) {
      unmapped.push({
        ...common,
        reason: resolution.reason
      });
      continue;
    }

    markers.push({
      ...common,
      lat: resolution.coordinates.lat,
      lng: resolution.coordinates.lng,
      mappedArea: resolution.coordinates.area || '',
      latitude: resolution.coordinates.lat,
      longitude: resolution.coordinates.lng
    });
  }

  return {
    incidents,
    markers,
    unmapped
  };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

module.exports = {
  REQUIRED_FIELDS,
  calculateCompletion,
  mapIncident,
  buildMapData,
  safeJson,
  statusKey: (status) => String(status || '').toLowerCase().replace(/\s+/g, '-')
};
