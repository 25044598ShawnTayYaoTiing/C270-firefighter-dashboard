const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATES,
  createSubmissionGuard,
  createVerificationState,
  getSubmissionLocationDecision,
  validateLocationQuery
} = require('../public/js/locationVerification');
const {
  LocationVerificationError,
  verifyLocationQuery
} = require('../helpers/locationVerificationService');
const {
  _private: geocodingInternals
} = require('../helpers/geocodingService');
const {
  _private: incidentModelInternals
} = require('../models/incidentModel');
const incidentController = require('../controllers/incidentController');
const {
  LOCATION_VERIFICATION_STATUSES
} = require('../config/locationVerification');

function candidate(overrides = {}) {
  return {
    name: '263 COMPASSVALE STREET',
    address: '263 COMPASSVALE STREET SINGAPORE 540263',
    postalCode: '540263',
    latitude: 1.3901,
    longitude: 103.8981,
    source: 'onemap',
    ...overrides
  };
}

test('"33" and other short numeric input cannot become verified', async () => {
  let searches = 0;

  for (const location of ['3', '33', '123', '263']) {
    const validation = validateLocationQuery(location);
    assert.equal(validation.valid, false);
    assert.equal(validation.code, 'insufficient_location');

    await assert.rejects(
      verifyLocationQuery(location, {
        searchCandidates: async () => {
          searches += 1;
          return [candidate()];
        }
      }),
      (error) => (
        error instanceof LocationVerificationError
        && error.code === 'insufficient_location'
      )
    );
  }

  assert.equal(searches, 0);
});

test('the verification endpoint rejects "33" even when summary text contains a location', async () => {
  const response = {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };

  await incidentController.verifyLocation({
    body: {
      location: '33',
      incidentSummary: 'Fire reported at 263 Compassvale Street'
    }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.success, false);
  assert.equal(response.body.code, 'insufficient_location');
});

test('generic location terms are rejected without useful identifying information', () => {
  for (const location of ['block', 'street', 'woodlands']) {
    assert.equal(validateLocationQuery(location).valid, false);
  }
});

test('qualified named places and block-number searches are accepted without auto-verification', async () => {
  assert.equal(validateLocationQuery('Singapore Polytechnic').valid, true);
  assert.equal(validateLocationQuery('singapore   polytechnic').valid, true);
  assert.equal(validateLocationQuery('Block 263').valid, true);

  let searchedQuery = '';
  const result = await verifyLocationQuery(' Singapore   Polytechnic ', {
    searchCandidates: async (query) => {
      searchedQuery = query;
      return [
        candidate({
          name: 'SINGAPORE POLYTECHNIC',
          address: '500 DOVER ROAD SINGAPORE 139651',
          postalCode: '139651',
          latitude: 1.3099,
          longitude: 103.7784
        }),
        candidate({
          name: 'SINGAPORE POLYTECHNIC SPORTS COMPLEX',
          address: '500 DOVER ROAD SINGAPORE 139651',
          postalCode: '139651',
          latitude: 1.3100,
          longitude: 103.7785
        })
      ];
    }
  });

  assert.equal(searchedQuery, 'Singapore Polytechnic');
  assert.equal(result.verified, false);
  assert.equal(result.requiresSelection, true);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].postalCode, '139651');
});

test('a valid 6-digit Singapore postal code can be searched and strongly matched', async () => {
  assert.equal(validateLocationQuery('730768').valid, true);

  const result = await verifyLocationQuery('730768', {
    searchCandidates: async () => [candidate({
      name: '33 CONVENIENCE MART',
      address: '768 WOODLANDS AVENUE 6 SINGAPORE 730768',
      postalCode: '730768'
    })]
  });

  assert.equal(result.verified, true);
  assert.equal(result.verifiedLocation.postalCode, '730768');
});

test('meaningful Singapore addresses can be searched', () => {
  for (const location of [
    'Block 263 Sengkang',
    '263 Compassvale Street',
    '10 Woodlands Ave 6',
    'Changi Airport Terminal 1'
  ]) {
    assert.equal(validateLocationQuery(location).valid, true, location);
  }
});

test('zero geocoder results keep the location unverified', async () => {
  await assert.rejects(
    verifyLocationQuery('263 Compassvale Street', {
      searchCandidates: async () => []
    }),
    (error) => (
      error instanceof LocationVerificationError
      && error.code === 'location_not_found'
      && error.statusCode === 404
    )
  );
});

test('multiple results require officer selection even when one looks strong', async () => {
  const result = await verifyLocationQuery('263 Compassvale Street', {
    searchCandidates: async () => [
      candidate(),
      candidate({
        name: '263B COMPASSVALE STREET',
        address: '263B COMPASSVALE STREET SINGAPORE 542263',
        postalCode: '542263',
        latitude: 1.3902
      })
    ]
  });

  assert.equal(result.verified, false);
  assert.equal(result.requiresSelection, true);
  assert.equal(result.candidates.length, 2);
});

test('a selected candidate becomes verified with its normalized address and coordinates', () => {
  const state = createVerificationState();
  const query = '263 Compassvale Street';
  const selected = candidate();
  const request = state.beginSearch(query);

  assert.equal(state.showCandidates(request, query, [selected]), true);
  assert.equal(state.selectCandidate(selected), true);

  const snapshot = state.getSnapshot();
  assert.equal(snapshot.status, STATES.VERIFIED);
  assert.equal(snapshot.verifiedLocation.address, selected.address);
  assert.equal(snapshot.verifiedLocation.latitude, selected.latitude);
  assert.equal(snapshot.verifiedLocation.longitude, selected.longitude);
});

test('editing the input after verification invalidates the old location', () => {
  const state = createVerificationState();
  const query = '263 Compassvale Street';
  const request = state.beginSearch(query);

  state.verify(request, query, candidate());
  state.invalidate('263 Compassvale Street ABC');

  const snapshot = state.getSnapshot();
  assert.equal(snapshot.status, STATES.UNVERIFIED);
  assert.equal(snapshot.verifiedLocation, null);
  assert.equal(snapshot.query, '263 Compassvale Street ABC');
});

test('an AI-populated location starts unverified until an officer searches it', () => {
  const state = createVerificationState({
    query: '263 Compassvale Street'
  });

  assert.equal(state.getSnapshot().status, STATES.UNVERIFIED);
  assert.equal(state.getSnapshot().verifiedLocation, null);
});

test('unverified report submission requires explicit acknowledgement', () => {
  assert.deepEqual(getSubmissionLocationDecision({
    verified: false,
    acknowledged: false
  }), {
    allowed: false,
    requiresAcknowledgement: true,
    status: STATES.UNVERIFIED
  });
  assert.equal(getSubmissionLocationDecision({
    verified: false,
    acknowledged: true
  }).allowed, true);
  assert.equal(getSubmissionLocationDecision({
    verified: true,
    acknowledged: false
  }).requiresAcknowledgement, false);
});

test('submission guard prevents a duplicate report submission', () => {
  const guard = createSubmissionGuard();

  assert.equal(guard.tryLock(), true);
  assert.equal(guard.isLocked(), true);
  assert.equal(guard.tryLock(), false);
});

test('an unverified draft cannot persist AI-inferred or client-supplied coordinates', () => {
  const result = incidentModelInternals.resolveFormCoordinates({
    incidentLocation: '263 Compassvale Street',
    latitude: '1.3901',
    longitude: '103.8981',
    locationVerificationStatus: LOCATION_VERIFICATION_STATUSES.UNVERIFIED
  }, {
    location: '263 Compassvale Street',
    latitude: 1.3901,
    longitude: 103.8981
  });

  assert.equal(result.coordinates, null);
  assert.equal(result.locationChanged, true);
});

test('officer-verified coordinates remain available for persistence', () => {
  const result = incidentModelInternals.resolveFormCoordinates({
    incidentLocation: '263 Compassvale Street',
    latitude: '1.3901',
    longitude: '103.8981',
    locationVerificationStatus: LOCATION_VERIFICATION_STATUSES.VERIFIED
  });

  assert.equal(result.coordinates.lat, 1.3901);
  assert.equal(result.coordinates.lng, 103.8981);
});

test('OneMap failure does not produce a false verified state', async () => {
  await assert.rejects(
    verifyLocationQuery('263 Compassvale Street', {
      searchCandidates: async () => {
        throw new Error('upstream details must not escape');
      }
    }),
    (error) => (
      error instanceof LocationVerificationError
      && error.code === 'location_service_unavailable'
      && !error.message.includes('upstream details')
    )
  );
});

test('repeated verification requests cannot let an older result overwrite the latest search', () => {
  const state = createVerificationState();
  const firstQuery = '263 Compassvale Street';
  const secondQuery = '730768';
  const firstRequest = state.beginSearch(firstQuery);
  const secondRequest = state.beginSearch(secondQuery);

  assert.equal(state.verify(firstRequest, firstQuery, candidate()), false);
  assert.equal(state.verify(secondRequest, secondQuery, candidate({
    postalCode: '730768'
  })), true);
  assert.equal(state.getSnapshot().query, secondQuery);
  assert.equal(state.getSnapshot().verifiedLocation.postalCode, '730768');
});

test('a lone weak geocoder result still requires explicit confirmation', async () => {
  const result = await verifyLocationQuery('Changi Airport', {
    searchCandidates: async () => [candidate({
      name: 'CHANGI BUSINESS PARK',
      address: '1 CHANGI SOUTH STREET 2 SINGAPORE 486760',
      postalCode: '486760'
    })]
  });

  assert.equal(result.verified, false);
  assert.equal(result.requiresSelection, true);
  assert.equal(result.candidates.length, 1);
});

test('OneMap results are normalized, Singapore-bounded, and deduplicated', () => {
  const results = geocodingInternals.getValidResultCandidates({
    results: [
      {
        SEARCHVAL: '263 COMPASSVALE STREET',
        ADDRESS: '263 COMPASSVALE STREET SINGAPORE 540263',
        POSTAL: '540263',
        LATITUDE: '1.3901',
        LONGITUDE: '103.8981'
      },
      {
        SEARCHVAL: 'DUPLICATE',
        ADDRESS: '263 COMPASSVALE STREET SINGAPORE 540263',
        POSTAL: '540263',
        LATITUDE: '1.3901',
        LONGITUDE: '103.8981'
      },
      {
        SEARCHVAL: 'OUTSIDE SINGAPORE',
        ADDRESS: 'INVALID RESULT',
        POSTAL: '000000',
        LATITUDE: '51.5072',
        LONGITUDE: '-0.1276'
      }
    ]
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, '263 COMPASSVALE STREET');
  assert.equal(results[0].address, '263 COMPASSVALE STREET SINGAPORE 540263');
  assert.equal(results[0].latitude, 1.3901);
  assert.equal(results[0].longitude, 103.8981);
});
