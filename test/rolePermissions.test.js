const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PERMISSIONS,
  ROLES,
  getCreatableRoles,
  hasPermission,
  normalizeRole
} = require('../middleware/rolePermissions');
const { requirePermission } = require('../middleware/authMiddleware');
const officerModel = require('../models/officerModel');
const userController = require('../controllers/userController');

test('legacy officer roles normalize to least privilege', () => {
  assert.equal(normalizeRole('Officer'), ROLES.NORMAL);
  assert.equal(normalizeRole('Duty Officer'), ROLES.NORMAL);
  assert.equal(normalizeRole('unknown role'), ROLES.NORMAL);
});

test('only HR and admin can access user management', () => {
  assert.equal(hasPermission(ROLES.NORMAL, PERMISSIONS.MANAGE_USERS), false);
  assert.equal(hasPermission(ROLES.HR, PERMISSIONS.MANAGE_USERS), true);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGE_USERS), true);
});

test('only admin can manage incident date and time', () => {
  assert.equal(hasPermission(ROLES.NORMAL, PERMISSIONS.MANAGE_INCIDENT_DATETIME), false);
  assert.equal(hasPermission(ROLES.HR, PERMISSIONS.MANAGE_INCIDENT_DATETIME), false);
  assert.equal(hasPermission(ROLES.ADMIN, PERMISSIONS.MANAGE_INCIDENT_DATETIME), true);
});

test('HR can create only normal accounts while admin can assign approved roles', () => {
  assert.deepEqual(getCreatableRoles(ROLES.HR), [ROLES.NORMAL]);
  assert.deepEqual(getCreatableRoles(ROLES.ADMIN), [ROLES.NORMAL, ROLES.HR, ROLES.ADMIN]);
  assert.deepEqual(getCreatableRoles(ROLES.NORMAL), []);
});

test('permission middleware rejects a direct restricted request with 403', () => {
  const middleware = requirePermission(PERMISSIONS.MANAGE_USERS);
  let statusCode = 200;
  let responseBody = '';
  let nextCalled = false;
  const res = {
    status(value) {
      statusCode = value;
      return this;
    },
    send(value) {
      responseBody = value;
      return this;
    }
  };

  middleware({ currentOfficer: { officer_role: ROLES.NORMAL } }, res, () => {
    nextCalled = true;
  });

  assert.equal(statusCode, 403);
  assert.match(responseBody, /do not have permission/i);
  assert.equal(nextCalled, false);
});

test('HR cannot escalate a create-user POST by submitting the admin role', async () => {
  const originalCreate = officerModel.createManagedOfficer;
  let createCalled = false;
  let statusCode = 200;
  let renderedView = '';
  officerModel.createManagedOfficer = async () => {
    createCalled = true;
  };

  const res = {
    status(value) {
      statusCode = value;
      return this;
    },
    render(view, data) {
      renderedView = data.view;
      return this;
    }
  };

  try {
    await userController.createUser({
      body: {
        officerName: 'Escalation Test',
        username: 'escalation.test',
        password: 'valid-password',
        officerRole: ROLES.ADMIN
      },
      currentOfficer: {
        officer_role: ROLES.HR
      }
    }, res, assert.fail);
    assert.equal(statusCode, 400);
    assert.equal(renderedView, 'user-form');
    assert.equal(createCalled, false);
  } finally {
    officerModel.createManagedOfficer = originalCreate;
  }
});

test('admin cannot change their own account role through a modified POST', async () => {
  const originalGet = officerModel.getManagedOfficerById;
  const originalUpdate = officerModel.updateManagedOfficer;
  let updateCalled = false;
  let statusCode = 200;

  officerModel.getManagedOfficerById = async () => ({
    id: 10,
    username: 'current.admin',
    officer_name: 'Current Admin',
    officer_role: ROLES.ADMIN,
    is_active: true
  });
  officerModel.updateManagedOfficer = async () => {
    updateCalled = true;
  };

  const res = {
    status(value) {
      statusCode = value;
      return this;
    },
    render() {
      return this;
    }
  };

  try {
    await userController.updateUser({
      params: { userId: '10' },
      body: {
        officerName: 'Current Admin',
        username: 'current.admin',
        password: '',
        officerRole: ROLES.NORMAL
      },
      currentOfficer: {
        officer_id: 10,
        officer_role: ROLES.ADMIN
      }
    }, res, assert.fail);

    assert.equal(statusCode, 400);
    assert.equal(updateCalled, false);
  } finally {
    officerModel.getManagedOfficerById = originalGet;
    officerModel.updateManagedOfficer = originalUpdate;
  }
});
