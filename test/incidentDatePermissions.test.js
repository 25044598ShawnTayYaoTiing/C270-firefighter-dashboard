const test = require('node:test');
const assert = require('node:assert/strict');
const incidentModel = require('../models/incidentModel');
const incidentController = require('../controllers/incidentController');
const aiController = require('../controllers/aiController');
const ollamaService = require('../services/ollamaService');
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
  const originalGenerate = ollamaService.generateReport;
  let responseBody;
  ollamaService.generateReport = async () => ({
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
    ollamaService.generateReport = originalGenerate;
  }
});
