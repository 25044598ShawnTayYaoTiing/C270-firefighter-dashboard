const {
  getLocationQueryParts,
  getLocationTokens,
  normalizeLocationQuery,
  validateLocationQuery
} = require('../public/js/locationVerification');
const {
  searchOneMapCandidates
} = require('./geocodingService');

class LocationVerificationError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = 'LocationVerificationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function getCandidateSearchText(candidate) {
  return [
    candidate.name,
    candidate.address,
    candidate.postalCode
  ].filter(Boolean).join(' ');
}

function isStrongSingleMatch(query, candidate) {
  const queryParts = getLocationQueryParts(query);
  const candidateTokens = new Set(getLocationTokens(getCandidateSearchText(candidate)));

  if (queryParts.postalCodes.some((postalCode) => (
    String(candidate.postalCode || '') === postalCode
  ))) {
    return true;
  }

  const significantTokens = [
    ...queryParts.numericTokens,
    ...queryParts.meaningfulWords
  ];

  return significantTokens.length >= 2
    && significantTokens.every((token) => candidateTokens.has(token));
}

function toVerifiedLocation(candidate) {
  return {
    address: candidate.address || candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    name: candidate.name || candidate.address,
    postalCode: candidate.postalCode || '',
    source: candidate.source || 'onemap'
  };
}

async function verifyLocationQuery(location, options = {}) {
  const validation = validateLocationQuery(location);

  if (!validation.valid) {
    throw new LocationVerificationError(
      validation.code,
      validation.message,
      400
    );
  }

  const candidateSearch = options.searchCandidates || searchOneMapCandidates;
  let candidates;

  try {
    candidates = await candidateSearch(validation.normalized);
  } catch (error) {
    throw new LocationVerificationError(
      'location_service_unavailable',
      'The Singapore location service is temporarily unavailable. Please try again.',
      503
    );
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new LocationVerificationError(
      'location_not_found',
      'No matching OneMap location was found. Add a block number, road name, building name, or six-digit postal code and search again.',
      404
    );
  }

  if (candidates.length === 1 && isStrongSingleMatch(validation.normalized, candidates[0])) {
    return {
      candidates: [],
      normalizedQuery: normalizeLocationQuery(validation.normalized),
      requiresSelection: false,
      verified: true,
      verifiedLocation: toVerifiedLocation(candidates[0])
    };
  }

  return {
    candidates: candidates.map(toVerifiedLocation),
    normalizedQuery: normalizeLocationQuery(validation.normalized),
    requiresSelection: true,
    verified: false,
    verifiedLocation: null
  };
}

module.exports = {
  LocationVerificationError,
  verifyLocationQuery,
  _private: {
    isStrongSingleMatch,
    toVerifiedLocation
  }
};
