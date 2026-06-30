document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('incidentMap');
  const dataElement = document.getElementById('incidentMapData');

  if (!mapElement || !dataElement) return;

  if (!window.L) {
    mapElement.textContent = 'Incident map could not be loaded.';
    return;
  }

  if (mapElement.dataset.mapInitialized === 'true') return;
  mapElement.dataset.mapInitialized = 'true';

  let mapData;

  try {
    mapData = JSON.parse(dataElement.textContent || '{}');
  } catch (error) {
    mapElement.textContent = 'Incident map data could not be loaded.';
    return;
  }

  const incidents = Array.isArray(mapData.incidents) ? mapData.incidents : [];
  const markers = Array.isArray(mapData.markers) ? mapData.markers : [];

  const singaporeBounds = L.latLngBounds(
    [1.15, 103.55],
    [1.50, 104.15]
  );

  const map = L.map(mapElement, {
    center: [1.3521, 103.8198],
    zoom: 11,
    minZoom: 10,
    maxZoom: 18,
    maxBounds: singaporeBounds,
    maxBoundsViscosity: 1.0,
    scrollWheelZoom: false
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const markerGroup = L.layerGroup().addTo(map);
  const invalidMarkers = [];

  markerGroup.clearLayers();

  markers
    .filter((incident) => shouldShowOnLiveMap(incident.response_status || incident.status))
    .forEach((incident) => {
      const latitude = Number(incident.latitude !== undefined ? incident.latitude : incident.lat);
      const longitude = Number(incident.longitude !== undefined ? incident.longitude : incident.lng);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !isSingaporeCoordinate(latitude, longitude)) {
        invalidMarkers.push({
          ...incident,
          reason: 'Missing coordinates or location not mapped.'
        });
        return;
      }

      const color = incident.markerColor || getIncidentMarkerColor(incident.response_status || incident.status);
      const marker = L.circleMarker([latitude, longitude], {
        radius: 9,
        color,
        fillColor: color,
        fillOpacity: 0.85,
        weight: 2
      }).addTo(markerGroup);

      marker.bindPopup(buildPopup(incident));
    });

  invalidMarkers
    .filter((incident) => shouldShowOnLiveMap(incident.response_status || incident.status))
    .forEach(appendUnmappedIncident);

  if (markerGroup.getLayers().length === 0) {
    showEmptyMapState(mapElement, incidents.length);
  }

  window.setTimeout(() => map.invalidateSize(), 100);
});

function buildPopup(incident) {
  const incidentId = displayValue(incident.incident_id || incident.id);
  const incidentType = displayValue(incident.incident_type || incident.type);
  const displayLocation = displayValue(incident.cleanedLocation || incident.location);
  const status = displayValue(incident.response_status || incident.status);
  const url = getReportUrl(incident);
  const confidence = displayValue(incident.aiConfidence, '')
    ? `<br>Location confidence: ${escapeHtml(incident.aiConfidence)}`
    : '';

  return `
    <strong>Incident ${escapeHtml(incidentId)}</strong><br>
    Type: ${escapeHtml(incidentType)}<br>
    Location: ${escapeHtml(displayLocation)}<br>
    Status: ${escapeHtml(status)}
    ${confidence}<br>
    <a href="${escapeAttribute(url)}">View Report</a>
  `;
}

function showEmptyMapState(mapElement, incidentCount) {
  const existingState = mapElement.querySelector('.map-empty-state');
  if (existingState) existingState.remove();

  const emptyState = document.createElement('div');
  emptyState.className = 'map-empty-state';
  emptyState.textContent = incidentCount > 0
    ? 'Active incident locations need verification before they can be mapped.'
    : 'No active incident locations yet.';
  mapElement.appendChild(emptyState);
}

function appendUnmappedIncident(incident) {
  const list = document.getElementById('unmappedIncidentList');
  if (!list) return;

  const incidentId = displayValue(incident.incident_id || incident.id);
  const alreadyListed = Array.from(list.querySelectorAll('a[data-incident-id]'))
    .some((item) => item.dataset.incidentId === incidentId);

  if (alreadyListed) return;

  const link = document.createElement('a');
  link.href = getReportUrl(incident);
  link.dataset.incidentId = incidentId;

  const details = document.createElement('span');
  appendLine(details, 'strong', incidentId);
  appendLine(details, 'small', `Type: ${displayValue(incident.incident_type || incident.type)}`);
  appendLine(details, 'small', `Location: ${displayValue(incident.cleanedLocation || incident.location)}`);
  appendLine(details, 'small', `Reason: ${displayValue(incident.reason, 'Missing coordinates or location not mapped.')}`);

  const status = displayValue(incident.response_status || incident.status);
  const badge = document.createElement('span');
  badge.className = `status-badge status-${statusKey(status)}`;
  badge.textContent = status;

  link.appendChild(details);
  link.appendChild(badge);
  list.appendChild(link);
  list.hidden = false;
}

function appendLine(parent, tagName, value) {
  const element = document.createElement(tagName);
  element.textContent = value;
  parent.appendChild(element);
}

function displayValue(value, fallback = 'Not specified') {
  const text = String(value === null || value === undefined ? '' : value).trim();

  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') {
    return fallback;
  }

  return text;
}

function getReportUrl(incident) {
  const url = displayValue(incident.url, '');

  if (url.startsWith('/incidents/')) return url;

  const incidentId = displayValue(incident.incident_id || incident.id, '');
  return incidentId ? `/incidents/${encodeURIComponent(incidentId)}` : '#';
}

function shouldShowOnLiveMap(status) {
  const value = String(status || '').toLowerCase();

  return !(
    value.includes('completed')
    || value.includes('reviewed')
    || value.includes('closed')
    || value.includes('resolved')
  );
}

function getIncidentMarkerColor(status) {
  const value = String(status || '').toLowerCase();

  if (value.includes('escalated') || value.includes('urgent') || value.includes('critical')) {
    return '#dc3545';
  }

  if (value.includes('pending') || value.includes('awaiting')) {
    return '#fd7e14';
  }

  if (
    value.includes('active')
    || value.includes('ongoing')
    || value.includes('dispatched')
    || value.includes('progress')
  ) {
    return '#0d6efd';
  }

  if (
    value.includes('completed')
    || value.includes('reviewed')
    || value.includes('closed')
    || value.includes('resolved')
  ) {
    return '#6c757d';
  }

  return '#0d6efd';
}

function isSingaporeCoordinate(latitude, longitude) {
  return latitude >= 1.15
    && latitude <= 1.50
    && longitude >= 103.55
    && longitude <= 104.15;
}

function statusKey(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '-');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
