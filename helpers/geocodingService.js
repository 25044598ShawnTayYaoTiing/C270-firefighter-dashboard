require('dotenv').config({ quiet: true });

const {
  getDatabaseCoordinates,
  isSingaporeCoordinate,
  resolveIncidentCoordinates: resolveLocalIncidentCoordinates
} = require('./locationResolver');

let cachedOneMapToken = null;
let cachedTokenExpiry = 0;
let tokenRequestPromise = null;

const DEFAULT_TOKEN_TTL_MS = 71 * 60 * 60 * 1000;
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

class OneMapAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OneMapAuthError';
  }
}

class OneMapServiceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OneMapServiceError';
  }
}

function getOneMapBaseUrl() {
  return (process.env.ONEMAP_BASE_URL || 'https://www.onemap.gov.sg').replace(/\/$/, '');
}

function hasOneMapCredentials() {
  return Boolean(
    String(process.env.ONEMAP_EMAIL || '').trim()
    && String(process.env.ONEMAP_PASSWORD || '').trim()
  );
}

function normalizeSearchText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch (error) {
      data = { raw: text };
    }

    return {
      response,
      data
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getTokenExpiryMs(data) {
  const rawExpiry = data.expiry_timestamp || data.expires_at || data.expiry;
  const parsedExpiry = Number(rawExpiry);

  if (Number.isFinite(parsedExpiry) && parsedExpiry > 0) {
    const expiryMs = parsedExpiry > 1000000000000
      ? parsedExpiry
      : parsedExpiry * 1000;

    return Math.max(Date.now(), expiryMs - TOKEN_EXPIRY_SKEW_MS);
  }

  return Date.now() + DEFAULT_TOKEN_TTL_MS;
}

function clearCachedOneMapToken() {
  cachedOneMapToken = null;
  cachedTokenExpiry = 0;
}

async function authenticateOneMap() {
  if (!hasOneMapCredentials()) return null;

  const { response, data } = await fetchJson(`${getOneMapBaseUrl()}/api/auth/post/getToken`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: process.env.ONEMAP_EMAIL,
      password: process.env.ONEMAP_PASSWORD
    })
  });

  if (!response.ok || !data.access_token) {
    clearCachedOneMapToken();
    return null;
  }

  cachedOneMapToken = data.access_token;
  cachedTokenExpiry = getTokenExpiryMs(data);
  return cachedOneMapToken;
}

async function getOneMapToken() {
  if (cachedOneMapToken && Date.now() < cachedTokenExpiry) {
    return cachedOneMapToken;
  }

  if (!tokenRequestPromise) {
    tokenRequestPromise = authenticateOneMap()
      .catch(() => {
        clearCachedOneMapToken();
        return null;
      })
      .finally(() => {
        tokenRequestPromise = null;
      });
  }

  return tokenRequestPromise;
}

function isAuthError(response, data) {
  const message = [
    data && data.error,
    data && data.message,
    data && data.raw
  ].filter(Boolean).join(' ').toLowerCase();

  return response.status === 401
    || response.status === 403
    || message.includes('authentication')
    || message.includes('auth token')
    || message.includes('token missing')
    || message.includes('token expired')
    || message.includes('expired token')
    || message.includes('invalid token');
}

function getValidResultCandidates(data) {
  const results = Array.isArray(data.results) ? data.results : [];
  const seen = new Set();
  const candidates = [];

  for (const result of results) {
    const latitude = Number(result.LATITUDE);
    const longitude = Number(result.LONGITUDE || result.LONGTITUDE);

    if (Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && isSingaporeCoordinate(latitude, longitude)) {
      const address = normalizeSearchText(
        result.ADDRESS
        || [
          result.BLK_NO,
          result.ROAD_NAME,
          result.BUILDING,
          result.POSTAL ? `Singapore ${result.POSTAL}` : ''
        ].filter(Boolean).join(' ')
      );
      const name = normalizeSearchText(
        result.SEARCHVAL
        || result.BUILDING
        || [result.BLK_NO, result.ROAD_NAME].filter(Boolean).join(' ')
        || address
      );
      const dedupeKey = [
        latitude.toFixed(6),
        longitude.toFixed(6),
        address.toLowerCase()
      ].join('|');

      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      candidates.push({
        id: dedupeKey,
        name,
        address: address || name,
        postalCode: normalizeSearchText(result.POSTAL),
        latitude,
        longitude,
        source: 'onemap',
        searchValue: name
      });
    }
  }

  return candidates.slice(0, 5);
}

async function requestOneMapCandidates(searchText, token) {
  const url = new URL(`${getOneMapBaseUrl()}/api/common/elastic/search`);
  url.searchParams.set('searchVal', searchText);
  url.searchParams.set('returnGeom', 'Y');
  url.searchParams.set('getAddrDetails', 'Y');
  url.searchParams.set('pageNum', '1');

  const { response, data } = await fetchJson(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (isAuthError(response, data)) {
    throw new OneMapAuthError('OneMap token was rejected.');
  }

  if (!response.ok) {
    throw new OneMapServiceError('OneMap location search failed.');
  }

  if (!Array.isArray(data.results)) {
    throw new OneMapServiceError('OneMap returned an invalid location response.');
  }

  return getValidResultCandidates(data);
}

async function searchOneMapCandidates(searchText) {
  const normalizedSearchText = normalizeSearchText(searchText);

  if (!normalizedSearchText) return [];

  if (!hasOneMapCredentials()) {
    throw new OneMapServiceError('OneMap credentials are not configured.');
  }

  let token = await getOneMapToken();
  if (!token) {
    throw new OneMapServiceError('OneMap authentication failed.');
  }

  try {
    return await requestOneMapCandidates(normalizedSearchText, token);
  } catch (error) {
    if (!(error instanceof OneMapAuthError)) throw error;

    clearCachedOneMapToken();
    token = await getOneMapToken();
    if (!token) {
      throw new OneMapServiceError('OneMap authentication failed.');
    }

    return requestOneMapCandidates(normalizedSearchText, token);
  }
}

async function searchOneMapLocation(searchText) {
  try {
    const candidates = await searchOneMapCandidates(searchText);
    const candidate = candidates[0];

    if (!candidate) return null;

    return {
      address: candidate.address,
      lat: candidate.latitude,
      lng: candidate.longitude,
      searchValue: candidate.searchValue,
      source: candidate.source
    };
  } catch (error) {
    return null;
  }
}

function getSearchTexts(incident) {
  const candidates = [
    incident.location,
    incident.summary || incident.incident_summary,
    incident.transcript
  ].map(normalizeSearchText);

  return candidates.filter((value, index) => (
    value && candidates.indexOf(value) === index
  ));
}

async function resolveIncidentCoordinates(incident) {
  const databaseCoordinates = getDatabaseCoordinates(incident.latitude, incident.longitude);

  if (databaseCoordinates && !databaseCoordinates.invalidReason) {
    return databaseCoordinates;
  }

  for (const searchText of getSearchTexts(incident)) {
    const oneMapCoordinates = await searchOneMapLocation(searchText);

    if (oneMapCoordinates) return oneMapCoordinates;
  }

  return resolveLocalIncidentCoordinates(incident);
}

module.exports = {
  resolveIncidentCoordinates,
  searchOneMapCandidates,
  _private: {
    getValidResultCandidates
  }
};
