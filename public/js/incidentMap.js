document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('incidentMap');
  const dataElement = document.getElementById('incidentMapData');

  if (!mapElement || !dataElement || !window.L) return;

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

  const markerBounds = [];

  markers.forEach((incident) => {
    const latitude = Number(incident.lat);
    const longitude = Number(incident.lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const marker = L.marker([latitude, longitude]).addTo(map);
    marker.bindPopup(buildPopup(incident));
    markerBounds.push([latitude, longitude]);
  });

  if (markerBounds.length > 0) {
    map.fitBounds(markerBounds, {
      padding: [24, 24],
      maxZoom: 13
    });
  } else {
    showEmptyMapState(mapElement, incidents.length);
  }

  window.setTimeout(() => map.invalidateSize(), 100);
});

function buildPopup(incident) {
  const displayLocation = incident.cleanedLocation || incident.location || 'Location not recorded';
  const confidence = incident.aiConfidence
    ? `<br>Location confidence: ${escapeHtml(incident.aiConfidence)}`
    : '';

  return `
    <strong>${escapeHtml(incident.incident_id || incident.id)}</strong><br>
    ${escapeHtml(incident.incident_type || incident.type)}<br>
    ${escapeHtml(displayLocation)}<br>
    Status: ${escapeHtml(incident.response_status || incident.status)}
    ${confidence}<br>
    <a href="${escapeAttribute(incident.url || '#')}">View Report</a>
  `;
}

function showEmptyMapState(mapElement, incidentCount) {
  const emptyState = document.createElement('div');
  emptyState.className = 'map-empty-state';
  emptyState.textContent = incidentCount > 0
    ? 'Incident locations need verification before they can be mapped.'
    : 'No mapped incident locations yet.';
  mapElement.appendChild(emptyState);
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
