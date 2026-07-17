// done by Thein 25040396
// AI Features: incidentModel.js manages incident data, including schema enforcement, coordinate resolution, and CRUD operations for incident reports with proper access control.
const db = require('../config/db');
const {
  toNullableNumber
} = require('../helpers/locationResolver');
const {
  resolveIncidentCoordinates
} = require('../helpers/geocodingService');
const officerModel = require('./officerModel');

let coordinateColumnsPromise;
let incidentOfficerSchemaPromise;

function toSqlDateTime(value) {
  if (!value) return null;

  if (value instanceof Date) {
    const pad = (part) => String(part).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      + ` ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }

  // datetime-local inputs arrive as YYYY-MM-DDTHH:mm; MySQL DATETIME expects a space.
  const text = String(value);
  return text.replace('T', ' ') + (text.length === 16 ? ':00' : '');
}

async function hasTable(tableName) {
  const [rows] = await db.query('SHOW TABLES LIKE ?', [tableName]);
  return rows.length > 0;
}

async function hasColumn(columnName, tableName = 'incidents') {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  return rows.length > 0;
}

async function hasIndex(tableName, indexName) {
  const [rows] = await db.query(
    `
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1
    `,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function ensureOfficerSchema() {
  if (!incidentOfficerSchemaPromise) {
    incidentOfficerSchemaPromise = (async () => {
      await officerModel.ensureOfficerSchema();

      if (await hasTable('incidents')) {
        if (!(await hasColumn('reporting_officer_id'))) {
          await db.query('ALTER TABLE incidents ADD COLUMN reporting_officer_id INT NULL');
        }

        if (!(await hasIndex('incidents', 'idx_incidents_reporting_officer_id'))) {
          await db.query('ALTER TABLE incidents ADD INDEX idx_incidents_reporting_officer_id (reporting_officer_id)');
        }
      }
    })();
  }

  return incidentOfficerSchemaPromise;
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
  'i.incident_id',
  'i.incident_type',
  'i.location',
  'i.response_status',
  'i.incident_summary',
  'i.hazards',
  'i.injured_or_trapped_persons',
  'i.missing_information',
  'i.officer_notes',
  'i.transcript',
  'o.officer_name',
  'o.officer_role'
];
const COMPLETED_STATUS_TERMS = ['completed', 'reviewed', 'closed', 'resolved'];

exports.getAllIncidents = async (filters = {}) => {
  await ensureOfficerSchema();

  const where = [];
  const params = [];

  if (filters.statusGroup === 'completed') {
    where.push(`(${COMPLETED_STATUS_TERMS.map(() => 'LOWER(i.response_status) LIKE ?').join(' OR ')})`);
    params.push(...COMPLETED_STATUS_TERMS.map((term) => `%${term}%`));
  } else if (filters.status && filters.status !== 'All') {
    where.push('i.response_status = ?');
    params.push(filters.status);
  }

  if (filters.search && filters.search.trim()) {
    const likeTerm = `%${filters.search.trim()}%`;
    where.push(`(${SEARCH_FIELDS.map((field) => `${field} LIKE ?`).join(' OR ')})`);
    params.push(...SEARCH_FIELDS.map(() => likeTerm));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await db.query(`
    SELECT i.*, o.officer_name, o.officer_role
    FROM incidents i
    LEFT JOIN officers o ON i.reporting_officer_id = o.id
    ${whereSql}
    ORDER BY i.incident_datetime DESC, i.created_at DESC
  `, params);

  return rows;
};

exports.getIncidentByIncidentId = async (incidentId) => {
  await ensureOfficerSchema();

  const [rows] = await db.query(
    `
      SELECT i.*, o.officer_name, o.officer_role
      FROM incidents i
      LEFT JOIN officers o ON i.reporting_officer_id = o.id
      WHERE i.incident_id = ?
      LIMIT 1
    `,
    [incidentId]
  );

  return rows[0] || null;
};

exports.getActiveOfficers = async () => {
  return officerModel.getActiveOfficers();
};

exports.getOfficerById = async (officerId) => {
  return officerModel.getOfficerById(officerId);
};

exports.createIncident = async (incident) => {
  await ensureOfficerSchema();

  const incidentId = await generateIncidentId();
  const hasCoordinates = await hasCoordinateColumns();
  const columns = [
    'incident_id',
    'reporting_officer_id',
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
    incident.reportingOfficerId || null,
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
  await ensureOfficerSchema();

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
