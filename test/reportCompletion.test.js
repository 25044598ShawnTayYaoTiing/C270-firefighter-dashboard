const test = require('node:test');
const assert = require('node:assert/strict');

const incidentModel = require('../models/incidentModel');
const incidentController = require('../controllers/incidentController');
const { calculateCompletion } = require('../helpers/incidentPresenter');
const {
  recordLocationVerification
} = require('../helpers/locationVerificationTrust');

function completeReport(overrides = {}) {
  return {
    location: 'Block 10, Example Street',
    locationVerified: true,
    type: 'Residential Fire',
    dateTime: '2026-07-22T10:00',
    status: 'Pending Review',
    summary: 'Smoke reported from a residential unit.',
    hazards: 'No hazards reported',
    injured: 'No injured or trapped persons reported',
    ...overrides
  };
}

function requestFor(body = {}) {
  const requestBody = {
    incidentLocation: 'Block 10, Example Street',
    incidentType: 'Residential Fire',
    incidentDateTime: '2026-07-22T10:00',
    responseStatus: 'Pending Review',
    incidentSummary: 'Smoke reported from a residential unit.',
    hazards: 'No hazards reported',
    injuredPersons: 'No injured or trapped persons reported',
    latitude: '1.3404',
    longitude: '103.7090',
    locationVerified: 'true',
    ...body
  };
  const session = {
    officer_id: 99
  };

  if (requestBody.incidentLocation) {
    recordLocationVerification(session, requestBody.incidentLocation, {
      verified: true,
      verifiedLocation: {
        address: requestBody.incidentLocation,
        latitude: 1.3404,
        longitude: 103.709,
        source: 'onemap'
      }
    });
  }

  return {
    body: requestBody,
    currentOfficer: {
      officer_id: 99,
      officer_role: 'Normal Officer'
    },
    session
  };
}

function response() {
  return {
    statusCode: 200,
    renderedData: null,
    redirectUrl: '',
    status(value) {
      this.statusCode = value;
      return this;
    },
    render(view, data) {
      this.renderedData = { view, ...data };
      return this;
    },
    redirect(value) {
      this.redirectUrl = value;
      return this;
    }
  };
}

test('completion excludes transcript, officer, missing information, and notes', () => {
  const completion = calculateCompletion(completeReport());

  assert.equal(completion.percent, 100);
  assert.deepEqual(completion.missingFields, []);
  assert.match(completion.message, /complete and ready/i);
});

test('an empty report has zero completion and only report requirements are missing', () => {
  const completion = calculateCompletion();

  assert.equal(completion.percent, 0);
  assert.deepEqual(completion.missingFields, [
    'Incident Location',
    'Location Verification',
    'Incident Type',
    'Date and Time',
    'Response Status',
    'Incident Summary',
    'Hazards',
    'Injured or Trapped Persons'
  ]);
});

test('completion distinguishes an entered location from location verification', () => {
  const completion = calculateCompletion(completeReport({ locationVerified: false }));

  assert.equal(completion.percent, 88);
  assert.deepEqual(completion.missingFields, ['Location Verification']);
});

test('completion uses deterministic status messages for each progress band', () => {
  const partiallyComplete = calculateCompletion({
    location: 'Block 10, Example Street',
    type: 'Residential Fire',
    dateTime: '2026-07-22T10:00',
    status: 'Pending Review'
  });
  const almostComplete = calculateCompletion({
    location: 'Block 10, Example Street',
    locationVerified: true,
    type: 'Residential Fire',
    dateTime: '2026-07-22T10:00',
    status: 'Pending Review',
    summary: 'Smoke reported from a residential unit.',
    hazards: 'Smoke'
  });

  assert.equal(partiallyComplete.percent, 50);
  assert.match(partiallyComplete.message, /partially complete/i);
  assert.equal(almostComplete.percent, 88);
  assert.match(almostComplete.message, /almost complete/i);
});

test('conditional hazard and casualty fields accept actual details', () => {
  const completion = calculateCompletion(completeReport({
    hazards: 'Gas cylinder leaking near the kitchen.',
    injured: 'One adult with a minor burn.'
  }));

  assert.equal(completion.percent, 100);
});

test('Save Draft allows incomplete fields and stores Draft status', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-DRAFT';
  };

  try {
    const res = response();
    await incidentController.createIncident(requestFor({
      saveMode: 'draft',
      incidentLocation: '',
      incidentType: '',
      incidentDateTime: '',
      incidentSummary: '',
      hazards: '',
      injuredPersons: '',
      latitude: '',
      longitude: '',
      locationVerified: ''
    }), res, assert.fail);

    assert.equal(res.redirectUrl, '/incidents/INC-DRAFT?reportSaved=1');
    assert.equal(savedIncident.responseStatus, 'Draft');
    assert.equal(savedIncident.incidentLocation, '');
    assert.ok(savedIncident.incidentDateTime);
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('Save Report rejects unresolved conditional fields before saving', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let createCalled = false;
  incidentModel.createIncident = async () => {
    createCalled = true;
  };

  try {
    const res = response();
    await incidentController.createIncident(requestFor({
      hazards: '',
      injuredPersons: ''
    }), res, assert.fail);

    assert.equal(createCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.renderedData.validationErrors.hazards, 'Confirm that no hazards were reported or enter the hazard details.');
    assert.equal(res.renderedData.validationErrors.injuredPersons, 'Confirm that no injured or trapped persons were reported or enter the details.');
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('Save Report treats explicit no-report checkboxes as completed conditional fields', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-CHECKED';
  };

  try {
    const res = response();
    await incidentController.createIncident(requestFor({
      hazards: '',
      injuredPersons: '',
      noHazardsReported: 'true',
      noInjuredPersonsReported: 'true'
    }), res, assert.fail);

    assert.equal(res.redirectUrl, '/incidents/INC-CHECKED?reportSaved=1');
    assert.equal(savedIncident.hazards, 'No hazards reported');
    assert.equal(savedIncident.injuredPersons, 'No injured or trapped persons reported');
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});
