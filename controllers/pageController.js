const http = require('http');
const incidentModel = require('../models/incidentModel');
const db = require('../config/db');
const ollamaService = require('../services/ollamaService');
const {
  buildMapData,
  mapIncident,
  safeJson,
  statusKey
} = require('../helpers/incidentPresenter');

const statuses = ['Draft', 'Pending Review', 'Completed', 'Escalated'];

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

// Done by: Khin (25036933)
// Check whether the external real-time transcription service is reachable before the UI shows it as available.
function requestTranscriptionHealth() {
  return new Promise((resolve) => {
    const request = http.get('http://127.0.0.1:8010/health', { timeout: 1500 }, (response) => {
      let body = '';

      response.on('data', (chunk) => {
        body += chunk;
      });

      response.on('end', () => {
        let data = {};

        try {
          data = body ? JSON.parse(body) : {};
        } catch (error) {
          data = { raw: body };
        }

        resolve({
          available: response.statusCode >= 200 && response.statusCode < 500,
          statusCode: response.statusCode,
          data
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Transcription health check timed out.'));
    });

    request.on('error', (error) => {
      resolve({
        available: false,
        error: error.message
      });
    });
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timeout;

  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise])
    .finally(() => clearTimeout(timeout));
}

async function checkDatabaseHealth() {
  try {
    await withTimeout(
      db.query('SELECT 1 AS ok'),
      1500,
      'Database health check timed out.'
    );

    return {
      connected: true
    };
  } catch (error) {
    return {
      connected: false
    };
  }
}

function countBy(reports, key) {
  return reports.reduce((counts, report) => {
    const label = report[key] || 'Unspecified';
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
}

function toPercent(count, total) {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function getStatusCount(reports, status) {
  return reports.filter((report) => report.status === status).length;
}

function getStartOfWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function getReportsThisWeek(reports) {
  const startOfWeek = getStartOfWeek();
  return reports.filter((report) => report.incidentDate && report.incidentDate >= startOfWeek).length;
}

function buildBreakdown(reports, key, limit) {
  const total = reports.length;
  const counts = countBy(reports, key);

  return Object.entries(counts)
    .map(([label, count]) => ({
      label,
      count,
      value: toPercent(count, total)
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function buildActivityItems(reports) {
  return [...reports]
    .sort((a, b) => {
      const left = a.updatedDate ? a.updatedDate.getTime() : 0;
      const right = b.updatedDate ? b.updatedDate.getTime() : 0;
      return right - left;
    })
    .slice(0, 5)
    .map((report) => ({
      label: `${report.id} - ${report.type} (${report.status})`,
      time: report.lastUpdated
    }));
}

function buildTrendNotes(typeBreakdown, locations, totalReports) {
  const topType = typeBreakdown[0];
  const topLocation = locations[0];

  return [
    {
      icon: 'bi-arrow-up-right',
      text: topType
        ? `${topType.label} is the most common incident type with ${topType.count} report${topType.count === 1 ? '' : 's'}.`
        : 'No incident type trends are available yet.'
    },
    {
      icon: 'bi-clipboard-data',
      text: `${totalReports} total incident report${totalReports === 1 ? '' : 's'} currently recorded.`
    },
    {
      icon: 'bi-geo-alt',
      text: topLocation
        ? `${topLocation.label} appears most often with ${topLocation.count} report${topLocation.count === 1 ? '' : 's'}.`
        : 'No location trends are available yet.'
    }
  ];
}

async function getReports() {
  const incidents = await incidentModel.getAllIncidents();
  return incidents.map(mapIncident);
}

function getMapPayloadSummary(incidentMapData) {
  const markers = Array.isArray(incidentMapData.markers) ? incidentMapData.markers : [];
  const unmapped = Array.isArray(incidentMapData.unmapped) ? incidentMapData.unmapped : [];
  const incidents = Array.isArray(incidentMapData.incidents) ? incidentMapData.incidents : [];

  return {
    totalIncidents: incidents.length,
    liveMappedIncidents: markers.length,
    unmappedIncidents: unmapped.length,
    completedHidden: incidentMapData.completedHidden || 0,
    mapped: markers.map((incident) => ({
      incident_id: incident.incident_id,
      location: incident.location,
      response_status: incident.response_status,
      latitude: incident.latitude,
      longitude: incident.longitude
    })),
    unmapped: unmapped.map((incident) => ({
      incident_id: incident.incident_id,
      location: incident.location,
      response_status: incident.response_status,
      latitude: incident.latitude,
      longitude: incident.longitude,
      reason: incident.reason
    }))
  };
}

function logMapPayloadDebug(incidentMapData) {
  if (String(process.env.GEOCODING_DEBUG || '').toLowerCase() !== 'true') return;

  const summary = getMapPayloadSummary(incidentMapData);
  console.log('[MapPayload] total incidents:', summary.totalIncidents);
  console.log('[MapPayload] live mapped incidents:', summary.liveMappedIncidents);
  console.log('[MapPayload] unmapped incidents:', summary.unmappedIncidents);
  console.log('[MapPayload] completed hidden:', summary.completedHidden);
  console.log('[MapPayload] sample mapped incident:', summary.mapped[0] || null);
}

exports.showDashboard = async (req, res, next) => {
  try {
    // Done by Fatin ID: 25050557
    // Read all incidents from the database and prepare them for the dashboard
    const reports = await getReports();
    const totalReports = reports.length;
    const pendingCount = getStatusCount(reports, 'Pending Review');
    const completedCount = getStatusCount(reports, 'Completed');
    const escalatedCount = getStatusCount(reports, 'Escalated');
    const reportsThisWeek = getReportsThisWeek(reports);
    const typeBreakdown = buildBreakdown(reports, 'type', 5);
    const locations = buildBreakdown(reports, 'location', 4);
    // Convert incident reports into map markers and unmapped incidents
    const incidentMapData = await buildMapData(reports);
    logMapPayloadDebug(incidentMapData);

    const summaryCards = [
      { label: 'Total Incident Reports', value: totalReports, subtext: 'Current incident log', icon: 'bi-file-earmark-text', accent: 'red' },
      { label: 'Pending Review', value: pendingCount, subtext: 'Awaiting officer review', icon: 'bi-hourglass-split', accent: 'orange' },
      { label: 'Completed Reports', value: completedCount, subtext: 'Closed by officer review', icon: 'bi-check2-circle', accent: 'green' },
      { label: 'Reports This Week', value: reportsThisWeek, subtext: 'Created this week', icon: 'bi-calendar-week', accent: 'blue' },
      { label: 'Escalated Incidents', value: escalatedCount, subtext: 'Requires urgent review', icon: 'bi-exclamation-triangle', accent: 'red' }
    ];

    // Pass all dashboard data (including the map) to dashboard.ejs
    renderPage(res, 'dashboard', {
      pageTitle: 'Dashboard',
      activePage: 'dashboard',
      summaryCards,
      recentReports: reports.slice(0, 4),
      pendingReports: reports.filter((report) => report.status === 'Pending Review').slice(0, 5),
      activityItems: buildActivityItems(reports),
      typeBreakdown,
      locations,
      incidentMapData,
      incidentMapJson: safeJson(incidentMapData)
    });
  } catch (error) {
    next(error);
  }
};

exports.showDevMapPayload = async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      error: 'Not found'
    });
  }

  try {
    const reports = await getReports();
    const incidentMapData = await buildMapData(reports);

    return res.json(getMapPayloadSummary(incidentMapData));
  } catch (error) {
    return next(error);
  }
};

exports.showAnalytics = async (req, res, next) => {
  try {
    const reports = await getReports();
    const totalReports = reports.length;
    const pendingCount = getStatusCount(reports, 'Pending Review');
    const completedCount = getStatusCount(reports, 'Completed');
    const escalatedCount = getStatusCount(reports, 'Escalated');
    const typeBreakdown = buildBreakdown(reports, 'type', 8);
    const locations = buildBreakdown(reports, 'location', 6);
    const statusCounts = statuses.map((status) => {
      const value = getStatusCount(reports, status);
      return {
        label: status,
        value,
        percent: toPercent(value, totalReports)
      };
    });

    renderPage(res, 'analytics', {
      pageTitle: 'Analytics',
      activePage: 'analytics',
      metricCards: [
        { eyebrow: 'Total Reports', value: totalReports, label: 'All incident records' },
        { eyebrow: 'Current Queue', value: pendingCount, label: 'Pending officer reviews' },
        { eyebrow: 'Completed', value: completedCount, label: 'Reports completed' },
        { eyebrow: 'Escalations', value: escalatedCount, label: 'Incidents requiring attention' }
      ],
      typeBreakdown,
      locations,
      statusCounts,
      trendNotes: buildTrendNotes(typeBreakdown, locations, totalReports)
    });
  } catch (error) {
    next(error);
  }
};

// Done by: Khin (25036933)
// Render the live call intake page where operators can start transcription, review text, and send it to report creation.
exports.showTranscription = (req, res) => {
  renderPage(res, 'transcription', {
    pageTitle: 'Live Call Intake',
    activePage: 'transcription'
  });
};

exports.checkTranscriptionHealth = async (req, res) => {
  const health = await requestTranscriptionHealth();
  res.json(health);
};

// Done by: Khin (25036933)
// Gather the current health of transcription, AI cleanup, and the database so the page can show a reliable system status.
exports.checkSystemStatus = async (req, res) => {
  const [transcriptionHealth, aiHealth, databaseHealth] = await Promise.all([
    requestTranscriptionHealth(),
    ollamaService.checkHealth(),
    checkDatabaseHealth()
  ]);

  res.json({
    realtimeStt: {
      available: transcriptionHealth.available
    },
    ai: {
      available: aiHealth.available
    },
    database: {
      connected: databaseHealth.connected
    }
  });
};

exports.showPendingReview = (req, res) => {
  res.redirect('/incidents?status=Pending%20Review');
};

exports.showCompletedReports = (req, res) => {
  res.redirect('/incidents?statusGroup=completed');
};

exports.showEscalatedIncidents = (req, res) => {
  res.redirect('/incidents?status=Escalated');
};

function showPlaceholder(res, pageTitle, activePage, message) {
  renderPage(res, 'placeholder', {
    pageTitle,
    activePage,
    message
  });
}

exports.showTeamMembers = (req, res) => {
  showPlaceholder(res, 'Team Members', 'team-members', 'Personnel management is not enabled in this deployment.');
};

exports.showSettings = (req, res) => {
  showPlaceholder(res, 'Settings', 'settings', 'Operational settings are managed by the deployment environment.');
};

exports.showApiKeys = (req, res) => {
  showPlaceholder(res, 'API Keys', 'api-keys', 'Credential management is not enabled in this deployment.');
};
