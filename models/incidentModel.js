const db = require('../config/db');
const {
  toNullableNumber
} = require('../helpers/locationResolver');
const {
  resolveIncidentCoordinates
} = require('../helpers/geocodingService');

let coordinateColumnsPromise;

function toSqlDateTime(value) {
  if (!value) return null;

  // datetime-local inputs arrive as YYYY-MM-DDTHH:mm; MySQL DATETIME expects a space.
  return value.replace('T', ' ') + (value.length === 16 ? ':00' : '');
}

async function hasColumn(columnName) {
  const [rows] = await db.query('SHOW COLUMNS FROM incidents LIKE ?', [columnName]);
  return rows.length > 0;
}

async function hasCoordinateColumns() {
  if (!coordinateColumnsPromise) {
    coordinateColumnsPromise = Promise.all([
      hasColumn('latitude'),
      hasColumn('longitude')
    ]).then(([hasLatitude, hasLongitude]) => hasLatitude && hasLongitude);
  }

  return coordinateColumnsPromise;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function hasCoordinateInput(incident) {
  return toNullableNumber(incident.latitude) !== null
    && toNullableNumber(incident.longitude) !== null;
}

async function resolveFormCoordinates(incident, existingIncident = null) {
  const locationChanged = existingIncident
    ? normalizeText(existingIncident.location) !== normalizeText(incident.incidentLocation)
    : false;
  const shouldPreferExistingCoordinates = existingIncident
    && !locationChanged
    && !hasCoordinateInput(incident);

  return {
    coordinates: await resolveIncidentCoordinates({
      latitude: shouldPreferExistingCoordinates ? existingIncident.latitude : incident.latitude,
      longitude: shouldPreferExistingCoordinates ? existingIncident.longitude : incident.longitude,
      location: incident.incidentLocation,
      summary: incident.incidentSummary,
      transcript: incident.transcript || (existingIncident && existingIncident.transcript)
    }),
    locationChanged
  };
}

async function generateIncidentId() {
  const [rows] = await db.query(`
    SELECT incident_id
    FROM incidents
    WHERE incident_id LIKE 'INC-%'
    ORDER BY CAST(SUBSTRING(incident_id, 5) AS UNSIGNED) DESC
    LIMIT 1
  `);

  const latestNumber = rows[0] ? Number(rows[0].incident_id.replace('INC-', '')) : 1000;
  return `INC-${latestNumber + 1}`;
}

const SEARCH_FIELDS = [
  'incident_id',
  'incident_type',
  'location',
  'response_status',
  'incident_summary',
  'hazards',
  'injured_or_trapped_persons',
  'missing_information',
  'officer_notes',
  'transcript'
];
const COMPLETED_STATUS_TERMS = ['completed', 'reviewed', 'closed', 'resolved'];

exports.getAllIncidents = async (filters = {}) => {
  const where = [];
  const params = [];

  if (filters.statusGroup === 'completed') {
    where.push(`(${COMPLETED_STATUS_TERMS.map(() => 'LOWER(response_status) LIKE ?').join(' OR ')})`);
    params.push(...COMPLETED_STATUS_TERMS.map((term) => `%${term}%`));
  } else if (filters.status && filters.status !== 'All') {
    where.push('response_status = ?');
    params.push(filters.status);
  }

  if (filters.search && filters.search.trim()) {
    const likeTerm = `%${filters.search.trim()}%`;
    where.push(`(${SEARCH_FIELDS.map((field) => `${field} LIKE ?`).join(' OR ')})`);
    params.push(...SEARCH_FIELDS.map(() => likeTerm));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await db.query(`
    SELECT *
    FROM incidents
    ${whereSql}
    ORDER BY incident_datetime DESC, created_at DESC
  `, params);

  return rows;
};

exports.getIncidentByIncidentId = async (incidentId) => {
  const [rows] = await db.query(
    'SELECT * FROM incidents WHERE incident_id = ? LIMIT 1',
    [incidentId]
  );

  return rows[0] || null;
};

exports.createIncident = async (incident) => {
  const incidentId = await generateIncidentId();
  const hasCoordinates = await hasCoordinateColumns();
  const columns = [
    'incident_id',
    'incident_type',
    'location',
    'incident_datetime',
    'incident_summary',
    'hazards',
    'injured_or_trapped_persons',
    'response_status',
    'missing_information',
    'officer_notes',
    'transcript'
  ];
  const values = [
    incidentId,
    incident.incidentType,
    incident.incidentLocation,
    toSqlDateTime(incident.incidentDateTime),
    incident.incidentSummary,
    incident.hazards || null,
    incident.injuredPersons || null,
    incident.responseStatus,
    incident.missingInfo || null,
    incident.officerNotes || null,
    incident.transcript || null
  ];

  if (hasCoordinates) {
    const { coordinates } = await resolveFormCoordinates(incident);

    columns.push('latitude', 'longitude');
    values.push(
      coordinates ? coordinates.lat : null,
      coordinates ? coordinates.lng : null
    );
  }

  await db.query(
    `
      INSERT INTO incidents (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
    `,
    values
  );

  return incidentId;
};

exports.updateIncident = async (incidentId, incident) => {
  const hasCoordinates = await hasCoordinateColumns();
  const setColumns = [
    'incident_type = ?',
    'location = ?',
    'incident_datetime = ?',
    'incident_summary = ?',
    'hazards = ?',
    'injured_or_trapped_persons = ?',
    'response_status = ?',
    'missing_information = ?',
    'officer_notes = ?'
  ];
  const values = [
    incident.incidentType,
    incident.incidentLocation,
    toSqlDateTime(incident.incidentDateTime),
    incident.incidentSummary,
    incident.hazards || null,
    incident.injuredPersons || null,
    incident.responseStatus,
    incident.missingInfo || null,
    incident.officerNotes || null
  ];

  if (hasCoordinates) {
    const existingIncident = await exports.getIncidentByIncidentId(incidentId);
    const { coordinates, locationChanged } = await resolveFormCoordinates(incident, existingIncident);

    if (coordinates || locationChanged) {
      setColumns.push('latitude = ?', 'longitude = ?');
      values.push(
        coordinates ? coordinates.lat : null,
        coordinates ? coordinates.lng : null
      );
    }
  }

  values.push(incidentId);

  const [result] = await db.query(
    `
      UPDATE incidents
      SET
        ${setColumns.join(',\n        ')}
      WHERE incident_id = ?
    `,
    values
  );

  return result.affectedRows > 0;
};

exports.deleteIncident = async (incidentId) => {
  const [result] = await db.query(
    'DELETE FROM incidents WHERE incident_id = ?',
    [incidentId]
  );

  return result.affectedRows > 0;
};
