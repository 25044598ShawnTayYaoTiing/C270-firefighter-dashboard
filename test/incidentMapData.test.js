const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMapData,
  mapIncident
} = require('../helpers/incidentPresenter');
const {
  LOCATION_VERIFICATION_STATUSES
} = require('../config/locationVerification');

function report(overrides = {}) {
  return {
    id: 'INC-TEST',
    incident_id: 'INC-TEST',
    type: 'Residential Fire',
    incident_type: 'Residential Fire',
    location: 'Jurong West Street 42',
    status: 'Pending Review',
    response_status: 'Pending Review',
    dateInput: '2026-06-25T09:20',
    incident_summary: 'Smoke reported.',
    summary: 'Smoke reported.',
    transcript: 'Smoke at Jurong West.',
    latitude: 1.3404,
    longitude: 103.709,
    ...overrides
  };
}

test('map data keeps only active incidents with real coordinates as markers', async () => {
  const mapData = await buildMapData([
    report(),
    report({
      id: 'INC-NO-COORDS',
      incident_id: 'INC-NO-COORDS',
      latitude: null,
      longitude: null
    }),
    report({
      id: 'INC-COMPLETED',
      incident_id: 'INC-COMPLETED',
      response_status: 'Completed',
      status: 'Completed'
    }),
    report({
      id: 'INC-UNVERIFIED',
      incident_id: 'INC-UNVERIFIED',
      location_verification_status: LOCATION_VERIFICATION_STATUSES.UNVERIFIED
    })
  ]);

  assert.equal(mapData.markers.length, 1);
  assert.equal(mapData.unmapped.length, 1);
  assert.equal(mapData.completedHidden, 1);
  assert.equal(mapData.markers[0].latitude, 1.3404);
  assert.equal(mapData.markers[0].longitude, 103.709);
  assert.equal(mapData.markers[0].incident_date, '2026-06-25');
  assert.equal(mapData.unmapped[0].incident_id, 'INC-NO-COORDS');
  assert.equal(mapData.incidents.some((incident) => incident.incident_id === 'INC-UNVERIFIED'), false);
});

test('a newly verified report enters map and heatmap source data', async () => {
  const mapData = await buildMapData([
    report({
      id: 'INC-REVIEWED',
      incident_id: 'INC-REVIEWED',
      location_verification_status: LOCATION_VERIFICATION_STATUSES.VERIFIED
    })
  ]);

  assert.deepEqual(mapData.incidents.map((incident) => incident.incident_id), ['INC-REVIEWED']);
  assert.deepEqual(mapData.markers.map((incident) => incident.incident_id), ['INC-REVIEWED']);
});

test('draft coordinates do not count as verified location completion', () => {
  const draft = mapIncident(report({
    response_status: 'Draft',
    status: 'Draft'
  }));

  assert.ok(draft.completion.missingFields.includes('Location Verification'));
});
