const db = require('../config/db');

function toSqlDateTime(value) {
  if (!value) return null;

  // datetime-local inputs arrive as YYYY-MM-DDTHH:mm; MySQL DATETIME expects a space.
  return value.replace('T', ' ') + (value.length === 16 ? ':00' : '');
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

exports.getAllIncidents = async (filters = {}) => {
  const where = [];
  const params = [];

  if (filters.status && filters.status !== 'All') {
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

  await db.query(
    `
      INSERT INTO incidents (
        incident_id,
        incident_type,
        location,
        incident_datetime,
        incident_summary,
        hazards,
        injured_or_trapped_persons,
        response_status,
        missing_information,
        officer_notes,
        transcript
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
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
    ]
  );

  return incidentId;
};

exports.updateIncident = async (incidentId, incident) => {
  const [result] = await db.query(
    `
      UPDATE incidents
      SET
        incident_type = ?,
        location = ?,
        incident_datetime = ?,
        incident_summary = ?,
        hazards = ?,
        injured_or_trapped_persons = ?,
        response_status = ?,
        missing_information = ?,
        officer_notes = ?
      WHERE incident_id = ?
    `,
    [
      incident.incidentType,
      incident.incidentLocation,
      toSqlDateTime(incident.incidentDateTime),
      incident.incidentSummary,
      incident.hazards || null,
      incident.injuredPersons || null,
      incident.responseStatus,
      incident.missingInfo || null,
      incident.officerNotes || null,
      incidentId
    ]
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
