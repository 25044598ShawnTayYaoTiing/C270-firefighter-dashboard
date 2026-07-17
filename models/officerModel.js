// done by Thein 25040396
// AI Features: officerModel.js manages officer data, including schema enforcement, demo user seeding, and legacy account backfilling for authentication purposes.
const bcrypt = require('bcrypt');
const db = require('../config/db');
const {
  ROLES,
  getCreatableRoles,
  normalizeRole
} = require('../middleware/rolePermissions');

const SALT_ROUNDS = 10;
const DEMO_PASSWORD = 'password123';
const DEMO_OFFICERS = [
  {
    username: 'admin1',
    officer_name: 'Admin Duty Officer 1',
    officer_role: ROLES.ADMIN,
    legacyUsernames: ['shawn'],
    legacyOfficerNames: ['Shawn Tay']
  },
  {
    username: 'admin2',
    officer_name: 'Admin Duty Officer 2',
    officer_role: ROLES.HR,
    legacyUsernames: ['dispatcher'],
    legacyOfficerNames: ['Tan Wei Ming']
  },
  {
    username: 'admin3',
    officer_name: 'Admin Duty Officer 3',
    officer_role: ROLES.NORMAL,
    legacyUsernames: ['supervisor'],
    legacyOfficerNames: ['Priya Nair']
  },
  {
    username: 'admin4',
    officer_name: 'Admin Duty Officer 4',
    officer_role: ROLES.NORMAL,
    legacyUsernames: [],
    legacyOfficerNames: ['Nur Aisyah Rahman', 'Lim Jun Hao']
  },
  {
    username: 'admin5',
    officer_name: 'Admin Duty Officer 5',
    officer_role: ROLES.NORMAL,
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

    const normalizedRole = normalizeRole(row.officer_role);
    if (row.officer_role !== normalizedRole) {
      updates.push('officer_role = ?');
      params.push(normalizedRole);
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

exports.findActiveOfficerById = async (officerId) => {
  await exports.ensureOfficerSchema();

  const [rows] = await db.query(
    `
      SELECT id, username, officer_name, officer_role
      FROM officers
      WHERE id = ?
        AND is_active = TRUE
      LIMIT 1
    `,
    [officerId]
  );

  return rows[0] || null;
};

exports.getAllOfficers = async () => {
  await exports.ensureOfficerSchema();

  const [rows] = await db.query(`
    SELECT id, username, officer_name, officer_role, is_active, created_at
    FROM officers
    ORDER BY is_active DESC, officer_name ASC
  `);

  return rows.map((row) => ({
    ...row,
    officer_role: normalizeRole(row.officer_role),
    is_active: Boolean(row.is_active)
  }));
};

exports.getManagedOfficerById = async (officerId) => {
  await exports.ensureOfficerSchema();

  const [rows] = await db.query(
    `
      SELECT id, username, officer_name, officer_role, is_active, created_at
      FROM officers
      WHERE id = ?
      LIMIT 1
    `,
    [officerId]
  );

  if (!rows[0]) return null;

  return {
    ...rows[0],
    officer_role: normalizeRole(rows[0].officer_role),
    is_active: Boolean(rows[0].is_active)
  };
};

function createAccountError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertActorCanManageTarget(actorRole, targetRole) {
  const normalizedActorRole = normalizeRole(actorRole);
  const normalizedTargetRole = normalizeRole(targetRole);

  if (normalizedActorRole === ROLES.ADMIN) return;
  if (normalizedActorRole === ROLES.HR && normalizedTargetRole === ROLES.NORMAL) return;

  throw createAccountError('FORBIDDEN_ACCOUNT_ACTION', 'You cannot manage this account.');
}

exports.createManagedOfficer = async (officer, actorRole) => {
  await exports.ensureOfficerSchema();

  const submittedRole = String(officer.officer_role || '').trim();
  if (!getCreatableRoles(actorRole).includes(submittedRole)) {
    throw createAccountError('FORBIDDEN_ROLE', 'You cannot create an account with that role.');
  }
  const normalizedRole = normalizeRole(submittedRole);

  const passwordHash = await bcrypt.hash(officer.password, SALT_ROUNDS);

  try {
    const [result] = await db.query(
      `
        INSERT INTO officers (username, password_hash, officer_name, officer_role, is_active)
        VALUES (?, ?, ?, ?, TRUE)
      `,
      [officer.username, passwordHash, officer.officer_name, normalizedRole]
    );
    return result.insertId;
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw createAccountError('DUPLICATE_USERNAME', 'That username is already in use.');
    }
    throw error;
  }
};

exports.updateManagedOfficer = async (officerId, updates, actor) => {
  await exports.ensureOfficerSchema();
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();
    const [targetRows] = await connection.query(
      'SELECT id, officer_role FROM officers WHERE id = ? FOR UPDATE',
      [officerId]
    );
    const target = targetRows[0];
    if (!target) {
      throw createAccountError('ACCOUNT_NOT_FOUND', 'User account not found.');
    }

    assertActorCanManageTarget(actor.officer_role, target.officer_role);
    const currentRole = normalizeRole(target.officer_role);
    const submittedRole = String(updates.officer_role || '').trim();
    const requestedRole = submittedRole
      ? normalizeRole(submittedRole)
      : currentRole;

    if (Number(officerId) === Number(actor.officer_id) && requestedRole !== currentRole) {
      throw createAccountError(
        'SELF_ROLE_CHANGE',
        'This account role cannot be changed here.'
      );
    }

    if (submittedRole && !getCreatableRoles(actor.officer_role).includes(submittedRole)
      && submittedRole !== currentRole) {
      throw createAccountError('FORBIDDEN_ROLE', 'You cannot assign that role.');
    }
    if (normalizeRole(actor.officer_role) === ROLES.HR && requestedRole !== ROLES.NORMAL) {
      throw createAccountError('FORBIDDEN_ROLE', 'HR can only manage Duty Officer accounts.');
    }

    if (currentRole === ROLES.ADMIN && requestedRole !== ROLES.ADMIN) {
      const [activeRows] = await connection.query(
        'SELECT officer_role FROM officers WHERE is_active = TRUE FOR UPDATE'
      );
      const adminCount = activeRows.filter((row) => normalizeRole(row.officer_role) === ROLES.ADMIN).length;
      if (adminCount <= 1) {
        throw createAccountError('LAST_ADMIN', 'The final active Higher Rank/Admin account cannot be demoted.');
      }
    }

    const setColumns = ['username = ?', 'officer_name = ?', 'officer_role = ?'];
    const params = [updates.username, updates.officer_name, requestedRole];
    if (updates.password) {
      setColumns.push('password_hash = ?');
      params.push(await bcrypt.hash(updates.password, SALT_ROUNDS));
    }
    params.push(officerId);

    await connection.query(
      `UPDATE officers SET ${setColumns.join(', ')} WHERE id = ?`,
      params
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (error && error.code === 'ER_DUP_ENTRY') {
      throw createAccountError('DUPLICATE_USERNAME', 'That username is already in use.');
    }
    throw error;
  } finally {
    connection.release();
  }
};

exports.deactivateManagedOfficer = async (officerId, actor) => {
  await exports.ensureOfficerSchema();

  if (normalizeRole(actor.officer_role) !== ROLES.ADMIN) {
    throw createAccountError('FORBIDDEN_ACCOUNT_ACTION', 'Only Higher Rank/Admin can deactivate accounts.');
  }
  if (Number(officerId) === Number(actor.officer_id)) {
    throw createAccountError('SELF_DEACTIVATION', 'You cannot deactivate your own logged-in account.');
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [targetRows] = await connection.query(
      'SELECT id, officer_role, is_active FROM officers WHERE id = ? FOR UPDATE',
      [officerId]
    );
    const target = targetRows[0];
    if (!target) {
      throw createAccountError('ACCOUNT_NOT_FOUND', 'User account not found.');
    }
    if (!target.is_active) {
      await connection.commit();
      return false;
    }

    if (normalizeRole(target.officer_role) === ROLES.ADMIN) {
      const [activeRows] = await connection.query(
        'SELECT officer_role FROM officers WHERE is_active = TRUE FOR UPDATE'
      );
      const adminCount = activeRows.filter((row) => normalizeRole(row.officer_role) === ROLES.ADMIN).length;
      if (adminCount <= 1) {
        throw createAccountError('LAST_ADMIN', 'The final active Higher Rank/Admin account cannot be deactivated.');
      }
    }

    await connection.query('UPDATE officers SET is_active = FALSE WHERE id = ?', [officerId]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
