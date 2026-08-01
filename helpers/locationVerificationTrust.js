const {
  LOCATION_VERIFICATION_STATUSES
} = require('../config/locationVerification');
const {
  validateCoordinatePair
} = require('./locationResolver');
const {
  normalizeLocationQuery
} = require('../public/js/locationVerification');

const SESSION_KEY = 'trustedIncidentLocationVerification';
const VERIFICATION_TTL_MS = 15 * 60 * 1000;
const COORDINATE_TOLERANCE = 0.0000001;

function normalizeForComparison(value) {
  return normalizeLocationQuery(value).toLowerCase();
}

function toTrustedCandidate(candidate) {
  const coordinates = validateCoordinatePair(
    candidate && candidate.latitude,
    candidate && candidate.longitude
  );

  if (!coordinates.valid) return null;

  return {
    address: normalizeLocationQuery(candidate.address || candidate.name).slice(0, 255),
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    source: normalizeLocationQuery(candidate.source || 'onemap').slice(0, 32)
  };
}

function recordLocationVerification(session, query, result, now = Date.now()) {
  if (!session) return;

  const candidates = result && result.verified && result.verifiedLocation
    ? [result.verifiedLocation]
    : result && Array.isArray(result.candidates)
      ? result.candidates
      : [];
  const trustedCandidates = candidates
    .map(toTrustedCandidate)
    .filter(Boolean)
    .slice(0, 5);

  if (trustedCandidates.length === 0) {
    delete session[SESSION_KEY];
    return;
  }

  session[SESSION_KEY] = {
    query: normalizeLocationQuery(query).slice(0, 255),
    candidates: trustedCandidates,
    expiresAt: now + VERIFICATION_TTL_MS
  };
}

function clearLocationVerification(session) {
  if (session) delete session[SESSION_KEY];
}

function coordinatesMatch(candidate, coordinates) {
  return Math.abs(candidate.latitude - coordinates.latitude) <= COORDINATE_TOLERANCE
    && Math.abs(candidate.longitude - coordinates.longitude) <= COORDINATE_TOLERANCE;
}

function resolveTrustedLocation(session, incident, now = Date.now()) {
  const verification = session && session[SESSION_KEY];
  const coordinates = validateCoordinatePair(
    incident && incident.latitude,
    incident && incident.longitude
  );

  if (!verification
    || !Number.isFinite(verification.expiresAt)
    || verification.expiresAt < now
    || !coordinates.valid
    || normalizeForComparison(verification.query)
      !== normalizeForComparison(incident && incident.incidentLocation)) {
    return null;
  }

  const candidate = Array.isArray(verification.candidates)
    ? verification.candidates.find((entry) => coordinatesMatch(entry, coordinates))
    : null;

  if (!candidate) return null;

  return {
    locationVerificationStatus: LOCATION_VERIFICATION_STATUSES.VERIFIED,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    locationVerificationSource: candidate.source,
    verifiedLocationLabel: candidate.address
  };
}

module.exports = {
  clearLocationVerification,
  recordLocationVerification,
  resolveTrustedLocation,
  _private: {
    SESSION_KEY,
    VERIFICATION_TTL_MS,
    coordinatesMatch,
    toTrustedCandidate
  }
};
