require('dotenv').config();

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

function getValidResultCoordinates(data) {
  const results = Array.isArray(data.results) ? data.results : [];

  for (const result of results) {
    const latitude = Number(result.LATITUDE);
    const longitude = Number(result.LONGITUDE || result.LONGTITUDE);

    if (Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && isSingaporeCoordinate(latitude, longitude)) {
      return {
        lat: latitude,
        lng: longitude,
        source: 'onemap',
        address: result.ADDRESS || result.SEARCHVAL || '',
        searchValue: result.SEARCHVAL || ''
      };
    }
  }

  return null;
}

async function requestOneMapSearch(searchText, token) {
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

  if (!response.ok) return null;

  return getValidResultCoordinates(data);
}

async function searchOneMapLocation(searchText) {
  const normalizedSearchText = normalizeSearchText(searchText);
  if (!normalizedSearchText || !hasOneMapCredentials()) return null;

  let token = await getOneMapToken();
  if (!token) return null;

  try {
    return await requestOneMapSearch(normalizedSearchText, token);
  } catch (error) {
    if (!(error instanceof OneMapAuthError)) return null;

    clearCachedOneMapToken();
    token = await getOneMapToken();
    if (!token) return null;

    try {
      return await requestOneMapSearch(normalizedSearchText, token);
    } catch (retryError) {
      return null;
    }
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
  resolveIncidentCoordinates
};
