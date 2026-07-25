document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('[data-incident-form]');
  if (!form) return;

  const SINGAPORE_BOUNDS = {
    minLat: 1.10,
    maxLat: 1.50,
    minLng: 103.55,
    maxLng: 104.45
  };
  const requiredFields = [
    { name: 'incidentType', message: 'Incident type is required.' },
    { name: 'incidentLocation', message: 'Please enter the incident location.' },
    { name: 'incidentDateTime', message: 'Enter a valid incident date and time.' },
    { name: 'responseStatus', message: 'Select a valid response status.' },
    { name: 'incidentSummary', message: 'Incident description cannot be empty.' }
  ];
  const conditionalFields = [
    { name: 'hazards', message: 'Confirm that no hazards were reported or enter the hazard details.' },
    { name: 'injuredPersons', message: 'Confirm that no injured or trapped persons were reported or enter the details.' }
  ];
  const controls = {
    locationInput: form.elements.incidentLocation,
    latitudeInput: form.elements.latitude,
    longitudeInput: form.elements.longitude,
    locationVerifiedInput: form.elements.locationVerified,
    locationSourceInput: form.elements.locationVerificationSource,
    verifiedLocationLabelInput: form.elements.verifiedLocationLabel,
    verifyButton: document.getElementById('verifyLocationButton'),
    status: document.getElementById('locationVerificationStatus'),
    message: document.getElementById('locationVerificationMessage'),
    previewMap: document.getElementById('locationPreviewMap'),
    coordinateReadout: document.getElementById('locationCoordinateReadout'),
    errorSummary: form.querySelector('[data-form-error-summary]'),
  };
  let verifiedAddress = normalizeText(controls.locationInput ? controls.locationInput.value : '');
  let locationMap = null;
  let locationMarker = null;
  let submitting = false;

  setupLocationVerification();
  setupValidation();
  initializeVerifiedLocation();

  function setupLocationVerification() {
    if (!controls.locationInput || !controls.verifyButton) return;

    controls.verifyButton.addEventListener('click', verifyLocation);
    controls.locationInput.addEventListener('input', () => {
      if (isLocationVerified() && normalizeText(controls.locationInput.value) !== verifiedAddress) {
        resetLocationVerification('Location changed. Verify the updated address before saving.');
      }
    });
    form.addEventListener('reset', () => {
      window.setTimeout(() => {
        resetLocationVerification('Verify the address before saving this report.');
        clearAllFieldErrors();
        hideErrorSummary();
      }, 0);
    });
  }

  function setupValidation() {
    requiredFields.forEach((field) => {
      const input = form.elements[field.name];
      if (!input) return;

      input.addEventListener('input', () => validateField(field.name));
      input.addEventListener('change', () => validateField(field.name));
    });
    conditionalFields.forEach((field) => {
      const input = form.elements[field.name];
      if (!input) return;

      input.addEventListener('input', () => validateConditionalField(field.name));
      input.addEventListener('change', () => validateConditionalField(field.name));
    });

    form.addEventListener('submit', (event) => {
      if (submitting) {
        event.preventDefault();
        return;
      }

      const savingDraft = event.submitter && event.submitter.value === 'draft';

      if (savingDraft) {
        clearAllFieldErrors();
        hideErrorSummary();
      } else if (!validateForm()) {
        event.preventDefault();
        return;
      }

      submitting = true;
      setSubmittingState(event.submitter);
    });
  }

  function initializeVerifiedLocation() {
    const latitude = getNumber(controls.latitudeInput && controls.latitudeInput.value);
    const longitude = getNumber(controls.longitudeInput && controls.longitudeInput.value);

    if (isLocationVerified() && isValidOperationalCoordinate(latitude, longitude)) {
      const label = controls.verifiedLocationLabelInput && controls.verifiedLocationLabelInput.value
        ? controls.verifiedLocationLabelInput.value
        : controls.locationInput.value;

      setVerifiedLocation({
        latitude,
        longitude,
        label,
        source: controls.locationSourceInput ? controls.locationSourceInput.value : 'existing-coordinates'
      }, 'Location verified');
      return;
    }

    resetLocationVerification('Verify the address before saving this report.');
  }

  async function verifyLocation() {
    const location = controls.locationInput.value.trim();

    if (!location) {
      setFieldError('incidentLocation', 'Please enter the incident location.');
      setLocationStatus('failed', 'Unable to verify');
      setLocationMessage('Please enter the incident location before verifying.');
      controls.locationInput.focus();
      return;
    }

    controls.verifyButton.disabled = true;
    setLocationStatus('checking', 'Verifying...');
    setLocationMessage('Checking the location against the configured geocoding service.');

    try {
      const response = await fetch(window.apiUrl('/api/locations/verify'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          location,
          incidentSummary: getFieldValue('incidentSummary'),
          transcript: getFieldValue('transcript')
        })
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Unable to verify this location.');
      }

      setVerifiedLocation({
        latitude: data.latitude,
        longitude: data.longitude,
        label: data.resolvedLocation || location,
        source: data.source || 'resolver'
      }, 'Location verified');
      clearFieldError('incidentLocation');
    } catch (error) {
      resetLocationVerification(error.message || 'Unable to verify this location. Please check the address and try again.', {
        failed: true
      });
      setFieldError('incidentLocation', 'Unable to verify this location. Please check the address.');
    } finally {
      controls.verifyButton.disabled = false;
    }
  }

  function setVerifiedLocation(result, message) {
    const latitude = getNumber(result.latitude);
    const longitude = getNumber(result.longitude);

    if (!isValidOperationalCoordinate(latitude, longitude)) {
      resetLocationVerification('Verified coordinates fall outside the Singapore operational map boundary.', {
        failed: true
      });
      return;
    }

    verifiedAddress = normalizeText(controls.locationInput.value);
    controls.latitudeInput.value = latitude.toFixed(7);
    controls.longitudeInput.value = longitude.toFixed(7);
    controls.locationVerifiedInput.value = 'true';
    controls.locationSourceInput.value = result.source || 'verified';
    controls.verifiedLocationLabelInput.value = result.label || controls.locationInput.value;
    dispatchLocationVerificationUpdate();

    setLocationStatus('verified', message || 'Location verified');
    setLocationMessage(`${controls.verifiedLocationLabelInput.value}`);
    showCoordinateReadout(latitude, longitude);
    showPreviewMap(latitude, longitude);
  }

  function resetLocationVerification(message, options = {}) {
    if (controls.locationVerifiedInput) controls.locationVerifiedInput.value = '';
    if (controls.locationSourceInput) controls.locationSourceInput.value = '';
    if (controls.verifiedLocationLabelInput) controls.verifiedLocationLabelInput.value = '';
    if (controls.latitudeInput) controls.latitudeInput.value = '';
    if (controls.longitudeInput) controls.longitudeInput.value = '';
    dispatchLocationVerificationUpdate();
    if (controls.coordinateReadout) controls.coordinateReadout.hidden = true;
    if (controls.previewMap) controls.previewMap.hidden = true;

    setLocationStatus(options.failed ? 'failed' : 'pending', options.failed ? 'Verification failed' : 'Not verified');
    setLocationMessage(message || 'Verify the address before saving this report.');
  }

  function showPreviewMap(latitude, longitude) {
    if (!controls.previewMap || !window.L) return;

    controls.previewMap.hidden = false;

    if (!locationMap) {
      const bounds = L.latLngBounds(
        [SINGAPORE_BOUNDS.minLat, SINGAPORE_BOUNDS.minLng],
        [SINGAPORE_BOUNDS.maxLat, SINGAPORE_BOUNDS.maxLng]
      );

      locationMap = L.map(controls.previewMap, {
        center: [latitude, longitude],
        zoom: 14,
        minZoom: 10,
        maxZoom: 18,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0,
        scrollWheelZoom: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(locationMap);

      locationMap.on('click', (event) => {
        updateManualLocation(event.latlng.lat, event.latlng.lng);
      });
    }

    if (!locationMarker) {
      locationMarker = L.marker([latitude, longitude], {
        draggable: true
      }).addTo(locationMap);

      locationMarker.on('dragend', () => {
        const latLng = locationMarker.getLatLng();
        updateManualLocation(latLng.lat, latLng.lng);
      });
    }

    locationMarker.setLatLng([latitude, longitude]);
    locationMap.setView([latitude, longitude], Math.max(locationMap.getZoom(), 14));
    window.setTimeout(() => locationMap.invalidateSize(), 80);
  }

  function updateManualLocation(latitude, longitude) {
    if (!isValidOperationalCoordinate(latitude, longitude)) {
      setLocationStatus('failed', 'Verification failed');
      setLocationMessage('Selected coordinates must remain within the Singapore operational map boundary.');
      return;
    }

    setVerifiedLocation({
      latitude,
      longitude,
      label: controls.verifiedLocationLabelInput.value || controls.locationInput.value,
      source: 'manual-map'
    }, 'Location confirmed');
  }

  function validateForm() {
    clearAllFieldErrors();

    const invalidFields = [];

    requiredFields.forEach((field) => {
      if (!validateField(field.name)) {
        invalidFields.push(field.name);
      }
    });

    conditionalFields.forEach((field) => {
      if (!validateConditionalField(field.name)) {
        invalidFields.push(field.name);
      }
    });

    if (!validateLocationVerification()) {
      invalidFields.push('incidentLocation');
    }

    if (invalidFields.length > 0) {
      showErrorSummary('Please correct the highlighted fields before saving this incident report.');
      focusField(invalidFields[0]);
      return false;
    }

    hideErrorSummary();
    return true;
  }

  function validateField(name) {
    const input = form.elements[name];
    if (!input) return true;

    const value = String(input.value || '').trim();

    if (!value) {
      const requiredField = requiredFields.find((field) => field.name === name);
      setFieldError(name, requiredField ? requiredField.message : 'This field is required.');
      return false;
    }

    if (name === 'incidentType' && value === '__other_special_incident__') {
      const customType = form.elements.customIncidentType;

      if (!customType || !customType.value.trim()) {
        setFieldError('incidentType', 'Custom incident type is required.');
        return false;
      }
    }

    if (name === 'incidentDateTime' && !isValidDateTime(value)) {
      setFieldError(name, 'Enter a valid incident date and time.');
      return false;
    }

    if (name === 'responseStatus' && !Array.from(input.options).some((option) => option.value === value)) {
      setFieldError(name, 'Select a valid response status.');
      return false;
    }

    clearFieldError(name);
    return true;
  }

  function validateConditionalField(name) {
    const input = form.elements[name];
    if (!input) return true;

    const value = String(input.value || '').trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\.+$/, '');

    if (!value) {
      setFieldError(name, conditionalFields.find((field) => field.name === name).message);
      return false;
    }

    if (['null', 'undefined', 'not identified in transcript', 'not available', 'n/a'].includes(value)) {
      setFieldError(name, conditionalFields.find((field) => field.name === name).message);
      return false;
    }

    clearFieldError(name);
    return true;
  }

  function validateLocationVerification() {
    const location = controls.locationInput ? controls.locationInput.value.trim() : '';
    const latitude = getNumber(controls.latitudeInput && controls.latitudeInput.value);
    const longitude = getNumber(controls.longitudeInput && controls.longitudeInput.value);

    if (!location) return false;

    if (!isLocationVerified()) {
      setFieldError('incidentLocation', 'Verify the incident location before saving.');
      setLocationStatus('failed', 'Verification required');
      setLocationMessage('Verify the incident location before saving.');
      return false;
    }

    if (!isValidCoordinateRange(latitude, longitude)) {
      setFieldError('incidentLocation', 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.');
      setLocationStatus('failed', 'Verification failed');
      setLocationMessage('Verified coordinates are invalid.');
      return false;
    }

    if (!isWithinSingaporeBounds(latitude, longitude)) {
      setFieldError('incidentLocation', 'The verified coordinates must be within the Singapore operational map boundary.');
      setLocationStatus('failed', 'Verification failed');
      setLocationMessage('Selected coordinates are outside the Singapore operational map boundary.');
      return false;
    }

    clearFieldError('incidentLocation');
    return true;
  }

  function setFieldError(name, message) {
    const input = form.elements[name];
    const error = document.getElementById(`${name}Error`);

    if (input) {
      input.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
    }

    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function clearFieldError(name) {
    const input = form.elements[name];
    const error = document.getElementById(`${name}Error`);

    if (input) {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    }

    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
  }

  function clearAllFieldErrors() {
    requiredFields.forEach((field) => clearFieldError(field.name));
    conditionalFields.forEach((field) => clearFieldError(field.name));
  }

  function showErrorSummary(message) {
    if (!controls.errorSummary) {
      controls.errorSummary = document.createElement('div');
      controls.errorSummary.dataset.formErrorSummary = '';
      controls.errorSummary.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i><span></span>';
      const firstContent = form.querySelector('.readonly-field');
      form.insertBefore(controls.errorSummary, firstContent || form.firstChild);
    }

    controls.errorSummary.className = 'notice-strip notice-warning';
    controls.errorSummary.querySelector('span').textContent = message;
  }

  function hideErrorSummary() {
    if (!controls.errorSummary) return;

    controls.errorSummary.remove();
    controls.errorSummary = null;
  }

  function dispatchLocationVerificationUpdate() {
    if (!controls.locationVerifiedInput) return;

    controls.locationVerifiedInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setLocationStatus(state, text) {
    if (!controls.status) return;

    const icon = {
      checking: 'bi-hourglass-split',
      failed: 'bi-exclamation-triangle-fill',
      pending: 'bi-dash-circle-fill',
      verified: 'bi-check-circle-fill'
    }[state] || 'bi-dash-circle-fill';

    controls.status.className = `location-status location-status-${state}`;
    controls.status.innerHTML = `<i class="bi ${icon}"></i>${escapeHtml(text)}`;
  }

  function setLocationMessage(message) {
    if (controls.message) {
      controls.message.textContent = message;
    }
  }

  function showCoordinateReadout(latitude, longitude) {
    if (!controls.coordinateReadout) return;

    controls.coordinateReadout.hidden = false;
    const readout = controls.coordinateReadout.querySelector('span');
    if (readout) {
      readout.textContent = `${latitude.toFixed(7)}, ${longitude.toFixed(7)}`;
    }
  }

  function focusField(name) {
    const input = form.elements[name];
    if (!input) return;

    input.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
    window.setTimeout(() => input.focus({ preventScroll: true }), 120);
  }

  function setSubmittingState(submitter) {
    if (submitter && submitter.name) {
      let preservedSubmitter = form.querySelector('input[data-preserved-submitter]');

      if (!preservedSubmitter) {
        preservedSubmitter = document.createElement('input');
        preservedSubmitter.type = 'hidden';
        preservedSubmitter.dataset.preservedSubmitter = 'true';
        form.appendChild(preservedSubmitter);
      }

      preservedSubmitter.name = submitter.name;
      preservedSubmitter.value = submitter.value;
    }

    Array.from(form.querySelectorAll('button[type="submit"]')).forEach((button) => {
      button.disabled = true;
    });

    if (!submitter) return;

    submitter.dataset.originalText = submitter.textContent.trim();
    submitter.innerHTML = submitter.value === 'draft'
      ? '<i class="bi bi-save-fill"></i>Saving Draft...'
      : '<i class="bi bi-check2-circle"></i>Saving Report...';
  }

  function isLocationVerified() {
    return controls.locationVerifiedInput && controls.locationVerifiedInput.value === 'true';
  }

  function getFieldValue(name) {
    const input = form.elements[name];
    return input ? input.value.trim() : '';
  }

  function getNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function isValidDateTime(value) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(String(value || '').trim())
      && !Number.isNaN(new Date(value).getTime());
  }

  function isValidCoordinateRange(latitude, longitude) {
    return Number.isFinite(latitude)
      && Number.isFinite(longitude)
      && latitude >= -90
      && latitude <= 90
      && longitude >= -180
      && longitude <= 180;
  }

  function isWithinSingaporeBounds(latitude, longitude) {
    return latitude >= SINGAPORE_BOUNDS.minLat
      && latitude <= SINGAPORE_BOUNDS.maxLat
      && longitude >= SINGAPORE_BOUNDS.minLng
      && longitude <= SINGAPORE_BOUNDS.maxLng;
  }

  function isValidOperationalCoordinate(latitude, longitude) {
    return isValidCoordinateRange(latitude, longitude)
      && isWithinSingaporeBounds(latitude, longitude);
  }

  function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
