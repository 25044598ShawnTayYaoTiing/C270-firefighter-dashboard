const { APP_NAME } = require('../config/application');

function renderLayout(res, view, options = {}) {
  return res.render('layout', {
    view,
    appName: APP_NAME,
    pageTitle: 'Dashboard',
    activePage: 'dashboard',
    ...options
  });
}

module.exports = renderLayout;
