document.addEventListener('DOMContentLoaded', () => {
  const mapElement = document.getElementById('incidentMap');
  const dataElement = document.getElementById('incidentMapData');

  if (!mapElement || !dataElement || !window.L) return;

  let mapData;

  try {
    mapData = JSON.parse(dataElement.textContent);
  } catch (error) {
    mapElement.textContent = 'Incident map data could not be loaded.';
    return;
  }

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

  (mapData.markers || []).forEach((incident) => {
    const marker = L.marker([incident.lat, incident.lng]).addTo(map);
    marker.bindPopup(`
      <strong>${escapeHtml(incident.id)}</strong><br>
      ${escapeHtml(incident.type)}<br>
      ${escapeHtml(incident.location)}<br>
      ${escapeHtml(incident.status)}<br>
      <a href="${incident.url}">View Report</a>
    `);
    markerBounds.push([incident.lat, incident.lng]);
  });

  if (markerBounds.length > 0) {
    map.fitBounds(markerBounds, {
      padding: [24, 24],
      maxZoom: 13
    });
  }

  window.setTimeout(() => map.invalidateSize(), 100);
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
