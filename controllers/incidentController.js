// done by Thein 25040396
// AI Features: incidentController.js manages incident report operations, including creation, editing, viewing, and deletion, with proper access control and data normalization.
const incidentModel = require('../models/incidentModel');
const {
  resolveIncidentCoordinates
} = require('../helpers/geocodingService');
const {
  calculateCompletion,
  mapIncident,
  statusKey
} = require('../helpers/incidentPresenter');
const {
  validateCoordinatePair
} = require('../helpers/locationResolver');
const {
  PERMISSIONS,
  hasPermission
} = require('../middleware/rolePermissions');

const statuses = ['Draft', 'Pending Review', 'Completed', 'Escalated'];
const incidentTypes = [
  'Residential Fire',
  'Kitchen Fire',
  'Road Traffic Accident',
  'Lift Rescue',
  'Gas Leak',
  'Electrical Fire',
  'Rubbish Chute Fire',
  'Vehicle Fire'
];

function renderPage(res, view, options) {
  res.render('layout', {
    view,
    appName: 'Firefighter Incident Command',
    pageTitle: 'Dashboard',
    activePage: 'dashboard',
    statuses,
    statusKey,
    ...options
  });
}

function toReportingOfficerId(value) {
  const officerId = Number(value);

  return Number.isInteger(officerId) && officerId > 0 ? officerId : null;
}

function getSessionOfficerId(req) {
  return toReportingOfficerId(req.session ? req.session.officer_id : null);
}

function canManageIncidentDateTime(req) {
  return Boolean(req.currentOfficer && hasPermission(
    req.currentOfficer.officer_role,
    PERMISSIONS.MANAGE_INCIDENT_DATETIME
  ));
}

function getServerDateTime() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDateTimeInput(value) {
  if (!value) return '';

  if (value instanceof Date) {
    const pad = (part) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      + `T${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  return String(value).replace(' ', 'T').slice(0, 16);
}

function getAuthorizedCreateDateTime(req) {
  if (canManageIncidentDateTime(req)) {
    return req.body.incidentDateTime || (req.body.saveMode === 'draft' ? getServerDateTime() : '');
  }

  return getServerDateTime();
}

function isValidIncidentDateTime(value) {
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime());
  }

  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)
    && !Number.isNaN(new Date(text).getTime());
}

function hasText(value) {
  return String(value || '').trim().length > 0;
}

function readIncidentForm(body, options = {}) {
  const responseStatus = body.saveMode === 'draft'
    ? 'Draft'
    : body.responseStatus;

  // The controller normalizes form field names before handing data to the model.
  return {
    reportingOfficerId: options.reportingOfficerId !== undefined
      ? toReportingOfficerId(options.reportingOfficerId)
      : toReportingOfficerId(body.reportingOfficerId),
    incidentLocation: body.incidentLocation ? body.incidentLocation.trim() : '',
    incidentType: body.incidentType ? body.incidentType.trim() : '',
    incidentDateTime: options.incidentDateTime !== undefined
      ? options.incidentDateTime
      : body.incidentDateTime || '',
    responseStatus: responseStatus || 'Pending Review',
    incidentSummary: body.incidentSummary ? body.incidentSummary.trim() : '',
    hazards: body.hazards ? body.hazards.trim() : '',
    injuredPersons: body.injuredPersons ? body.injuredPersons.trim() : '',
    missingInfo: body.missingInfo ? body.missingInfo.trim() : '',
    officerNotes: body.officerNotes ? body.officerNotes.trim() : '',
    transcript: body.transcript ? body.transcript.trim() : '',
    latitude: body.latitude || '',
    longitude: body.longitude || '',
    locationVerified: String(body.locationVerified || '').toLowerCase() === 'true',
    locationVerificationSource: body.locationVerificationSource
      ? body.locationVerificationSource.trim()
      : '',
    verifiedLocationLabel: body.verifiedLocationLabel
      ? body.verifiedLocationLabel.trim()
      : ''
  };
}

function buildFormData(incident = {}) {
  return {
    reportingOfficerId: incident.reportingOfficerId || '',
    transcript: incident.transcript || '',
    incidentType: incident.incidentType || '',
    customIncidentType: incident.customIncidentType || '',
    incidentLocation: incident.incidentLocation || '',
    incidentDateTime: toDateTimeInput(incident.incidentDateTime),
    responseStatus: incident.responseStatus || 'Pending Review',
    incidentSummary: incident.incidentSummary || '',
    hazards: incident.hazards || '',
    injuredPersons: incident.injuredPersons || '',
    missingInfo: incident.missingInfo || '',
    officerNotes: incident.officerNotes || '',
    latitude: incident.latitude || '',
    longitude: incident.longitude || '',
    locationVerified: incident.locationVerified ? 'true' : '',
    locationVerificationSource: incident.locationVerificationSource || '',
    verifiedLocationLabel: incident.verifiedLocationLabel || ''
  };
}

function buildCreateCompletion(req, formData = {}) {
  return calculateCompletion({
    location: formData.incidentLocation,
    locationVerified: formData.locationVerified,
    type: formData.incidentType,
    dateTime: formData.incidentDateTime || getServerDateTime(),
    summary: formData.incidentSummary,
    hazards: formData.hazards,
    injured: formData.injuredPersons,
    status: formData.responseStatus || 'Pending Review'
  });
}

function buildEditFormData(report) {
  return {
    reportingOfficerId: report.reportingOfficerId || '',
    transcript: report.transcriptInput || '',
    incidentType: report.type || '',
    incidentLocation: report.location || '',
    incidentDateTime: report.dateInput || '',
    responseStatus: report.status || 'Pending Review',
    incidentSummary: report.summary || '',
    hazards: report.hazards === 'None.' ? '' : report.hazards || '',
    injuredPersons: report.injured === 'No injured or trapped persons reported.' ? '' : report.injured || '',
    missingInfo: report.missingInfo === 'None.' ? '' : report.missingInfo || '',
    officerNotes: report.officerNotes === 'None.' ? '' : report.officerNotes || '',
    latitude: report.latitude === null || report.latitude === undefined ? '' : String(report.latitude),
    longitude: report.longitude === null || report.longitude === undefined ? '' : String(report.longitude),
    locationVerified: report.latitude !== null && report.longitude !== null ? 'true' : '',
    locationVerificationSource: report.latitude !== null && report.longitude !== null ? 'existing-coordinates' : '',
    verifiedLocationLabel: report.location || ''
  };
}

function isAddressedConditionalField(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/\.+$/, '');

  return Boolean(normalized)
    && !['null', 'undefined', 'not identified in transcript', 'not available', 'n/a'].includes(normalized);
}

function validateIncident(incident, options = {}) {
  const errors = {};

  if (options.allowIncomplete) return errors;

  if (!hasText(incident.incidentType)) {
    errors.incidentType = 'Incident type is required.';
  }

  if (!hasText(incident.incidentLocation)) {
    errors.incidentLocation = 'Please enter the incident location.';
  }

  if (!isValidIncidentDateTime(incident.incidentDateTime)) {
    errors.incidentDateTime = 'Enter a valid incident date and time.';
  }

  if (!hasText(incident.incidentSummary)) {
    errors.incidentSummary = 'Incident description cannot be empty.';
  }

  if (!isAddressedConditionalField(incident.hazards)) {
    errors.hazards = 'Confirm that no hazards were reported or enter the hazard details.';
  }

  if (!isAddressedConditionalField(incident.injuredPersons)) {
    errors.injuredPersons = 'Confirm that no injured or trapped persons were reported or enter the details.';
  }

  if (!statuses.includes(incident.responseStatus)) {
    errors.responseStatus = 'Select a valid response status.';
  }

  const coordinates = validateCoordinatePair(incident.latitude, incident.longitude);

  if (!incident.locationVerified) {
    errors.incidentLocation = errors.incidentLocation || 'Verify the incident location before saving.';
  } else if (!coordinates.valid) {
    errors.incidentLocation = coordinates.message;
  }

  return errors;
}

function hasValidationErrors(errors) {
  return Object.keys(errors).length > 0;
}

function renderCreateForm(req, res, options = {}) {
  const formData = options.formData || {};
  const serverDateTime = formData.incidentDateTime || getServerDateTime();

  return renderPage(res, 'create-report', {
    pageTitle: 'Create Report',
    activePage: 'create-report',
    incidentTypes,
    canManageIncidentDateTime: canManageIncidentDateTime(req),
    serverDateTime,
    validationErrors: options.validationErrors || {},
    formData,
    completion: options.completion || buildCreateCompletion(req, formData)
  });
}

function renderEditForm(req, res, report, options = {}) {
  return renderPage(res, 'edit-report', {
    pageTitle: 'Edit Report',
    activePage: 'incidents',
    incidentTypes,
    canManageIncidentDateTime: canManageIncidentDateTime(req),
    report,
    validationErrors: options.validationErrors || {},
    formData: options.formData || buildEditFormData(report)
  });
}

async function getMappedIncidents() {
  const incidents = await incidentModel.getAllIncidents();
  return incidents.map(mapIncident);
}

exports.showCreateReport = async (req, res, next) => {
  try {
    return renderCreateForm(req, res);
  } catch (error) {
    return next(error);
  }
};

exports.createIncident = async (req, res, next) => {
  try {
    const savingDraft = req.body.saveMode === 'draft';
    const incident = readIncidentForm(req.body, {
      reportingOfficerId: getSessionOfficerId(req),
      incidentDateTime: getAuthorizedCreateDateTime(req)
    });
    const validationErrors = validateIncident(incident, {
      allowIncomplete: savingDraft
    });

    if (hasValidationErrors(validationErrors)) {
      return renderCreateForm(req, res.status(400), {
        validationErrors,
        formData: buildFormData(incident)
      });
    }

    const incidentId = await incidentModel.createIncident(incident);

    res.redirect(`/incidents/${incidentId}?reportSaved=1`);
  } catch (error) {
    next(error);
  }
};

exports.showIncidents = async (req, res, next) => {
  try {
    const selectedStatusGroup = req.query.statusGroup || '';
    const selectedStatus = selectedStatusGroup === 'completed'
      ? 'Completed'
      : req.query.status || 'All';
    const searchTerm = req.query.search ? req.query.search.trim() : '';
    const allReports = await getMappedIncidents();
    const incidents = await incidentModel.getAllIncidents({
      status: selectedStatusGroup ? 'All' : selectedStatus,
      statusGroup: selectedStatusGroup,
      search: searchTerm
    });
    const reports = incidents.map(mapIncident);

    renderPage(res, 'incidents', {
      pageTitle: selectedStatus === 'All' ? 'Incident Reports' : `${selectedStatus} Reports`,
      activePage: selectedStatusGroup === 'completed'
        ? 'completed'
        : selectedStatus === 'All'
          ? 'incidents'
          : statusKey(selectedStatus),
      reports,
      allReports,
      selectedStatus,
      selectedStatusGroup,
      searchTerm,
      emptyMessage: searchTerm
        ? 'No matching incident reports found.'
        : selectedStatus === 'All'
        ? 'No incident reports have been saved yet.'
        : `No ${selectedStatus.toLowerCase()} reports were found.`
    });
  } catch (error) {
    next(error);
  }
};

exports.getIncidentsApi = async (req, res, next) => {
  try {
    const selectedStatusGroup = req.query.statusGroup || '';
    const selectedStatus = selectedStatusGroup ? 'All' : req.query.status || 'All';
    const searchTerm = req.query.search ? req.query.search.trim() : '';
    const incidents = await incidentModel.getAllIncidents({
      status: selectedStatus,
      statusGroup: selectedStatusGroup,
      search: searchTerm
    });

    res.json({
      success: true,
      reports: incidents.map(mapIncident)
    });
  } catch (error) {
    next(error);
  }
};

exports.showReportDetails = async (req, res, next) => {
  try {
    const incident = await incidentModel.getIncidentByIncidentId(req.params.incidentId);

    if (!incident) {
      return renderPage(res.status(404), 'placeholder', {
        pageTitle: 'Report Not Found',
        activePage: 'incidents',
        message: 'The requested incident report could not be found.'
      });
    }

    return renderPage(res, 'report-details', {
      pageTitle: 'Report Details',
      activePage: 'incidents',
      report: mapIncident(incident)
    });
  } catch (error) {
    return next(error);
  }
};

exports.showEditReport = async (req, res, next) => {
  try {
    const incident = await incidentModel.getIncidentByIncidentId(req.params.incidentId);

    if (!incident) {
      return renderPage(res.status(404), 'placeholder', {
        pageTitle: 'Report Not Found',
        activePage: 'incidents',
        message: 'The requested incident report could not be found.'
      });
    }

    return renderEditForm(req, res, mapIncident(incident));
  } catch (error) {
    return next(error);
  }
};

exports.updateIncident = async (req, res, next) => {
  try {
    const existingIncident = await incidentModel.getIncidentByIncidentId(req.params.incidentId);
    if (!existingIncident) {
      return renderPage(res.status(404), 'placeholder', {
        pageTitle: 'Report Not Found',
        activePage: 'incidents',
        message: 'The requested incident report could not be found.'
      });
    }

    const incident = readIncidentForm(req.body, {
      reportingOfficerId: existingIncident.reporting_officer_id,
      incidentDateTime: canManageIncidentDateTime(req)
        ? req.body.incidentDateTime || (req.body.saveMode === 'draft'
          ? existingIncident.incident_datetime || getServerDateTime()
          : '')
        : existingIncident.incident_datetime
    });
    const validationErrors = validateIncident(incident, {
      allowIncomplete: req.body.saveMode === 'draft'
    });

    if (hasValidationErrors(validationErrors)) {
      return renderEditForm(req, res.status(400), mapIncident(existingIncident), {
        validationErrors,
        formData: buildFormData(incident)
      });
    }

    const updated = await incidentModel.updateIncident(req.params.incidentId, incident);

    if (!updated) {
      return renderPage(res.status(404), 'placeholder', {
        pageTitle: 'Report Not Found',
        activePage: 'incidents',
        message: 'The requested incident report could not be found.'
      });
    }

    return res.redirect(`/incidents/${req.params.incidentId}`);
  } catch (error) {
    return next(error);
  }
};

exports.deleteIncident = async (req, res, next) => {
  try {
    await incidentModel.deleteIncident(req.params.incidentId);
    res.redirect('/incidents');
  } catch (error) {
    next(error);
  }
};

exports.verifyLocation = async (req, res) => {
  const location = req.body && typeof req.body.location === 'string'
    ? req.body.location.trim()
    : '';

  if (!location) {
    return res.status(400).json({
      success: false,
      error: 'Please enter the incident location before verifying.'
    });
  }

  try {
    const coordinates = await resolveIncidentCoordinates({
      location,
      summary: req.body.incidentSummary,
      transcript: req.body.transcript
    });

    if (!coordinates) {
      return res.status(404).json({
        success: false,
        error: 'Unable to verify this location. Please check the address and try again.'
      });
    }

    const validation = validateCoordinatePair(coordinates.lat, coordinates.lng);

    if (!validation.valid) {
      return res.status(422).json({
        success: false,
        error: validation.message
      });
    }

    return res.json({
      success: true,
      location,
      resolvedLocation: coordinates.address
        || coordinates.searchValue
        || coordinates.area
        || location,
      latitude: validation.latitude,
      longitude: validation.longitude,
      source: coordinates.source || 'resolver'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Location verification failed. Please try again.'
    });
  }
};
