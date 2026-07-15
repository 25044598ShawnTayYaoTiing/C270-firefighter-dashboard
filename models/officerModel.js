// done by Thein 25040396
// AI Features: officerModel.js manages officer data, including schema enforcement, demo user seeding, and legacy account backfilling for authentication purposes.
const bcrypt = require('bcrypt');
const db = require('../config/db');

const SALT_ROUNDS = 10;
const DEMO_PASSWORD = 'password123';
const DEMO_OFFICERS = [
  {
    username: 'admin1',
    officer_name: 'Admin Duty Officer 1',
    officer_role: 'Duty Officer',
    legacyUsernames: ['shawn'],
    legacyOfficerNames: ['Shawn Tay']
  },
  {
    username: 'admin2',
    officer_name: 'Admin Duty Officer 2',
    officer_role: 'Duty Officer',
    legacyUsernames: ['dispatcher'],
    legacyOfficerNames: ['Tan Wei Ming']
  },
  {
    username: 'admin3',
    officer_name: 'Admin Duty Officer 3',
    officer_role: 'Duty Officer',
    legacyUsernames: ['supervisor'],
    legacyOfficerNames: ['Priya Nair']
  },
  {
    username: 'admin4',
    officer_name: 'Admin Duty Officer 4',
    officer_role: 'Duty Officer',
    legacyUsernames: [],
    legacyOfficerNames: ['Nur Aisyah Rahman', 'Lim Jun Hao']
  },
  {
    username: 'admin5',
    officer_name: 'Admin Duty Officer 5',
    officer_role: 'Duty Officer',
    legacyUsernames: [],
    legacyOfficerNames: ['Muhammad Faris']
  }
];
const LEGACY_DEMO_USERNAMES = DEMO_OFFICERS.flatMap((officer) => officer.legacyUsernames);
const LEGACY_DEMO_OFFICER_NAMES = DEMO_OFFICERS.flatMap((officer) => officer.legacyOfficerNames);

let officerSchemaPromise;

async function hasColumn(columnName, tableName = 'officers') {
  const [rows] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  return rows.length > 0;
}

async function hasUniqueIndexOnColumn(tableName, columnName) {
  const [rows] = await db.query(
    `
      SELECT 1
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
        AND NON_UNIQUE = 0
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function addOfficerColumnIfMissing(columnName, definition) {
  if (!(await hasColumn(columnName))) {
    await db.query(`ALTER TABLE officers ADD COLUMN ${columnName} ${definition}`);
  }
}

async function findSeedOfficerRow(officer) {
  const usernames = [officer.username, ...(officer.legacyUsernames || [])];
  const officerNames = [officer.officer_name, ...(officer.legacyOfficerNames || [])];
  const usernamePlaceholders = usernames.map(() => '?').join(', ');
  const namePlaceholders = officerNames.map(() => '?').join(', ');
  const [rows] = await db.query(
    `
      SELECT id, username, officer_name
      FROM officers
      WHERE username IN (${usernamePlaceholders})
         OR officer_name IN (${namePlaceholders})
      ORDER BY
        CASE
          WHEN username = ? THEN 0
          WHEN officer_name = ? THEN 1
          ELSE 2
        END,
        id ASC
      LIMIT 1
    `,
    [
      ...usernames,
      ...officerNames,
      officer.username,
      officer.officer_name
    ]
  );

  return rows[0] || null;
}

async function deactivateRetiredDemoRows(activeDemoIds) {
  if (!activeDemoIds.length) return;

  const idPlaceholders = activeDemoIds.map(() => '?').join(', ');
  const usernamePlaceholders = LEGACY_DEMO_USERNAMES.map(() => '?').join(', ');
  const namePlaceholders = LEGACY_DEMO_OFFICER_NAMES.map(() => '?').join(', ');

  await db.query(
    `
      UPDATE officers
      SET is_active = FALSE
      WHERE id NOT IN (${idPlaceholders})
        AND (
          username IN (${usernamePlaceholders})
          OR officer_name IN (${namePlaceholders})
        )
    `,
    [
      ...activeDemoIds,
      ...LEGACY_DEMO_USERNAMES,
      ...LEGACY_DEMO_OFFICER_NAMES
    ]
  );
}

async function seedDemoOfficerUsers() {
  const activeDemoIds = [];

  for (const officer of DEMO_OFFICERS) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, SALT_ROUNDS);
    const existingRow = await findSeedOfficerRow(officer);

    if (existingRow) {
      await db.query(
        `
          UPDATE officers
          SET username = ?,
              password_hash = ?,
              officer_name = ?,
              officer_role = ?,
              is_active = TRUE
          WHERE id = ?
        `,
        [
          officer.username,
          passwordHash,
          officer.officer_name,
          officer.officer_role,
          existingRow.id
        ]
      );
      activeDemoIds.push(existingRow.id);
      continue;
    }

    const [result] = await db.query(
      `
        INSERT INTO officers (username, password_hash, officer_name, officer_role, is_active)
        VALUES (?, ?, ?, ?, TRUE)
      `,
      [officer.username, passwordHash, officer.officer_name, officer.officer_role]
    );
    activeDemoIds.push(result.insertId);
  }

  await deactivateRetiredDemoRows(activeDemoIds);
}

async function backfillLegacyOfficerAccounts() {
  const legacyPasswordHash = await bcrypt.hash(
    `legacy-${Date.now()}-${Math.random()}`,
    SALT_ROUNDS
  );
  const [rows] = await db.query(`
    SELECT id, username, password_hash, officer_role
    FROM officers
    ORDER BY id ASC
  `);
  const seenUsernames = new Set();

  for (const row of rows) {
    const updates = [];
    const params = [];
    const currentUsername = String(row.username || '').trim();
    let nextUsername = currentUsername;

    if (!nextUsername || seenUsernames.has(nextUsername.toLowerCase())) {
      nextUsername = `officer${row.id}`;
      updates.push('username = ?');
      params.push(nextUsername);
    }

    seenUsernames.add(nextUsername.toLowerCase());

    if (!row.password_hash) {
      updates.push('password_hash = ?');
      params.push(legacyPasswordHash);
    }

    if (!row.officer_role) {
      updates.push('officer_role = ?');
      params.push('Officer');
    }

    if (!updates.length) continue;

    params.push(row.id);
    await db.query(
      `
        UPDATE officers
        SET ${updates.join(', ')}
        WHERE id = ?
      `,
      params
    );
  }
}

async function enforceOfficerColumnConstraints() {
  await db.query('ALTER TABLE officers MODIFY username VARCHAR(50) NOT NULL');
  await db.query('ALTER TABLE officers MODIFY password_hash VARCHAR(255) NOT NULL');
  await db.query('ALTER TABLE officers MODIFY officer_name VARCHAR(100) NOT NULL');
  await db.query('ALTER TABLE officers MODIFY officer_role VARCHAR(100) NOT NULL');

  if (!(await hasUniqueIndexOnColumn('officers', 'username'))) {
    await db.query('ALTER TABLE officers ADD UNIQUE INDEX idx_officers_username (username)');
  }
}

exports.ensureOfficerSchema = async () => {
  if (!officerSchemaPromise) {
    officerSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS officers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(50) NOT NULL UNIQUE,
          password_hash VARCHAR(255) NOT NULL,
          officer_name VARCHAR(100) NOT NULL,
          officer_role VARCHAR(100) NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await addOfficerColumnIfMissing('username', 'VARCHAR(50) NULL AFTER id');
      await addOfficerColumnIfMissing('password_hash', 'VARCHAR(255) NULL AFTER username');
      await addOfficerColumnIfMissing('officer_role', 'VARCHAR(100) NULL AFTER officer_name');
      await addOfficerColumnIfMissing('is_active', 'BOOLEAN DEFAULT TRUE AFTER officer_role');
      await addOfficerColumnIfMissing('created_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP');

      await seedDemoOfficerUsers();
      await backfillLegacyOfficerAccounts();
      await enforceOfficerColumnConstraints();
    })();
  }

  return officerSchemaPromise;
};

exports.findActiveOfficerByUsername = async (username) => {
  await exports.ensureOfficerSchema();

  const [rows] = await db.query(
    `
      SELECT id, username, password_hash, officer_name, officer_role
      FROM officers
      WHERE username = ?
        AND is_active = TRUE
      LIMIT 1
    `,
    [username]
  );

  return rows[0] || null;
};

exports.getActiveOfficers = async () => {
  await exports.ensureOfficerSchema();

  const [rows] = await db.query(`
    SELECT id, officer_name, officer_role
    FROM officers
    WHERE is_active = TRUE
    ORDER BY officer_name ASC
  `);

  return rows;
};

exports.getOfficerById = async (officerId) => {
  await exports.ensureOfficerSchema();

  const [rows] = await db.query(
    `
      SELECT id, officer_name, officer_role
      FROM officers
      WHERE id = ?
      LIMIT 1
    `,
    [officerId]
  );

  return rows[0] || null;
};

exports.DEMO_OFFICERS = DEMO_OFFICERS;
exports.DEMO_PASSWORD = DEMO_PASSWORD;
