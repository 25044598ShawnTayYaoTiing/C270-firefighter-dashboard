// done by Thein 25040396
// AI Features: authMiddleware.js provides middleware functions for authentication, including session management and access control for protected routes.
function getCurrentOfficer(session) {
  if (!session || !session.officer_id) return null;

  return {
    officer_id: session.officer_id,
    officer_name: session.officer_name || '',
    officer_role: session.officer_role || ''
  };
}

function getLoginRedirectUrl(req) {
  const nextUrl = req.originalUrl && req.originalUrl !== '/'
    ? req.originalUrl
    : '/dashboard';

  return `/login?next=${encodeURIComponent(nextUrl)}`;
}

exports.attachCurrentOfficer = (req, res, next) => {
  const currentOfficer = getCurrentOfficer(req.session);

  req.currentOfficer = currentOfficer;
  res.locals.currentOfficer = currentOfficer;
  next();
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
