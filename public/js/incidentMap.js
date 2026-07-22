// Done By Fatin ID: 25050557
// Initialize the Leaflet map and display database-backed incident intelligence layers.
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
  const mappedIncidents = (Array.isArray(mapData.markers) ? mapData.markers : [])
    .filter(shouldShowOnLiveMap);
  const unmappedIncidents = (Array.isArray(mapData.unmapped) ? mapData.unmapped : [])
    .filter((incident) => !isCompletedLikeStatus(incident.response_status || incident.status));
  const filterSourceIncidents = [...mappedIncidents, ...unmappedIncidents];

  const singaporeBounds = L.latLngBounds(
    [1.10, 103.55],
    [1.50, 104.45]
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

  // Load OpenStreetMap tiles to provide the map background.
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const markerGroup = createMarkerGroup();
  const heatLayer = createHeatLayer();
  const controls = getMapControls();
  const state = {
    view: 'markers'
  };

  setupMapControls(controls, filterSourceIncidents, heatLayer, () => {
    renderIncidentLayers();
  }, (view) => {
    state.view = view;
    updateViewButtons(controls.viewButtons, state.view);
    updateVisibleLayer(map, markerGroup, heatLayer, state.view);
  });

  function renderIncidentLayers() {
    const filters = getActiveFilters(controls);
    const filteredMappedIncidents = mappedIncidents.filter((incident) => matchesFilters(incident, filters));
    const filteredUnmappedIncidents = unmappedIncidents.filter((incident) => matchesFilters(incident, filters));
    const displayedIncidents = [...filteredMappedIncidents, ...filteredUnmappedIncidents];

    renderMarkerLayer(markerGroup, filteredMappedIncidents);
    renderHeatLayer(heatLayer, filteredMappedIncidents);
    updateVisibleLayer(map, markerGroup, heatLayer, state.view);
    renderUnmappedIncidents(filteredUnmappedIncidents);
    updateHotspotSummary(displayedIncidents, controls);
    updateEmptyMapState(mapElement, filteredMappedIncidents.length, displayedIncidents.length, incidents.length);
    fitMapToIncidents(map, filteredMappedIncidents);
  }

  renderIncidentLayers();
  window.setTimeout(() => map.invalidateSize(), 100);
});

function getMapControls() {
  return {
    container: document.getElementById('incidentMapControls'),
    viewButtons: Array.from(document.querySelectorAll('[data-map-view]')),
    typeFilter: document.getElementById('incidentTypeFilter'),
    severityFilter: document.getElementById('incidentSeverityFilter'),
    dateFromFilter: document.getElementById('incidentDateFromFilter'),
    dateToFilter: document.getElementById('incidentDateToFilter'),
    resetButton: document.getElementById('resetIncidentMapFilters'),
    totalElement: document.getElementById('hotspotTotalIncidents'),
    topLocationElement: document.getElementById('hotspotTopLocation'),
    topTypeElement: document.getElementById('hotspotTopType')
  };
}

function setupMapControls(controls, incidents, heatLayer, onFiltersChanged, onViewChanged) {
  populateSelect(controls.typeFilter, 'All types', getUniqueValues(incidents, getIncidentType));
  populateSelect(controls.severityFilter, 'All statuses', getUniqueValues(incidents, getIncidentSeverity));
  setDateFilterBounds(controls, incidents);
  updateViewButtons(controls.viewButtons, 'markers');

  if (controls.container) {
    controls.container.hidden = false;
  }

  if (!heatLayer) {
    const heatmapButton = controls.viewButtons.find((button) => button.dataset.mapView === 'heatmap');

    if (heatmapButton) {
      heatmapButton.disabled = true;
      heatmapButton.title = 'Heatmap library could not be loaded.';
    }
  }

  controls.viewButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.mapView;

      if (view === 'heatmap' && !heatLayer) return;
      onViewChanged(view === 'heatmap' ? 'heatmap' : 'markers');
    });
  });

  [
    controls.typeFilter,
    controls.severityFilter,
    controls.dateFromFilter,
    controls.dateToFilter
  ].filter(Boolean).forEach((control) => {
    control.addEventListener('change', onFiltersChanged);
  });

  if (controls.resetButton) {
    controls.resetButton.addEventListener('click', () => {
      [
        controls.typeFilter,
        controls.severityFilter,
        controls.dateFromFilter,
        controls.dateToFilter
      ].filter(Boolean).forEach((control) => {
        control.value = '';
      });

      onFiltersChanged();
    });
  }
}

function createMarkerGroup() {
  if (typeof L.markerClusterGroup === 'function') {
    return L.markerClusterGroup({
      chunkedLoading: true,
      disableClusteringAtZoom: 17,
      maxClusterRadius: 48,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true
    });
  }

  return L.layerGroup();
}

function createHeatLayer() {
  if (typeof L.heatLayer !== 'function') return null;

  return L.heatLayer([], {
    blur: 24,
    gradient: {
      0.2: '#ffffb2',
      0.4: '#fecc5c',
      0.6: '#fd8d3c',
      0.8: '#f03b20',
      1.0: '#bd0026'
    },
    max: 2.6,
    maxZoom: 17,
    minOpacity: 0.42,
    radius: 36
  });
}

function renderMarkerLayer(markerGroup, incidents) {
  markerGroup.clearLayers();

  incidents.forEach((incident) => {
    const latLng = getIncidentLatLng(incident);

    if (!latLng) return;

    const color = getSafeMarkerColor(
      incident.markerColor || getIncidentMarkerColor(incident.response_status || incident.status)
    );
    const marker = L.marker(latLng, {
      icon: L.divIcon({
        className: 'incident-map-marker',
        html: `<span style="--marker-color: ${escapeAttribute(color)}"></span>`,
        iconAnchor: [11, 11],
        iconSize: [22, 22],
        popupAnchor: [0, -11]
      })
    });

    marker.bindPopup(buildPopup(incident));
    markerGroup.addLayer(marker);
  });
}

function renderHeatLayer(heatLayer, incidents) {
  if (!heatLayer) return;

  heatLayer.setLatLngs(incidents
    .map((incident) => {
      const latLng = getIncidentLatLng(incident);
      return latLng ? [latLng[0], latLng[1], 0.65] : null;
    })
    .filter(Boolean));
}

function updateVisibleLayer(map, markerGroup, heatLayer, view) {
  if (map.hasLayer(markerGroup)) {
    map.removeLayer(markerGroup);
  }

  if (heatLayer && map.hasLayer(heatLayer)) {
    map.removeLayer(heatLayer);
  }

  if (view === 'heatmap' && heatLayer) {
    heatLayer.addTo(map);
    return;
  }

  markerGroup.addTo(map);
}

function getActiveFilters(controls) {
  return {
    type: controls.typeFilter ? controls.typeFilter.value : '',
    severity: controls.severityFilter ? controls.severityFilter.value : '',
    dateFrom: controls.dateFromFilter ? controls.dateFromFilter.value : '',
    dateTo: controls.dateToFilter ? controls.dateToFilter.value : ''
  };
}

function matchesFilters(incident, filters) {
  const incidentType = getIncidentType(incident);
  const incidentSeverity = getIncidentSeverity(incident);
  const incidentDate = getIncidentDateKey(incident);

  if (filters.type && incidentType !== filters.type) return false;
  if (filters.severity && incidentSeverity !== filters.severity) return false;

  if ((filters.dateFrom || filters.dateTo) && !incidentDate) return false;
  if (filters.dateFrom && incidentDate < filters.dateFrom) return false;
  if (filters.dateTo && incidentDate > filters.dateTo) return false;

  return true;
}

function populateSelect(selectElement, defaultLabel, values) {
  if (!selectElement) return;

  selectElement.textContent = '';
  appendSelectOption(selectElement, '', defaultLabel);

  values.forEach((value) => {
    appendSelectOption(selectElement, value, value);
  });
}

function appendSelectOption(selectElement, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  selectElement.appendChild(option);
}

function setDateFilterBounds(controls, incidents) {
  const dateKeys = getUniqueValues(incidents, getIncidentDateKey);

  if (!dateKeys.length) return;

  const minDate = dateKeys[0];
  const maxDate = dateKeys[dateKeys.length - 1];

  [controls.dateFromFilter, controls.dateToFilter].filter(Boolean).forEach((input) => {
    input.min = minDate;
    input.max = maxDate;
  });
}

function getUniqueValues(incidents, getValue) {
  return Array.from(new Set(incidents
    .map((incident) => displayValue(getValue(incident), ''))
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

function renderUnmappedIncidents(incidents) {
  const list = document.getElementById('unmappedIncidentList');
  if (!list) return;

  Array.from(list.querySelectorAll('a[data-incident-id]')).forEach((item) => item.remove());
  list.hidden = incidents.length === 0;
  incidents.forEach((incident) => appendUnmappedIncident(incident, list));
}

function updateHotspotSummary(incidents, controls) {
  if (controls.totalElement) {
    controls.totalElement.textContent = String(incidents.length);
  }

  if (controls.topLocationElement) {
    controls.topLocationElement.textContent = getTopLocationSummary(incidents);
  }

  if (controls.topTypeElement) {
    controls.topTypeElement.textContent = getTopTypeSummary(incidents);
  }
}

function getTopLocationSummary(incidents) {
  const topLocation = getTopCount(incidents, (incident) => (
    incident.cleanedLocation || incident.location
  ));

  if (!topLocation) return 'Not available';
  if (topLocation.count <= 1) return 'No significant hotspot detected';

  return `${topLocation.label} (${topLocation.count})`;
}

function getTopTypeSummary(incidents) {
  const topType = getTopCount(incidents, getIncidentType);

  return topType
    ? `${topType.label} (${topType.count})`
    : 'Not available';
}

function getTopCount(incidents, getValue) {
  const counts = incidents.reduce((totals, incident) => {
    const label = displayValue(getValue(incident), '');

    if (label) {
      totals[label] = (totals[label] || 0) + 1;
    }

    return totals;
  }, {});

  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0] || null;
}

function fitMapToIncidents(map, incidents) {
  const latLngs = incidents
    .map(getIncidentLatLng)
    .filter(Boolean);

  if (!latLngs.length) return;

  if (latLngs.length === 1) {
    map.setView(latLngs[0], 13, { animate: false });
    return;
  }

  const bounds = L.latLngBounds(latLngs);

  if (bounds.isValid()) {
    map.fitBounds(bounds.pad(0.18), {
      animate: false,
      maxZoom: 13
    });
  }
}

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

function updateEmptyMapState(mapElement, mappedCount, displayedCount, totalIncidentCount) {
  const existingState = mapElement.querySelector('.map-empty-state');

  if (mappedCount > 0) {
    if (existingState) existingState.remove();
    return;
  }

  const emptyState = existingState || document.createElement('div');
  emptyState.className = 'map-empty-state';
  emptyState.textContent = getEmptyMapMessage(displayedCount, totalIncidentCount);

  if (!existingState) {
    mapElement.appendChild(emptyState);
  }
}

function getEmptyMapMessage(displayedCount, totalIncidentCount) {
  if (displayedCount > 0) return 'Filtered incidents do not have mapped coordinates.';
  if (totalIncidentCount > 0) return 'No active incidents match the current filters.';
  return 'No incident reports available.';
}

function appendUnmappedIncident(incident, list) {
  const targetList = list || document.getElementById('unmappedIncidentList');
  if (!targetList) return;

  const incidentId = displayValue(incident.incident_id || incident.id);
  const alreadyListed = Array.from(targetList.querySelectorAll('a[data-incident-id]'))
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
  targetList.appendChild(link);
  targetList.hidden = false;
}

function appendLine(parent, tagName, value) {
  const element = document.createElement(tagName);
  element.textContent = value;
  parent.appendChild(element);
}

function getIncidentLatLng(incident) {
  if (!incident) return null;

  const latitude = Number(incident.latitude ?? incident.lat);
  const longitude = Number(incident.longitude ?? incident.lng);

  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? [latitude, longitude]
    : null;
}

function getIncidentType(incident) {
  return displayValue(incident && (incident.incident_type || incident.type), '');
}

function getIncidentSeverity(incident) {
  return displayValue(incident && (incident.severity || incident.response_status || incident.status), '');
}

function getIncidentDateKey(incident) {
  const dateKey = displayValue(incident && incident.incident_date, '');

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;

  const dateTime = displayValue(incident && (incident.incident_datetime || incident.dateInput), '');

  if (/^\d{4}-\d{2}-\d{2}/.test(dateTime)) return dateTime.slice(0, 10);

  const parsedDate = new Date(dateTime);

  if (Number.isNaN(parsedDate.getTime())) return '';

  return [
    parsedDate.getFullYear(),
    String(parsedDate.getMonth() + 1).padStart(2, '0'),
    String(parsedDate.getDate()).padStart(2, '0')
  ].join('-');
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

function isCompletedLikeStatus(status) {
  const value = String(status || '').toLowerCase();

  return (
    value.includes('completed')
    || value.includes('reviewed')
    || value.includes('closed')
    || value.includes('resolved')
  );
}

function shouldShowOnLiveMap(incident) {
  return !isCompletedLikeStatus(incident && (incident.response_status || incident.status))
    && Boolean(getIncidentLatLng(incident));
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

function getSafeMarkerColor(color) {
  const text = displayValue(color, '');

  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text)
    ? text
    : getIncidentMarkerColor('');
}

function statusKey(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '-');
}

function updateViewButtons(buttons, currentView) {
  buttons.forEach((button) => {
    const isActive = button.dataset.mapView === currentView;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
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
