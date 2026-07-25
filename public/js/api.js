(function configureApiUrl() {
  const configuredBackendUrl = window.APP_CONFIG && window.APP_CONFIG.backendUrl
    ? window.APP_CONFIG.backendUrl.replace(/\/$/, '')
    : '';

  window.apiUrl = function apiUrl(path) {
    if (!configuredBackendUrl) return path;
    return `${configuredBackendUrl}${path.startsWith('/') ? path : `/${path}`}`;
  };
}());
