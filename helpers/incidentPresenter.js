const {
  getDatabaseCoordinates,
  getIncidentMarkerColor,
  hasValidCoordinates,
  isCompletedLikeStatus,
  shouldShowOnLiveMap,
  toNullableNumber
} = require('./locationResolver');

const REQUIRED_FIELDS = [
  { key: 'location', label: 'Incident Location' },
  { key: 'type', label: 'Incident Type' },
  { key: 'dateTime', label: 'Date and Time' },
  { key: 'summary', label: 'Incident Summary' },
  { key: 'status', label: 'Response Status' },
  { key: 'hazards', label: 'Hazards' },
  { key: 'injured', label: 'Injured or Trapped Persons' }
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
    database_id: row.id || null,
    databaseId: row.id || null,
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
    incident_summary: row.incident_summary || '',
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

function getMapIncidentSnapshot(report) {
  return {
    id: report.id,
    database_id: report.database_id || report.databaseId || null,
    incident_id: report.incident_id || report.id,
    incident_type: report.incident_type || report.type,
    location: report.location || '',
    response_status: report.response_status || report.status,
    incident_summary: report.incident_summary || report.summary || '',
    transcript: getTranscriptText(report),
    latitude: toNullableNumber(report.latitude),
    longitude: toNullableNumber(report.longitude)
  };
}

function getUnmappedReason(report) {
  const coordinates = getDatabaseCoordinates(report.latitude, report.longitude);

  if (coordinates && coordinates.invalidReason) return coordinates.invalidReason;

  return 'Missing coordinates or location not mapped.';
}

async function buildMapData(reports) {
  const markers = [];
  const unmapped = [];
  const incidents = reports.map(getMapIncidentSnapshot);
  let completedHidden = 0;

  for (const report of reports) {
    const incident = getMapIncidentSnapshot(report);
    const common = {
      ...incident,
      id: report.id,
      type: report.type,
      status: report.status,
      url: `/incidents/${report.id}`,
      cleanedLocation: report.location || '',
      locationSource: hasValidCoordinates(incident) ? 'database' : '',
      markerColor: getIncidentMarkerColor(report.status)
    };

    if (isCompletedLikeStatus(common.response_status)) {
      completedHidden += 1;
      continue;
    }

    if (!shouldShowOnLiveMap(common)) {
      unmapped.push({
        ...common,
        reason: getUnmappedReason(common)
      });
      continue;
    }

    markers.push({
      ...common,
      lat: common.latitude,
      lng: common.longitude,
      latitude: common.latitude,
      longitude: common.longitude
    });
  }

  return {
    incidents,
    markers,
    unmapped,
    completedHidden
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
  shouldShowOnLiveMap,
  statusKey: (status) => String(status || '').toLowerCase().replace(/\s+/g, '-')
};
