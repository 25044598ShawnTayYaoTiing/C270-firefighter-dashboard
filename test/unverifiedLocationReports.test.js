const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const incidentController = require('../controllers/incidentController');
const pageController = require('../controllers/pageController');
const incidentModel = require('../models/incidentModel');
const {
  LOCATION_VERIFICATION_STATUSES
} = require('../config/locationVerification');
const {
  recordLocationVerification,
  resolveTrustedLocation,
  _private: trustInternals
} = require('../helpers/locationVerificationTrust');
const { ROLES } = require('../middleware/rolePermissions');

function completeBody(overrides = {}) {
  return {
    incidentLocation: '263 Compassvale Street',
    incidentType: 'Residential Fire',
    incidentDateTime: '2026-07-31T10:00',
    responseStatus: 'Pending Review',
    incidentSummary: 'Smoke reported from a residential unit.',
    hazards: 'No hazards reported',
    injuredPersons: 'No injured or trapped persons reported',
    latitude: '1.3901',
    longitude: '103.8981',
    locationVerified: 'true',
    ...overrides
  };
}

function requestFor(role = ROLES.NORMAL, body = {}, options = {}) {
  const requestBody = completeBody(body);
  const session = { officer_id: 99 };

  if (options.trusted) {
    recordLocationVerification(session, requestBody.incidentLocation, {
      verified: true,
      verifiedLocation: {
        address: '263 COMPASSVALE STREET SINGAPORE 540263',
        latitude: 1.3901,
        longitude: 103.8981,
        source: 'onemap'
      }
    });
  }

  return {
    body: requestBody,
    currentOfficer: {
      officer_id: 99,
      officer_role: role
    },
    params: { incidentId: 'INC-REVIEW' },
    query: {},
    session
  };
}

function response() {
  return {
    body: null,
    redirectUrl: '',
    renderedData: null,
    statusCode: 200,
    json(value) {
      this.body = value;
      return this;
    },
    redirect(value) {
      this.redirectUrl = value;
      return this;
    },
    render(view, data) {
      this.renderedData = { template: view, ...data };
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    }
  };
}

function storedIncident(overrides = {}) {
  return {
    incident_id: 'INC-REVIEW',
    reporting_officer_id: 99,
    officer_name: 'Test Officer',
    officer_role: ROLES.NORMAL,
    incident_type: 'Residential Fire',
    location: '263 Compassvale Street',
    incident_datetime: new Date('2026-07-31T10:00:00+08:00'),
    incident_summary: 'Smoke reported from a residential unit.',
    hazards: 'No hazards reported',
    injured_or_trapped_persons: 'No injured or trapped persons reported',
    response_status: 'Pending Review',
    missing_information: null,
    officer_notes: null,
    transcript: null,
    latitude: null,
    longitude: null,
    location_verification_status: LOCATION_VERIFICATION_STATUSES.UNVERIFIED,
    ...overrides
  };
}

test('server trust accepts only coordinates returned by the verified location session', () => {
  const session = {};
  recordLocationVerification(session, '263 Compassvale Street', {
    verified: true,
    verifiedLocation: {
      address: '263 COMPASSVALE STREET SINGAPORE 540263',
      latitude: 1.3901,
      longitude: 103.8981,
      source: 'onemap'
    }
  }, 1000);

  const trusted = resolveTrustedLocation(session, completeBody(), 1001);
  const forged = resolveTrustedLocation(session, completeBody({
    latitude: '1.3000',
    longitude: '103.8000'
  }), 1001);
  const expired = resolveTrustedLocation(
    session,
    completeBody(),
    1000 + trustInternals.VERIFICATION_TTL_MS + 1
  );

  assert.equal(trusted.locationVerificationStatus, LOCATION_VERIFICATION_STATUSES.VERIFIED);
  assert.equal(trusted.latitude, 1.3901);
  assert.equal(forged, null);
  assert.equal(expired, null);
});

test('verified create uses server-trusted coordinates rather than the browser flag', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-VERIFIED';
  };

  try {
    const req = requestFor(ROLES.NORMAL, { locationVerified: '' }, { trusted: true });
    const res = response();
    await incidentController.createIncident(req, res, assert.fail);

    assert.equal(savedIncident.locationVerificationStatus, LOCATION_VERIFICATION_STATUSES.VERIFIED);
    assert.equal(savedIncident.latitude, 1.3901);
    assert.equal(savedIncident.longitude, 103.8981);
    assert.equal(savedIncident.locationVerificationSource, 'onemap');
    assert.equal(res.redirectUrl, '/incidents/INC-VERIFIED?reportSaved=1');
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('failed location with acknowledgement saves the original text as UNVERIFIED', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-ACKNOWLEDGED-UNVERIFIED';
  };

  try {
    const originalLocation = 'Unverified access road near Station 4';
    const req = requestFor(ROLES.NORMAL, {
      incidentLocation: originalLocation,
      latitude: '',
      longitude: '',
      locationVerified: '',
      unverifiedLocationAcknowledged: 'true'
    });
    const res = response();
    await incidentController.createIncident(req, res, assert.fail);

    assert.equal(savedIncident.incidentLocation, originalLocation);
    assert.equal(savedIncident.locationVerificationStatus, LOCATION_VERIFICATION_STATUSES.UNVERIFIED);
    assert.equal(savedIncident.latitude, '');
    assert.equal(savedIncident.longitude, '');
    assert.equal(res.redirectUrl, '/incidents?unverifiedSubmitted=1');
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('forged browser verification is saved UNVERIFIED only after acknowledgement', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-UNVERIFIED';
  };

  try {
    const originalLocation = 'Unmapped access road near Pump Station 4';
    const req = requestFor(ROLES.NORMAL, {
      incidentLocation: originalLocation,
      latitude: '1.3333',
      longitude: '103.8888',
      locationVerified: 'true',
      unverifiedLocationAcknowledged: 'true'
    });
    const res = response();
    await incidentController.createIncident(req, res, assert.fail);

    assert.equal(savedIncident.incidentLocation, originalLocation);
    assert.equal(savedIncident.locationVerificationStatus, LOCATION_VERIFICATION_STATUSES.UNVERIFIED);
    assert.equal(savedIncident.locationVerified, false);
    assert.equal(savedIncident.latitude, '');
    assert.equal(savedIncident.longitude, '');
    assert.equal(res.redirectUrl, '/incidents?unverifiedSubmitted=1');
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('unverified create is rejected when acknowledgement is cancelled or absent', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let createCalled = false;
  incidentModel.createIncident = async () => {
    createCalled = true;
  };

  try {
    const res = response();
    await incidentController.createIncident(requestFor(), res, assert.fail);

    assert.equal(createCalled, false);
    assert.equal(res.statusCode, 400);
    assert.match(
      res.renderedData.validationErrors.unverifiedLocationAcknowledged,
      /confirm/i
    );
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('mandatory report fields remain required for acknowledged unverified reports', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let createCalled = false;
  incidentModel.createIncident = async () => {
    createCalled = true;
  };

  try {
    const res = response();
    await incidentController.createIncident(requestFor(ROLES.NORMAL, {
      incidentSummary: '   ',
      unverifiedLocationAcknowledged: 'true'
    }), res, assert.fail);

    assert.equal(createCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(
      res.renderedData.validationErrors.incidentSummary,
      'Incident description cannot be empty.'
    );
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('Higher Rank/Admin can verify and promote an UNVERIFIED report', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const originalUpdate = incidentModel.updateIncident;
  let lookupOptions;
  let savedIncident;
  incidentModel.getIncidentByIncidentId = async (id, options) => {
    lookupOptions = options;
    return storedIncident();
  };
  incidentModel.updateIncident = async (id, incident) => {
    savedIncident = incident;
    return true;
  };

  try {
    const req = requestFor(ROLES.ADMIN, {}, { trusted: true });
    const res = response();
    await incidentController.updateIncident(req, res, assert.fail);

    assert.deepEqual(lookupOptions, { includeUnverified: true });
    assert.equal(savedIncident.locationVerificationStatus, LOCATION_VERIFICATION_STATUSES.VERIFIED);
    assert.equal(savedIncident.latitude, 1.3901);
    assert.equal(res.redirectUrl, '/incidents/INC-REVIEW');
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
    incidentModel.updateIncident = originalUpdate;
  }
});

test('failed re-verification keeps an admin-reviewed report UNVERIFIED', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const originalUpdate = incidentModel.updateIncident;
  let savedIncident;
  incidentModel.getIncidentByIncidentId = async () => storedIncident();
  incidentModel.updateIncident = async (id, incident) => {
    savedIncident = incident;
    return true;
  };

  try {
    const req = requestFor(ROLES.ADMIN, {
      unverifiedLocationAcknowledged: 'true'
    });
    const res = response();
    await incidentController.updateIncident(req, res, assert.fail);

    assert.equal(savedIncident.locationVerificationStatus, LOCATION_VERIFICATION_STATUSES.UNVERIFIED);
    assert.equal(savedIncident.latitude, '');
    assert.equal(savedIncident.longitude, '');
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
    incidentModel.updateIncident = originalUpdate;
  }
});

test('operational model queries bind VERIFIED by default and admin review opts in explicitly', () => {
  const operational = incidentModel._private.buildIncidentWhere({
    status: 'Pending Review',
    search: "%' OR 1=1 --"
  });
  const review = incidentModel._private.buildIncidentWhere({ includeUnverified: true });
  const ownDrafts = incidentModel._private.buildIncidentWhere({
    includeOwnDraftsForOfficerId: 99
  });

  assert.match(operational.where[0], /location_verification_status = \?/);
  assert.equal(operational.params[0], LOCATION_VERIFICATION_STATUSES.VERIFIED);
  assert.ok(operational.params.includes("%%' OR 1=1 --%"));
  assert.equal(review.where.length, 0);
  assert.match(ownDrafts.where[0], /response_status = 'Draft'/);
  assert.deepEqual(ownDrafts.params, [LOCATION_VERIFICATION_STATUSES.VERIFIED, 99]);
});

test('firefighter incidents API removes UNVERIFIED rows even if a data source returns one', { concurrency: false }, async () => {
  const originalGetAll = incidentModel.getAllIncidents;
  let queryOptions;
  incidentModel.getAllIncidents = async (options) => {
    queryOptions = options;
    return [
      storedIncident(),
      storedIncident({
        incident_id: 'INC-VERIFIED',
        location_verification_status: LOCATION_VERIFICATION_STATUSES.VERIFIED,
        latitude: 1.3901,
        longitude: 103.8981
      })
    ];
  };

  try {
    const res = response();
    await incidentController.getIncidentsApi({ query: {} }, res, assert.fail);

    assert.equal(queryOptions.includeUnverified, undefined);
    assert.deepEqual(res.body.reports.map((report) => report.id), ['INC-VERIFIED']);
  } finally {
    incidentModel.getAllIncidents = originalGetAll;
  }
});

test('normal officers cannot retrieve a final UNVERIFIED report while admin review can', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const seenOptions = [];
  incidentModel.getIncidentByIncidentId = async (id, options) => {
    seenOptions.push(options);
    return options.includeUnverified ? storedIncident() : null;
  };

  try {
    const normalResponse = response();
    await incidentController.showReportDetails(
      requestFor(ROLES.NORMAL),
      normalResponse,
      assert.fail
    );
    const adminResponse = response();
    await incidentController.showReportDetails(
      requestFor(ROLES.ADMIN),
      adminResponse,
      assert.fail
    );

    assert.equal(normalResponse.statusCode, 404);
    assert.deepEqual(seenOptions[0], { includeOwnDraftsForOfficerId: 99 });
    assert.deepEqual(seenOptions[1], { includeUnverified: true });
    assert.equal(adminResponse.renderedData.report.locationVerificationStatus, 'UNVERIFIED');
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
  }
});

test('Higher Rank/Admin incident review list includes UNVERIFIED reports', { concurrency: false }, async () => {
  const originalGetAll = incidentModel.getAllIncidents;
  const seenOptions = [];
  incidentModel.getAllIncidents = async (options) => {
    seenOptions.push(options);
    return options.includeUnverified ? [storedIncident()] : [];
  };

  try {
    const req = requestFor(ROLES.ADMIN);
    const res = response();
    await incidentController.showIncidents(req, res, assert.fail);

    assert.equal(seenOptions.length, 2);
    assert.equal(seenOptions.every((options) => options.includeUnverified === true), true);
    assert.deepEqual(res.renderedData.reports.map((report) => report.id), ['INC-REVIEW']);
    assert.equal(res.renderedData.canReviewUnverifiedLocations, true);
  } finally {
    incidentModel.getAllIncidents = originalGetAll;
  }
});

test('normal officers cannot update a final UNVERIFIED report through a direct POST', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const originalUpdate = incidentModel.updateIncident;
  let updateCalled = false;
  incidentModel.getIncidentByIncidentId = async (id, options) => (
    options.includeUnverified ? storedIncident() : null
  );
  incidentModel.updateIncident = async () => {
    updateCalled = true;
  };

  try {
    const res = response();
    await incidentController.updateIncident(requestFor(ROLES.NORMAL), res, assert.fail);

    assert.equal(res.statusCode, 404);
    assert.equal(updateCalled, false);
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
    incidentModel.updateIncident = originalUpdate;
  }
});

test('dashboard and analytics exclude UNVERIFIED rows from totals and location intelligence', { concurrency: false }, async () => {
  const originalGetAll = incidentModel.getAllIncidents;
  incidentModel.getAllIncidents = async () => [
    storedIncident(),
    storedIncident({
      incident_id: 'INC-VERIFIED',
      location_verification_status: LOCATION_VERIFICATION_STATUSES.VERIFIED,
      latitude: 1.3901,
      longitude: 103.8981
    })
  ];

  try {
    const dashboardResponse = response();
    await pageController.showDashboard({}, dashboardResponse, assert.fail);
    const analyticsResponse = response();
    await pageController.showAnalytics({}, analyticsResponse, assert.fail);

    assert.equal(dashboardResponse.renderedData.summaryCards[0].value, 1);
    assert.equal(dashboardResponse.renderedData.incidentMapData.incidents.length, 1);
    assert.equal(dashboardResponse.renderedData.incidentMapData.markers.length, 1);
    assert.equal(analyticsResponse.renderedData.metricCards[0].value, 1);
    assert.equal(analyticsResponse.renderedData.locations[0].count, 1);
  } finally {
    incidentModel.getAllIncidents = originalGetAll;
  }
});

test('Create Report exposes an accessible unverified warning and acknowledgement control', () => {
  const createReport = fs.readFileSync(
    path.join(__dirname, '..', 'views', 'create-report.ejs'),
    'utf8'
  );
  const formScript = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'incidentFormQuality.js'),
    'utf8'
  );

  assert.match(createReport, /id="unverifiedLocationWarning" role="status" aria-live="polite"/);
  assert.match(createReport, /name="unverifiedLocationAcknowledged"/);
  assert.match(createReport, /will not appear on the firefighter dashboard/i);
  assert.match(formScript, /getSubmissionLocationDecision/);
  assert.match(formScript, /submissionGuard\.tryLock\(\)/);
});

test('acknowledged unverified submission clears the stale location error before submit', () => {
  const formScript = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'incidentFormQuality.js'),
    'utf8'
  );

  assert.match(
    formScript,
    /if \(controls\.unverifiedAcknowledgement\.checked\) \{[\s\S]*?clearFieldError\('unverifiedLocationAcknowledged'\);[\s\S]*?clearFieldError\('incidentLocation'\);/
  );
  assert.match(
    formScript,
    /if \(decision\.status === locationVerification\.STATES\.UNVERIFIED\)[\s\S]*?if \(!decision\.allowed\) \{[\s\S]*?return false;[\s\S]*?\}[\s\S]*?clearFieldError\('incidentLocation'\);[\s\S]*?clearFieldError\('unverifiedLocationAcknowledged'\);[\s\S]*?return true;/
  );
});
