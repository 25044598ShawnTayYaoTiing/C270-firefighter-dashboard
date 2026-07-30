const officerModel = require('../models/officerModel');
const renderLayout = require('../helpers/renderLayout');
const {
  ROLES,
  getCreatableRoles,
  normalizeRole
} = require('../middleware/rolePermissions');

function renderPage(res, view, options) {
  return renderLayout(res, view, {
    pageTitle: 'User Management',
    activePage: 'users',
    ...options
  });
}

function cleanAccountInput(body) {
  return {
    officer_name: String(body.officerName || '').trim(),
    username: String(body.username || '').trim(),
    password: String(body.password || ''),
    officer_role: String(body.officerRole || '').trim()
  };
}

function validateAccount(account, options = {}) {
  const errors = [];
  if (account.officer_name.length < 2 || account.officer_name.length > 100) {
    errors.push('Full name must be between 2 and 100 characters.');
  }
  if (!/^[A-Za-z0-9._@-]{3,50}$/.test(account.username)) {
    errors.push('Username must be 3 to 50 characters and use only letters, numbers, dots, underscores, @, or hyphens.');
  }
  if ((!options.passwordOptional || account.password) && (account.password.length < 8 || account.password.length > 72)) {
    errors.push('Password must be between 8 and 72 characters.');
  }
  if (!options.allowedRoles.includes(account.officer_role)) {
    errors.push('The selected role is not permitted.');
  }
  return errors;
}

function canActorEdit(actor, target) {
  return normalizeRole(actor.officer_role) === ROLES.ADMIN
    || (normalizeRole(actor.officer_role) === ROLES.HR
      && normalizeRole(target.officer_role) === ROLES.NORMAL);
}

function accountErrorStatus(error) {
  return ['FORBIDDEN_ACCOUNT_ACTION', 'FORBIDDEN_ROLE'].includes(error.code) ? 403 : 400;
}

function getEditableRoles(actor, account) {
  if (Number(actor.officer_id) === Number(account.id)) {
    return [normalizeRole(account.officer_role)];
  }

  return normalizeRole(actor.officer_role) === ROLES.HR
    ? [ROLES.NORMAL]
    : getCreatableRoles(actor.officer_role);
}

exports.showUsers = async (req, res, next) => {
  try {
    const users = await officerModel.getAllOfficers();
    return renderPage(res, 'users', {
      users,
      message: req.query.message || '',
      error: ''
    });
  } catch (error) {
    return next(error);
  }
};

exports.showAddUser = (req, res) => {
  return renderPage(res, 'user-form', {
    pageTitle: 'Add User',
    mode: 'create',
    account: {},
    allowedRoles: getCreatableRoles(req.currentOfficer.officer_role),
    errors: []
  });
};

exports.createUser = async (req, res, next) => {
  const account = cleanAccountInput(req.body);
  const allowedRoles = getCreatableRoles(req.currentOfficer.officer_role);
  const errors = validateAccount(account, { allowedRoles });

  if (errors.length) {
    return renderPage(res.status(400), 'user-form', {
      pageTitle: 'Add User',
      mode: 'create',
      account: { ...account, password: '' },
      allowedRoles,
      errors
    });
  }

  try {
    await officerModel.createManagedOfficer(account, req.currentOfficer.officer_role);
    return res.redirect('/users?message=User%20account%20created.');
  } catch (error) {
    if (['DUPLICATE_USERNAME', 'FORBIDDEN_ROLE'].includes(error.code)) {
      return renderPage(res.status(accountErrorStatus(error)), 'user-form', {
        pageTitle: 'Add User',
        mode: 'create',
        account: { ...account, password: '' },
        allowedRoles,
        errors: [error.message]
      });
    }
    return next(error);
  }
};

exports.showEditUser = async (req, res, next) => {
  try {
    const account = await officerModel.getManagedOfficerById(req.params.userId);
    if (!account) return res.status(404).send('User account not found.');
    if (!canActorEdit(req.currentOfficer, account)) {
      return res.status(403).send('Forbidden: you cannot manage this account.');
    }

    return renderPage(res, 'user-form', {
      pageTitle: 'Edit User',
      mode: 'edit',
      account,
      allowedRoles: getEditableRoles(req.currentOfficer, account),
      errors: []
    });
  } catch (error) {
    return next(error);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const existingAccount = await officerModel.getManagedOfficerById(req.params.userId);
    if (!existingAccount) return res.status(404).send('User account not found.');
    if (!canActorEdit(req.currentOfficer, existingAccount)) {
      return res.status(403).send('Forbidden: you cannot manage this account.');
    }

    const account = cleanAccountInput(req.body);
    const allowedRoles = getEditableRoles(req.currentOfficer, existingAccount);
    const errors = validateAccount(account, { allowedRoles, passwordOptional: true });
    if (errors.length) {
      return renderPage(res.status(400), 'user-form', {
        pageTitle: 'Edit User',
        mode: 'edit',
        account: { ...existingAccount, ...account, password: '' },
        allowedRoles,
        errors
      });
    }

    await officerModel.updateManagedOfficer(req.params.userId, account, req.currentOfficer);
    return res.redirect('/users?message=User%20account%20updated.');
  } catch (error) {
    if (['DUPLICATE_USERNAME', 'FORBIDDEN_ACCOUNT_ACTION', 'FORBIDDEN_ROLE', 'SELF_ROLE_CHANGE', 'LAST_ADMIN'].includes(error.code)) {
      return res.status(accountErrorStatus(error)).send(error.message);
    }
    return next(error);
  }
};

exports.deactivateUser = async (req, res, next) => {
  try {
    await officerModel.deactivateManagedOfficer(req.params.userId, req.currentOfficer);
    return res.redirect('/users?message=User%20account%20deactivated.');
  } catch (error) {
    if (['ACCOUNT_NOT_FOUND', 'FORBIDDEN_ACCOUNT_ACTION', 'SELF_DEACTIVATION', 'LAST_ADMIN'].includes(error.code)) {
      return res.status(accountErrorStatus(error)).send(error.message);
    }
    return next(error);
  }
};
