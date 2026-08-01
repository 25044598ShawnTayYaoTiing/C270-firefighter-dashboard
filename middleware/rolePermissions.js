const ROLES = Object.freeze({
  NORMAL: 'Duty Officer',
  HR: 'HR',
  ADMIN: 'Higher Rank/Admin'
});

const PERMISSIONS = Object.freeze({
  MANAGE_USERS: 'manageUsers',
  MANAGE_INCIDENT_DATETIME: 'manageIncidentDateTime',
  REVIEW_UNVERIFIED_LOCATIONS: 'reviewUnverifiedLocations'
});

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();

  if (role === 'hr') return ROLES.HR;
  if (['higher rank/admin', 'higher rank', 'admin', 'administrator', 'supervisor'].includes(role)) {
    return ROLES.ADMIN;
  }

  // Unknown and legacy officer labels receive the least-privileged role.
  return ROLES.NORMAL;
}

function hasPermission(role, permission) {
  const normalizedRole = normalizeRole(role);

  if (permission === PERMISSIONS.MANAGE_USERS) {
    return normalizedRole === ROLES.HR || normalizedRole === ROLES.ADMIN;
  }

  if (permission === PERMISSIONS.MANAGE_INCIDENT_DATETIME) {
    return normalizedRole === ROLES.ADMIN;
  }

  if (permission === PERMISSIONS.REVIEW_UNVERIFIED_LOCATIONS) {
    return normalizedRole === ROLES.ADMIN;
  }

  return false;
}

function getCreatableRoles(role) {
  return normalizeRole(role) === ROLES.ADMIN
    ? Object.values(ROLES)
    : normalizeRole(role) === ROLES.HR
      ? [ROLES.NORMAL]
      : [];
}

module.exports = {
  PERMISSIONS,
  ROLES,
  getCreatableRoles,
  hasPermission,
  normalizeRole
};
