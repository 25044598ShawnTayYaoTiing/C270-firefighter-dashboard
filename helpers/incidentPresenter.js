const {
  getDatabaseCoordinates,
  getIncidentMarkerColor,
  hasValidCoordinates,
  isCompletedLikeStatus,
  shouldShowOnLiveMap,
  toNullableNumber
} = require('./locationResolver');

const COMPLETION_FIELDS = [
  { key: 'transcript', label: 'Transcript', weight: 10 },
  { key: 'reportingOfficer', label: 'Reporting Officer', weight: 10 },
  { key: 'location', label: 'Incident Location', weight: 15 },
  { key: 'type', label: 'Incident Type', weight: 15 },
  { key: 'dateTime', label: 'Date and Time', weight: 10 },
  { key: 'summary', label: 'Incident Summary', weight: 15 },
  { key: 'hazards', label: 'Hazards', weight: 10 },
  { key: 'injured', label: 'Injured or Trapped Persons', weight: 10 },
  { key: 'status', label: 'Response Status', weight: 5 }
];

const NON_MEANINGFUL_TEXT = new Set([
  'null',
  'undefined',
  'select type',
  'select reporting officer',
  'not identified in transcript',
  'not available',
  'n/a',
  'placeholder text'
]);

function normalizeCompletionText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\.+$/, '');
}

function hasMeaningfulValue(fieldKey, value) {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  const normalized = normalizeCompletionText(value);

  if (!normalized) return false;
  if (fieldKey === 'status') return normalized !== 'draft';

  return !NON_MEANINGFUL_TEXT.has(normalized);
}

function getCompletionMessage(percent) {
  if (percent === 0) return 'No report drafted yet.';
  if (percent < 50) return 'Critical details still missing.';
  if (percent < 80) return 'Review required before submission.';
  if (percent < 100) return 'Almost complete. Please verify remaining details.';
  return 'Report appears complete.';
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

function calculateCompletion(values = {}) {
  const missingFields = COMPLETION_FIELDS
    .filter((field) => !hasMeaningfulValue(field.key, values[field.key]))
    .map((field) => field.label);
  const percent = COMPLETION_FIELDS.reduce((total, field) => {
    return hasMeaningfulValue(field.key, values[field.key])
      ? total + field.weight
      : total;
  }, 0);

  return {
    percent,
    missingFields,
    message: getCompletionMessage(percent)
  };
}

function mapIncident(row) {
  const incidentId = row.incident_id || '';
  const incidentType = row.incident_type || 'Unspecified';
  const responseStatus = row.response_status || 'Draft';
  const reportingOfficerId = row.reporting_officer_id || null;
  const reportingOfficerName = row.officer_name || '';
  const reportingOfficerRole = row.officer_role || '';
  const completion = calculateCompletion({
    transcript: row.transcript,
    reportingOfficer: reportingOfficerId || reportingOfficerName,
    location: row.location,
    type: row.incident_type,
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
    reportingOfficerId,
    reporting_officer_id: reportingOfficerId,
    reportingOfficerName,
    officer_name: reportingOfficerName,
    reportingOfficerRole,
    officer_role: reportingOfficerRole,
    reportingOfficerDisplay: reportingOfficerName
      ? `${reportingOfficerName}${reportingOfficerRole ? ` - ${reportingOfficerRole}` : ''}`
      : 'Not assigned',
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
    transcriptInput: row.transcript || '',
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
  COMPLETION_FIELDS,
  calculateCompletion,
  hasMeaningfulValue,
  mapIncident,
  buildMapData,
  safeJson,
  shouldShowOnLiveMap,
  statusKey: (status) => String(status || '').toLowerCase().replace(/\s+/g, '-')
};
