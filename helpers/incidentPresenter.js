const REQUIRED_FIELDS = [
  { key: 'location', label: 'Incident Location' },
  { key: 'type', label: 'Incident Type' },
  { key: 'dateTime', label: 'Date and Time' },
  { key: 'summary', label: 'Incident Summary' },
  { key: 'status', label: 'Response Status' },
  { key: 'hazards', label: 'Hazards' },
  { key: 'injured', label: 'Injured or Trapped Persons' }
];

const LOCATION_COORDINATES = [
  { match: 'jurong west', label: 'Jurong West', lat: 1.3404, lng: 103.7090 },
  { match: 'bedok', label: 'Bedok', lat: 1.3236, lng: 103.9273 },
  { match: 'tampines', label: 'Tampines', lat: 1.3547, lng: 103.9437 },
  { match: 'woodlands', label: 'Woodlands', lat: 1.4360, lng: 103.7860 },
  { match: 'yishun', label: 'Yishun', lat: 1.4294, lng: 103.8354 },
  { match: 'ang mo kio', label: 'Ang Mo Kio', lat: 1.3691, lng: 103.8454 },
  { match: 'toa payoh', label: 'Toa Payoh', lat: 1.3343, lng: 103.8563 }
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
      ? 'Report appears complete.'
      : percent < 70
        ? 'Review required before submission.'
        : 'Report is almost complete.'
  };
}

function mapIncident(row) {
  const completion = calculateCompletion({
    location: row.location,
    type: row.incident_type,
    dateTime: row.incident_datetime,
    summary: row.incident_summary,
    status: row.response_status,
    hazards: row.hazards,
    injured: row.injured_or_trapped_persons
  });

  return {
    id: row.incident_id,
    type: row.incident_type,
    location: row.location,
    status: row.response_status,
    createdDate: formatDateTime(row.incident_datetime),
    lastUpdated: formatDateTime(row.updated_at || row.created_at),
    incidentDate: row.incident_datetime ? new Date(row.incident_datetime) : null,
    updatedDate: row.updated_at ? new Date(row.updated_at) : null,
    dateInput: toDateInput(row.incident_datetime),
    responseTime: 'Not recorded',
    summary: row.incident_summary,
    hazards: row.hazards || 'None.',
    injured: row.injured_or_trapped_persons || 'No injured or trapped persons reported.',
    missingInfo: row.missing_information || 'None.',
    officerNotes: row.officer_notes || 'None.',
    transcript: row.transcript || 'No transcript provided.',
    latitude: row.latitude,
    longitude: row.longitude,
    completion
  };
}

function getCoordinates(report) {
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { lat: latitude, lng: longitude, source: 'database' };
  }

  const location = String(report.location || '').toLowerCase();
  const match = LOCATION_COORDINATES.find((area) => location.includes(area.match));

  return match
    ? { lat: match.lat, lng: match.lng, source: match.label }
    : null;
}

function buildMapData(reports) {
  const markers = [];
  const unmapped = [];

  reports.forEach((report) => {
    const coordinates = getCoordinates(report);

    if (!coordinates) {
      unmapped.push({
        id: report.id,
        type: report.type,
        location: report.location,
        status: report.status,
        url: `/incidents/${report.id}`
      });
      return;
    }

    markers.push({
      id: report.id,
      type: report.type,
      location: report.location,
      status: report.status,
      lat: coordinates.lat,
      lng: coordinates.lng,
      source: coordinates.source,
      url: `/incidents/${report.id}`
    });
  });

  return { markers, unmapped };
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
  statusKey: (status) => status.toLowerCase().replace(/\s+/g, '-')
};
