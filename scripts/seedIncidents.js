const db = require('../config/db');
const officerModel = require('../models/officerModel');

const incidents = [
  {
    incident_id: 'INC-1001',
    incident_type: 'Residential Fire',
    location: 'Jurong West Street 42',
    latitude: 1.3404,
    longitude: 103.7090,
    incident_datetime: '2026-06-25 09:20:00',
    response_status: 'Pending Review',
    incident_summary: 'Smoke was reported from a seventh-floor residential unit. Firefighters contained a bedroom fire before it spread to nearby rooms.',
    hazards: 'Heavy smoke in corridor, electrical appliances near ignition point, limited visibility at entry.',
    injured_or_trapped_persons: 'One resident assessed for smoke inhalation. No trapped persons found.',
    missing_information: 'Confirm final cause of ignition after scene inspection.',
    officer_notes: 'Review evacuation timeline and attach witness notes before completion.',
    transcript: 'Caller reported smoke from a bedroom window at Jurong West Street 42. Neighbours were evacuating from the same floor.'
  },
  {
    incident_id: 'INC-1002',
    incident_type: 'Kitchen Fire',
    location: 'Bedok North Avenue 3',
    latitude: 1.3236,
    longitude: 103.9273,
    incident_datetime: '2026-06-24 18:45:00',
    response_status: 'Completed',
    incident_summary: 'A cooking fire was extinguished in a residential kitchen. The fire was limited to the stove area.',
    hazards: 'Hot oil, smoke staining, slippery kitchen floor after suppression.',
    injured_or_trapped_persons: 'No injuries reported.',
    missing_information: 'None.',
    officer_notes: 'Resident advised on safe cooking practices.',
    transcript: 'Small kitchen fire at Bedok North Avenue 3. Occupant switched off gas supply and waited outside the unit.'
  },
  {
    incident_id: 'INC-1003',
    incident_type: 'Road Traffic Accident',
    location: 'Tampines Avenue 10',
    latitude: 1.3496,
    longitude: 103.9568,
    incident_datetime: '2026-06-23 07:30:00',
    response_status: 'Escalated',
    incident_summary: 'Two vehicles were involved in a collision near a junction. One driver required assistance exiting the vehicle.',
    hazards: 'Broken glass, leaking coolant, traffic congestion, moving vehicles near responders.',
    injured_or_trapped_persons: 'One driver reported minor chest pain. Passenger condition required further confirmation.',
    missing_information: 'Need final medical outcome and traffic control notes.',
    officer_notes: 'Escalated due to possible injury and road blockage.',
    transcript: 'Caller reported a collision involving two cars on Tampines Avenue 10. One driver was still inside the vehicle.'
  },
  {
    incident_id: 'INC-1004',
    incident_type: 'Lift Rescue',
    location: 'Woodlands Drive 16',
    latitude: 1.4360,
    longitude: 103.7860,
    incident_datetime: '2026-06-22 21:10:00',
    response_status: 'Draft',
    incident_summary: 'Residents were trapped in a stalled lift between floors. Occupants were guided to remain calm while technician support was arranged.',
    hazards: 'Confined lift car, heat discomfort, anxiety among occupants.',
    injured_or_trapped_persons: 'No injuries reported. One occupant felt dizzy after release.',
    missing_information: 'Confirm technician arrival time and lift maintenance reference.',
    officer_notes: 'Draft pending officer review.',
    transcript: 'Three people trapped in a lift at Woodlands Drive 16. Lift stopped between level five and six.'
  },
  {
    incident_id: 'INC-1005',
    incident_type: 'Gas Leak',
    location: 'Yishun Ring Road',
    latitude: 1.4294,
    longitude: 103.8354,
    incident_datetime: '2026-06-21 12:05:00',
    response_status: 'Pending Review',
    incident_summary: 'A gas smell was reported near a coffeeshop service area. Surrounding units were checked and the area was ventilated.',
    hazards: 'Possible gas accumulation, ignition sources nearby, public crowding.',
    injured_or_trapped_persons: 'No injured or trapped persons reported.',
    missing_information: 'Confirm source isolation and utility follow-up.',
    officer_notes: 'Pending review of meter readings and evacuation notes.',
    transcript: 'Shop staff noticed a strong gas smell at Yishun Ring Road. People nearby were moved away from the service area.'
  },
  {
    incident_id: 'INC-1006',
    incident_type: 'Electrical Fire',
    location: 'Ang Mo Kio Avenue 5',
    latitude: 1.3691,
    longitude: 103.8454,
    incident_datetime: '2026-06-20 15:35:00',
    response_status: 'Completed',
    incident_summary: 'An electrical distribution box emitted sparks and smoke near a void deck. Power isolation was requested before inspection.',
    hazards: 'Live electrical components, smoke, public foot traffic near the service cabinet.',
    injured_or_trapped_persons: 'No injuries reported.',
    missing_information: 'None.',
    officer_notes: 'Completed after utility isolation and scene handover.',
    transcript: 'Resident reported sparks from an electrical box at Ang Mo Kio Avenue 5. Smoke was visible at the void deck.'
  },
  {
    incident_id: 'INC-1007',
    incident_type: 'Rubbish Chute Fire',
    location: 'Toa Payoh Lorong 6',
    latitude: 1.3343,
    longitude: 103.8563,
    incident_datetime: '2026-06-19 22:15:00',
    response_status: 'Completed',
    incident_summary: 'A small fire inside a rubbish chute was extinguished. Smoke entered the lift lobby on several floors.',
    hazards: 'Smoke in common area, hot chute access panel, possible falling debris.',
    injured_or_trapped_persons: 'No injuries reported.',
    missing_information: 'Confirm affected floors and ventilation duration.',
    officer_notes: 'Residents advised to avoid chute area until ventilation completed.',
    transcript: 'Caller said smoke was coming from the rubbish chute at Toa Payoh Lorong 6. Burning smell reported near the lift lobby.'
  },
  {
    incident_id: 'INC-1008',
    incident_type: 'Vehicle Fire',
    location: 'PIE Exit 26',
    incident_datetime: '2026-06-18 17:50:00',
    response_status: 'Escalated',
    incident_summary: 'A car fire was reported on the expressway shoulder near PIE Exit 26. Traffic control was required while responders approached.',
    hazards: 'Vehicle fuel, passing traffic, heat from engine bay, road shoulder access risk.',
    injured_or_trapped_persons: 'Driver exited vehicle before responders arrived. No trapped persons reported.',
    missing_information: 'Confirm final tow arrangement and lane reopening time.',
    officer_notes: 'Escalated due to expressway traffic exposure.',
    transcript: 'Caller reported a car on fire near PIE Exit 26. Driver was outside the car and traffic was slowing down.'
  },
  {
    incident_id: 'INC-1009',
    incident_type: 'Residential Fire',
    location: 'Bukit Batok Street 31',
    latitude: 1.3496,
    longitude: 103.7499,
    incident_datetime: '2026-06-17 06:40:00',
    response_status: 'Pending Review',
    incident_summary: 'Smoke was reported from a living room window. Fire damage was limited to furniture near the window.',
    hazards: 'Smoke in unit, burnt furniture, heat near window frame.',
    injured_or_trapped_persons: 'One elderly resident evacuated by neighbours. No injuries reported.',
    missing_information: 'Confirm ignition source and witness statement.',
    officer_notes: 'Pending officer review of resident interview notes.',
    transcript: 'Neighbour reported smoke from a flat at Bukit Batok Street 31. Elderly resident was helped out by neighbours.'
  },
  {
    incident_id: 'INC-1010',
    incident_type: 'Lift Rescue',
    location: 'Sengkang East Way',
    incident_datetime: '2026-06-16 11:25:00',
    response_status: 'Draft',
    incident_summary: 'Two occupants were trapped in a lift that stopped between floors. Building management contacted the lift contractor.',
    hazards: 'Confined space, anxiety, warm lift car.',
    injured_or_trapped_persons: 'Two trapped occupants. No injuries reported.',
    missing_information: 'Confirm release time and contractor reference number.',
    officer_notes: 'Draft saved pending final lift technician details.',
    transcript: 'Two people stuck in a lift at Sengkang East Way. Lift stopped between floors and building management was waiting for technician.'
  }
];

async function hasColumn(columnName) {
  const [rows] = await db.query('SHOW COLUMNS FROM incidents LIKE ?', [columnName]);
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

async function addIncidentColumnIfMissing(columnName, definition) {
  if (!(await hasColumn(columnName))) {
    await db.query(`ALTER TABLE incidents ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureDatabaseObjects() {
  await officerModel.ensureOfficerSchema();

  await db.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      incident_id VARCHAR(20) NOT NULL UNIQUE,
      reporting_officer_id INT NULL,
      incident_type VARCHAR(100) NOT NULL,
      location VARCHAR(255) NOT NULL,
      incident_datetime DATETIME NULL,
      incident_summary TEXT NULL,
      hazards TEXT NULL,
      injured_or_trapped_persons TEXT NULL,
      response_status VARCHAR(50) DEFAULT 'Draft',
      missing_information TEXT NULL,
      officer_notes TEXT NULL,
      transcript TEXT NULL,
      latitude DECIMAL(10, 7) NULL,
      longitude DECIMAL(10, 7) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await addIncidentColumnIfMissing('reporting_officer_id', 'INT NULL');

  if (!(await hasIndex('incidents', 'idx_incidents_reporting_officer_id'))) {
    await db.query('ALTER TABLE incidents ADD INDEX idx_incidents_reporting_officer_id (reporting_officer_id)');
  }

  console.log('Seeded demo officer users.');
}

async function getOfficerIds() {
  const [rows] = await db.query(`
    SELECT id
    FROM officers
    WHERE is_active = TRUE
    ORDER BY officer_name ASC
  `);

  return rows.map((row) => row.id);
}

async function seed() {
  await ensureDatabaseObjects();

  const hasLatitude = await hasColumn('latitude');
  const hasLongitude = await hasColumn('longitude');
  const hasCoordinates = hasLatitude && hasLongitude;
  const officerIds = await getOfficerIds();
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
  const updateColumns = columns.filter((column) => column !== 'incident_id');

  if (hasCoordinates) {
    columns.push('latitude', 'longitude');
    updateColumns.push('latitude', 'longitude');
  }

  const placeholders = columns.map(() => '?').join(', ');
  const updates = updateColumns
    .map((column) => `${column} = VALUES(${column})`)
    .join(',\n      ');
  const sql = `
    INSERT INTO incidents (${columns.join(', ')})
    VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE
      ${updates}
  `;

  for (const [index, incident] of incidents.entries()) {
    const values = [
      incident.incident_id,
      officerIds.length ? officerIds[index % officerIds.length] : null,
      incident.incident_type,
      incident.location,
      incident.incident_datetime,
      incident.incident_summary,
      incident.hazards,
      incident.injured_or_trapped_persons,
      incident.response_status,
      incident.missing_information,
      incident.officer_notes,
      incident.transcript
    ];

    if (hasCoordinates) {
      values.push(incident.latitude || null, incident.longitude || null);
    }

    await db.query(sql, values);
  }

  console.log(`Seeded ${incidents.length} incident reports.`);
  if (!hasCoordinates) {
    console.log('Latitude/longitude columns were not found, so seed coordinates were skipped.');
  }
  await db.end();
}

seed().catch(async (error) => {
  console.error(error);
  await db.end();
  process.exit(1);
});
