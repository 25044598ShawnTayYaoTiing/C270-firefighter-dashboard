const SINGAPORE_BOUNDS = {
  minLat: 1.10,
  maxLat: 1.50,
  minLng: 103.55,
  maxLng: 104.45
};

// Done by Fatin ID: 25050557
// Local fallback coordinates for common Singapore locations.
// Used when OneMap geocoding is unavailable.
const LOCATION_COORDINATES = [
  { matches: ['beach station'], label: 'Sentosa Beach Station', lat: 1.2514, lng: 103.8179 },
  { matches: ['siloso beach walk', 'siloso beach'], label: 'Siloso Beach', lat: 1.2565, lng: 103.8121 },
  { matches: ['sentosa'], label: 'Sentosa', lat: 1.2494, lng: 103.8303 },
  { matches: ['jurong west'], label: 'Jurong West', lat: 1.3404, lng: 103.7090 },
  { matches: ['bedok'], label: 'Bedok', lat: 1.3236, lng: 103.9273 },
  { matches: ['tampines'], label: 'Tampines', lat: 1.3496, lng: 103.9568 },
  { matches: ['woodlands'], label: 'Woodlands', lat: 1.4360, lng: 103.7860 },
  { matches: ['yishun'], label: 'Yishun', lat: 1.4294, lng: 103.8354 },
  { matches: ['ang mo kio'], label: 'Ang Mo Kio', lat: 1.3691, lng: 103.8454 },
  { matches: ['toa payoh'], label: 'Toa Payoh', lat: 1.3343, lng: 103.8563 },
  { matches: ['bukit batok'], label: 'Bukit Batok', lat: 1.3496, lng: 103.7499 },
  { matches: ['hougang'], label: 'Hougang', lat: 1.3612, lng: 103.8863 },
  { matches: ['clementi'], label: 'Clementi', lat: 1.3162, lng: 103.7649 },
  { matches: ['punggol'], label: 'Punggol', lat: 1.3984, lng: 103.9072 },
  { matches: ['sengkang'], label: 'Sengkang', lat: 1.3917, lng: 103.8950 },
  { matches: ['serangoon'], label: 'Serangoon', lat: 1.3520, lng: 103.8729 },
  { matches: ['bishan'], label: 'Bishan', lat: 1.3508, lng: 103.8485 },
  { matches: ['queenstown'], label: 'Queenstown', lat: 1.2942, lng: 103.7861 },
  { matches: ['bukit merah'], label: 'Bukit Merah', lat: 1.2819, lng: 103.8239 },
  { matches: ['kallang'], label: 'Kallang', lat: 1.3100, lng: 103.8660 },
  { matches: ['geylang'], label: 'Geylang', lat: 1.3182, lng: 103.8871 },
  { matches: ['pasir ris'], label: 'Pasir Ris', lat: 1.3730, lng: 103.9493 },
  { matches: ['changi'], label: 'Changi', lat: 1.3644, lng: 103.9915 },
  { matches: ['cbd', 'cdb', 'downtown', 'raffles place'], label: 'Downtown / Raffles Place', lat: 1.2836, lng: 103.8510 },
  { matches: ['orchard'], label: 'Orchard', lat: 1.3048, lng: 103.8318 }
];

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
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

function isValidCoordinateRange(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function validateCoordinatePair(latitudeValue, longitudeValue, options = {}) {
  const latitude = toNullableNumber(latitudeValue);
  const longitude = toNullableNumber(longitudeValue);

  if (latitude === null || longitude === null) {
    return {
      valid: false,
      latitude,
      longitude,
      message: 'Verified latitude and longitude are required.'
    };
  }

  if (!isValidCoordinateRange(latitude, longitude)) {
    return {
      valid: false,
      latitude,
      longitude,
      message: 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.'
    };
  }

  if (options.requireSingapore !== false && !isSingaporeCoordinate(latitude, longitude)) {
    return {
      valid: false,
      latitude,
      longitude,
      message: 'The verified coordinates must be within the Singapore operational map boundary.'
    };
  }

  return {
    valid: true,
    latitude,
    longitude,
    message: ''
  };
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[#,/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findAreaMatch(value) {
  const text = normalizeText(value);
  if (!text) return null;

  return LOCATION_COORDINATES.find((area) => (
    area.matches.some((match) => text.includes(match))
  )) || null;
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

function getDatabaseCoordinates(latitudeValue, longitudeValue) {
  const latitude = toNullableNumber(latitudeValue);
  const longitude = toNullableNumber(longitudeValue);

  if (latitude === null || longitude === null) return null;
  if (!isValidCoordinateRange(latitude, longitude)) return null;

  return {
    lat: latitude,
    lng: longitude,
    source: 'database'
  };
}

// Determine the best coordinates for an incident.
// Priority:
// 1. Existing database coordinates
// 2. Match location keywords
// 3. Match transcript
// 4. Match summary
function resolveIncidentCoordinates(incident) {
  const databaseCoordinates = getDatabaseCoordinates(incident.latitude, incident.longitude);

  if (databaseCoordinates && !databaseCoordinates.invalidReason) {
    return databaseCoordinates;
  }

  return getAreaCoordinates(incident.location, 'location-keyword')
    || getAreaCoordinates(incident.transcript, 'transcript-keyword')
    || getAreaCoordinates(incident.summary || incident.incident_summary, 'summary-keyword')
    || null;
}

function isCompletedLikeStatus(status) {
  const value = String(status || '').toLowerCase();

  return (
    value.includes('completed')
    || value.includes('reviewed')
    || value.includes('closed')
    || value.includes('resolved')
  );
}

function hasValidCoordinates(incident) {
  return validateCoordinatePair(
    incident && incident.latitude,
    incident && incident.longitude,
    { requireSingapore: false }
  ).valid;
}

function shouldShowOnLiveMap(incident) {
  return !isCompletedLikeStatus(incident && incident.response_status)
    && hasValidCoordinates(incident);
}

// Choose the marker colour based on incident status
function getIncidentMarkerColor(status) {
  const value = String(status || '').toLowerCase();

  if (value.includes('escalated') || value.includes('urgent') || value.includes('critical')) {
    return '#dc3545';
  }

  if (value.includes('pending') || value.includes('awaiting')) {
    return '#fd7e14';
  }

  if (
    value.includes('active')
    || value.includes('ongoing')
    || value.includes('dispatched')
    || value.includes('progress')
  ) {
    return '#0d6efd';
  }

  if (
    value.includes('completed')
    || value.includes('reviewed')
    || value.includes('closed')
    || value.includes('resolved')
  ) {
    return '#6c757d';
  }

  return '#0d6efd';
}

module.exports = {
  SINGAPORE_BOUNDS,
  LOCATION_COORDINATES,
  getAreaCoordinates,
  getDatabaseCoordinates,
  getIncidentMarkerColor,
  hasValidCoordinates,
  isCompletedLikeStatus,
  isSingaporeCoordinate,
  isValidCoordinateRange,
  resolveIncidentCoordinates,
  shouldShowOnLiveMap,
  toNullableNumber,
  validateCoordinatePair
};
