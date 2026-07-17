// done by Thein 25040396
// AI Features: authMiddleware.js provides middleware functions for authentication, including session management and access control for protected routes.
const officerModel = require('../models/officerModel');
const {
  hasPermission,
  normalizeRole
} = require('./rolePermissions');

function getCurrentOfficer(session) {
  if (!session || !session.officer_id) return null;

  return {
    officer_id: session.officer_id,
    username: session.username || '',
    officer_name: session.officer_name || '',
    officer_role: normalizeRole(session.officer_role)
  };
}

function getLoginRedirectUrl(req) {
  const nextUrl = req.originalUrl && req.originalUrl !== '/'
    ? req.originalUrl
    : '/dashboard';

  return `/login?next=${encodeURIComponent(nextUrl)}`;
}

exports.attachCurrentOfficer = async (req, res, next) => {
  try {
    const sessionOfficer = getCurrentOfficer(req.session);
    let currentOfficer = null;

    if (sessionOfficer) {
      const activeOfficer = await officerModel.findActiveOfficerById(sessionOfficer.officer_id);

      if (activeOfficer) {
        currentOfficer = {
          officer_id: activeOfficer.id,
          username: activeOfficer.username,
          officer_name: activeOfficer.officer_name,
          officer_role: normalizeRole(activeOfficer.officer_role)
        };
        req.session.username = currentOfficer.username;
        req.session.officer_name = currentOfficer.officer_name;
        req.session.officer_role = currentOfficer.officer_role;
      } else {
        delete req.session.officer_id;
        delete req.session.username;
        delete req.session.officer_name;
        delete req.session.officer_role;
      }
    }

    req.currentOfficer = currentOfficer;
    res.locals.currentOfficer = currentOfficer;
    res.locals.hasPermission = (permission) => Boolean(
      currentOfficer && hasPermission(currentOfficer.officer_role, permission)
    );
    return next();
  } catch (error) {
    return next(error);
  }
};

exports.requireAuth = (req, res, next) => {
  if (req.currentOfficer || getCurrentOfficer(req.session)) {
    return next();
  }

  return res.redirect(getLoginRedirectUrl(req));
};

exports.redirectIfAuthenticated = (req, res, next) => {
  if (req.currentOfficer || getCurrentOfficer(req.session)) {
    return res.redirect('/dashboard');
  }

  return next();
};

exports.requirePermission = (permission) => (req, res, next) => {
  const currentOfficer = req.currentOfficer || getCurrentOfficer(req.session);

  if (currentOfficer && hasPermission(currentOfficer.officer_role, permission)) {
    return next();
  }

  return res.status(403).send('Forbidden: you do not have permission to access this resource.');
};
