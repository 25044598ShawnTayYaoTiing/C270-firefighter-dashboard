const incidentModel = require('../models/incidentModel');
const {
  calculateCompletion,
  mapIncident,
  statusKey
} = require('../helpers/incidentPresenter');

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

function readIncidentForm(body) {
  const responseStatus = body.saveMode === 'draft'
    ? 'Draft'
    : body.responseStatus;

  // The controller normalizes form field names before handing data to the model.
  return {
    incidentLocation: body.incidentLocation ? body.incidentLocation.trim() : '',
    incidentType: body.incidentType ? body.incidentType.trim() : '',
    incidentDateTime: body.incidentDateTime || '',
    responseStatus: responseStatus || 'Pending Review',
    incidentSummary: body.incidentSummary ? body.incidentSummary.trim() : '',
    hazards: body.hazards ? body.hazards.trim() : '',
    injuredPersons: body.injuredPersons ? body.injuredPersons.trim() : '',
    missingInfo: body.missingInfo ? body.missingInfo.trim() : '',
    officerNotes: body.officerNotes ? body.officerNotes.trim() : '',
    transcript: body.transcript ? body.transcript.trim() : '',
    latitude: body.latitude || '',
    longitude: body.longitude || ''
  };
}

async function getMappedIncidents() {
  const incidents = await incidentModel.getAllIncidents();
  return incidents.map(mapIncident);
}

exports.showCreateReport = (req, res) => {
  renderPage(res, 'create-report', {
    pageTitle: 'Create Report',
    activePage: 'create-report',
    completion: calculateCompletion({})
  });
};

exports.createIncident = async (req, res, next) => {
  try {
    const incident = readIncidentForm(req.body);
    const incidentId = await incidentModel.createIncident(incident);

    res.redirect(`/incidents/${incidentId}`);
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

    return renderPage(res, 'edit-report', {
      pageTitle: 'Edit Report',
      activePage: 'incidents',
      incidentTypes,
      report: mapIncident(incident)
    });
  } catch (error) {
    return next(error);
  }
};

exports.updateIncident = async (req, res, next) => {
  try {
    const incident = readIncidentForm(req.body);
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
