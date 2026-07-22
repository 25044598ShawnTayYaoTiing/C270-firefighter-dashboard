const test = require('node:test');
const assert = require('node:assert/strict');
const incidentModel = require('../models/incidentModel');
const incidentController = require('../controllers/incidentController');
const aiController = require('../controllers/aiController');
const geminiService = require('../services/geminiService');
const { ROLES } = require('../middleware/rolePermissions');

const submittedBackdate = '2001-01-01T01:01';

function requestFor(role, body = {}) {
  return {
    body: {
      incidentLocation: 'Test location',
      incidentType: 'Test incident',
      incidentDateTime: submittedBackdate,
      responseStatus: 'Pending Review',
      incidentSummary: 'Permission test',
      hazards: 'No hazards reported',
      injuredPersons: 'No injured or trapped persons reported',
      latitude: '1.3404',
      longitude: '103.7090',
      locationVerified: 'true',
      ...body
    },
    currentOfficer: {
      officer_id: 99,
      officer_role: role
    },
    session: {
      officer_id: 99
    },
    params: {
      incidentId: 'INC-TEST'
    }
  };
}

function redirectResponse() {
  return {
    redirectUrl: '',
    redirect(value) {
      this.redirectUrl = value;
      return this;
    }
  };
}

function validationResponse() {
  return {
    statusCode: 200,
    renderedView: '',
    renderedData: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    render(view, data) {
      this.renderedView = data.view;
      this.renderedData = data;
      return this;
    }
  };
}

test('normal officer create ignores a manually submitted backdate', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-TEST';
  };

  try {
    await incidentController.createIncident(requestFor(ROLES.NORMAL), redirectResponse(), assert.fail);
    assert.notEqual(savedIncident.incidentDateTime, submittedBackdate);
    assert.ok(Date.now() - new Date(savedIncident.incidentDateTime).getTime() < 5000);
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('HR create also ignores a manually submitted backdate', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-TEST';
  };

  try {
    await incidentController.createIncident(requestFor(ROLES.HR), redirectResponse(), assert.fail);
    assert.notEqual(savedIncident.incidentDateTime, submittedBackdate);
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('admin create accepts an explicitly supplied valid backdate', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let savedIncident;
  incidentModel.createIncident = async (incident) => {
    savedIncident = incident;
    return 'INC-TEST';
  };

  try {
    await incidentController.createIncident(requestFor(ROLES.ADMIN), redirectResponse(), assert.fail);
    assert.equal(savedIncident.incidentDateTime, submittedBackdate);
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('normal officer edit preserves the stored incident date', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const originalUpdate = incidentModel.updateIncident;
  const storedDate = new Date('2024-05-06T07:08:00');
  let savedIncident;
  incidentModel.getIncidentByIncidentId = async () => ({
    reporting_officer_id: 7,
    incident_datetime: storedDate
  });
  incidentModel.updateIncident = async (id, incident) => {
    savedIncident = incident;
    return true;
  };

  try {
    await incidentController.updateIncident(requestFor(ROLES.NORMAL), redirectResponse(), assert.fail);
    assert.equal(savedIncident.incidentDateTime, storedDate);
    assert.equal(savedIncident.reportingOfficerId, 7);
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
    incidentModel.updateIncident = originalUpdate;
  }
});

test('admin edit accepts an explicitly supplied historical date', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const originalUpdate = incidentModel.updateIncident;
  let savedIncident;
  incidentModel.getIncidentByIncidentId = async () => ({
    reporting_officer_id: 7,
    incident_datetime: new Date()
  });
  incidentModel.updateIncident = async (id, incident) => {
    savedIncident = incident;
    return true;
  };

  try {
    await incidentController.updateIncident(requestFor(ROLES.ADMIN), redirectResponse(), assert.fail);
    assert.equal(savedIncident.incidentDateTime, submittedBackdate);
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
    incidentModel.updateIncident = originalUpdate;
  }
});

test('AI draft responses cannot supply the incident timestamp', { concurrency: false }, async () => {
  const originalGenerate = geminiService.generateReport;
  let responseBody;
  geminiService.generateReport = async () => ({
    incident_type: 'Test Incident',
    incident_datetime: submittedBackdate
  });

  try {
    await aiController.generateReport({ body: { transcript: 'Test emergency transcript' } }, {
      json(value) {
        responseBody = value;
        return this;
      }
    });
    assert.equal(responseBody.success, true);
    assert.equal(responseBody.report.incident_datetime, '');
  } finally {
    geminiService.generateReport = originalGenerate;
  }
});

test('create rejects whitespace-only mandatory fields before saving', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let createCalled = false;
  incidentModel.createIncident = async () => {
    createCalled = true;
  };
  const res = validationResponse();

  try {
    await incidentController.createIncident(requestFor(ROLES.NORMAL, {
      incidentType: '   '
    }), res, assert.fail);

    assert.equal(createCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.renderedView, 'create-report');
    assert.equal(res.renderedData.validationErrors.incidentType, 'Incident type is required.');
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('create rejects unverified or invalid coordinates before saving', { concurrency: false }, async () => {
  const originalCreate = incidentModel.createIncident;
  let createCalled = false;
  incidentModel.createIncident = async () => {
    createCalled = true;
  };
  const res = validationResponse();

  try {
    await incidentController.createIncident(requestFor(ROLES.NORMAL, {
      latitude: '95',
      longitude: '103.7090',
      locationVerified: 'true'
    }), res, assert.fail);

    assert.equal(createCalled, false);
    assert.equal(res.statusCode, 400);
    assert.match(res.renderedData.validationErrors.incidentLocation, /Latitude must be between -90 and 90/);
  } finally {
    incidentModel.createIncident = originalCreate;
  }
});

test('edit rejects invalid admin incident dates before saving', { concurrency: false }, async () => {
  const originalGet = incidentModel.getIncidentByIncidentId;
  const originalUpdate = incidentModel.updateIncident;
  let updateCalled = false;
  incidentModel.getIncidentByIncidentId = async () => ({
    incident_id: 'INC-TEST',
    incident_type: 'Residential Fire',
    location: 'Jurong West Street 42',
    incident_datetime: new Date('2026-06-25T09:20:00'),
    incident_summary: 'Stored summary',
    response_status: 'Pending Review',
    reporting_officer_id: 7,
    latitude: 1.3404,
    longitude: 103.709
  });
  incidentModel.updateIncident = async () => {
    updateCalled = true;
  };
  const res = validationResponse();

  try {
    await incidentController.updateIncident(requestFor(ROLES.ADMIN, {
      incidentDateTime: 'not-a-date'
    }), res, assert.fail);

    assert.equal(updateCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.renderedView, 'edit-report');
    assert.equal(res.renderedData.validationErrors.incidentDateTime, 'Enter a valid incident date and time.');
  } finally {
    incidentModel.getIncidentByIncidentId = originalGet;
    incidentModel.updateIncident = originalUpdate;
  }
});
