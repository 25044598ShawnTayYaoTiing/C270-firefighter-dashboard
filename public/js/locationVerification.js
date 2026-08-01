(function exposeLocationVerification(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LocationVerification = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLocationVerification() {
  const STATES = Object.freeze({
    UNVERIFIED: 'UNVERIFIED',
    SEARCHING: 'SEARCHING',
    CANDIDATES: 'CANDIDATES',
    VERIFIED: 'VERIFIED',
    ERROR: 'ERROR'
  });

  const GENERIC_ADDRESS_TERMS = new Set([
    'address',
    'avenue',
    'ave',
    'block',
    'blk',
    'building',
    'close',
    'drive',
    'dr',
    'lane',
    'lorong',
    'place',
    'pl',
    'road',
    'rd',
    'singapore',
    'street',
    'st',
    'walk',
    'way'
  ]);

  function normalizeLocationQuery(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getLocationTokens(value) {
    return normalizeLocationQuery(value)
      .toLowerCase()
      .match(/[a-z0-9]+/g) || [];
  }

  function getLocationQueryParts(value) {
    const normalized = normalizeLocationQuery(value);
    const tokens = getLocationTokens(normalized);
    const numericTokens = tokens.filter((token) => /^\d+$/.test(token));
    const postalCodes = numericTokens.filter((token) => /^\d{6}$/.test(token));
    const meaningfulWords = tokens.filter((token) => (
      /[a-z]/.test(token)
      && token.length > 1
      && !GENERIC_ADDRESS_TERMS.has(token)
    ));

    return {
      normalized,
      tokens,
      numericTokens,
      postalCodes,
      meaningfulWords
    };
  }

  function validateLocationQuery(value) {
    const parts = getLocationQueryParts(value);

    if (!parts.normalized) {
      return {
        valid: false,
        code: 'empty_location',
        message: 'Enter a Singapore address, postal code, or named place.'
      };
    }

    if (/^\d+$/.test(parts.normalized)) {
      if (/^\d{6}$/.test(parts.normalized)) {
        return {
          valid: true,
          kind: 'postal_code',
          normalized: parts.normalized
        };
      }

      return {
        valid: false,
        code: 'insufficient_location',
        message: 'Enter a complete 6-digit Singapore postal code or a more specific address.'
      };
    }

    if (parts.postalCodes.length > 0) {
      return {
        valid: true,
        kind: 'postal_code',
        normalized: parts.normalized
      };
    }

    if (parts.numericTokens.length > 0 && parts.meaningfulWords.length > 0) {
      return {
        valid: true,
        kind: 'address',
        normalized: parts.normalized
      };
    }

    if (parts.meaningfulWords.length >= 2) {
      return {
        valid: true,
        kind: 'named_place',
        normalized: parts.normalized
      };
    }

    return {
      valid: false,
      code: 'insufficient_location',
      message: 'Add a block or building number, 6-digit postal code, or a more specific place name.'
    };
  }

  function cloneSnapshot(snapshot) {
    return {
      ...snapshot,
      candidates: snapshot.candidates.map((candidate) => ({ ...candidate })),
      verifiedLocation: snapshot.verifiedLocation
        ? { ...snapshot.verifiedLocation }
        : null
    };
  }

  function createVerificationState(initial = {}) {
    let requestVersion = 0;
    let snapshot = {
      status: initial.verifiedLocation ? STATES.VERIFIED : STATES.UNVERIFIED,
      query: normalizeLocationQuery(initial.query),
      candidates: [],
      verifiedLocation: initial.verifiedLocation
        ? { ...initial.verifiedLocation }
        : null,
      message: ''
    };

    function beginSearch(query) {
      requestVersion += 1;
      snapshot = {
        status: STATES.SEARCHING,
        query: normalizeLocationQuery(query),
        candidates: [],
        verifiedLocation: null,
        message: ''
      };
      return requestVersion;
    }

    function isCurrentRequest(version, query) {
      return version === requestVersion
        && normalizeLocationQuery(query) === snapshot.query;
    }

    function showCandidates(version, query, candidates) {
      if (!isCurrentRequest(version, query)) return false;

      snapshot = {
        status: STATES.CANDIDATES,
        query: snapshot.query,
        candidates: Array.isArray(candidates)
          ? candidates.map((candidate) => ({ ...candidate }))
          : [],
        verifiedLocation: null,
        message: ''
      };
      return true;
    }

    function verify(version, query, candidate) {
      if (!isCurrentRequest(version, query) || !candidate) return false;

      snapshot = {
        status: STATES.VERIFIED,
        query: snapshot.query,
        candidates: [],
        verifiedLocation: { ...candidate },
        message: ''
      };
      return true;
    }

    function selectCandidate(candidate) {
      if (snapshot.status !== STATES.CANDIDATES || !candidate) return false;

      snapshot = {
        status: STATES.VERIFIED,
        query: snapshot.query,
        candidates: [],
        verifiedLocation: { ...candidate },
        message: ''
      };
      return true;
    }

    function fail(version, query, message) {
      if (!isCurrentRequest(version, query)) return false;

      snapshot = {
        status: STATES.ERROR,
        query: snapshot.query,
        candidates: [],
        verifiedLocation: null,
        message: String(message || '')
      };
      return true;
    }

    function invalidate(query = '') {
      requestVersion += 1;
      snapshot = {
        status: STATES.UNVERIFIED,
        query: normalizeLocationQuery(query),
        candidates: [],
        verifiedLocation: null,
        message: ''
      };
    }

    return {
      beginSearch,
      fail,
      getSnapshot: () => cloneSnapshot(snapshot),
      invalidate,
      isCurrentRequest,
      selectCandidate,
      showCandidates,
      verify
    };
  }

  function getSubmissionLocationDecision({ verified = false, acknowledged = false } = {}) {
    if (verified) {
      return {
        allowed: true,
        requiresAcknowledgement: false,
        status: STATES.VERIFIED
      };
    }

    return {
      allowed: acknowledged === true,
      requiresAcknowledgement: true,
      status: STATES.UNVERIFIED
    };
  }

  function createSubmissionGuard() {
    let locked = false;

    return {
      isLocked: () => locked,
      tryLock() {
        if (locked) return false;
        locked = true;
        return true;
      }
    };
  }

  return {
    STATES,
    createSubmissionGuard,
    createVerificationState,
    getSubmissionLocationDecision,
    getLocationQueryParts,
    getLocationTokens,
    normalizeLocationQuery,
    validateLocationQuery
  };
}));
