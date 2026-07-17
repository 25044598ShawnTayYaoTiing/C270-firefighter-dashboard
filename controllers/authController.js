// done by Thein 25040396
// AI Features: authController.js manages user authentication, including login and logout processes, with session handling and access control.
const authModel = require('../models/authModel');

const INVALID_LOGIN_MESSAGE = 'Invalid username or password.';
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'firefighter.sid';

function getSafeRedirect(value) {
  if (!value || typeof value !== 'string') return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  if (value.startsWith('/login') || value.startsWith('/logout')) return '/dashboard';

  return value;
}

function renderLogin(res, options = {}) {
  return res.render('login', {
    appName: 'Firefighter Incident Command',
    pageTitle: 'Officer Login',
    error: '',
    username: '',
    next: '/dashboard',
    ...options
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) {
      resolve();
      return;
    }

    req.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

exports.showLogin = (req, res) => {
  return renderLogin(res, {
    next: getSafeRedirect(req.query.next)
  });
};

exports.login = async (req, res, next) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const nextUrl = getSafeRedirect(req.body.next || req.query.next);

  try {
    const officer = await authModel.verifyOfficerCredentials(username, password);

    if (!officer) {
      return renderLogin(res.status(401), {
        error: INVALID_LOGIN_MESSAGE,
        username,
        next: nextUrl
      });
    }

    await regenerateSession(req);

    req.session.officer_id = officer.id;
    req.session.username = officer.username;
    req.session.officer_name = officer.officer_name;
    req.session.officer_role = officer.officer_role;

    await saveSession(req);

    return res.redirect(nextUrl);
  } catch (error) {
    return next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie(SESSION_COOKIE_NAME);

    return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
};
