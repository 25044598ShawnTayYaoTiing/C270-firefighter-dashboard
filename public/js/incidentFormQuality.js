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
    component: document.querySelector('[data-location-verification]'),
    locationInput: form.elements.incidentLocation,
    latitudeInput: form.elements.latitude,
    longitudeInput: form.elements.longitude,
    locationVerifiedInput: form.elements.locationVerified,
    locationSourceInput: form.elements.locationVerificationSource,
    verifiedLocationLabelInput: form.elements.verifiedLocationLabel,
    unverifiedAcknowledgement: form.elements.unverifiedLocationAcknowledged,
    unverifiedWarning: document.getElementById('unverifiedLocationWarning'),
    unverifiedWarningMessage: document.getElementById('unverifiedLocationWarningMessage'),
    verifyButton: document.getElementById('verifyLocationButton'),
    status: document.getElementById('locationVerificationStatus'),
    message: document.getElementById('locationVerificationMessage'),
    candidates: document.getElementById('locationCandidates'),
    candidateList: document.getElementById('locationCandidateList'),
    verifiedCard: document.getElementById('verifiedLocationCard'),
    verifiedName: document.getElementById('verifiedLocationName'),
    verifiedAddress: document.getElementById('verifiedLocationAddress'),
    previewMap: document.getElementById('locationPreviewMap'),
    coordinateReadout: document.getElementById('locationCoordinateReadout'),
    errorSummary: form.querySelector('[data-form-error-summary]'),
  };
  const locationVerification = window.LocationVerification;
  const verificationState = locationVerification
    ? locationVerification.createVerificationState()
    : null;
  let verifiedAddress = normalizeText(controls.locationInput ? controls.locationInput.value : '');
  let locationMap = null;
  let locationMarker = null;
  let locationMapResizeObserver = null;
  let activeLocationRequest = null;
  const submissionGuard = locationVerification
    ? locationVerification.createSubmissionGuard()
    : null;

  setupLocationVerification();
  setupValidation();
  initializeVerifiedLocation();

  function setupLocationVerification() {
    if (!controls.locationInput || !controls.verifyButton || !verificationState) return;

    controls.verifyButton.addEventListener('click', verifyLocation);
    if (controls.unverifiedAcknowledgement) {
      controls.unverifiedAcknowledgement.addEventListener('change', () => {
        if (controls.unverifiedAcknowledgement.checked) {
          clearFieldError('unverifiedLocationAcknowledged');
        }
      });
    }
    controls.locationInput.addEventListener('input', () => {
      const currentState = verificationState.getSnapshot().status;
      const locationChanged = normalizeText(controls.locationInput.value) !== verifiedAddress;

      if (locationChanged && (
        isLocationVerified()
        || currentState !== locationVerification.STATES.UNVERIFIED
      )) {
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
      if (submissionGuard && submissionGuard.isLocked()) {
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

      if (submissionGuard && !submissionGuard.tryLock()) {
        event.preventDefault();
        return;
      }
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

      const initialLocation = {
        address: label,
        latitude,
        longitude,
        name: label,
        source: controls.locationSourceInput ? controls.locationSourceInput.value : 'existing-coordinates'
      };
      const requestVersion = verificationState.beginSearch(controls.locationInput.value);
      verificationState.verify(requestVersion, controls.locationInput.value, initialLocation);
      setVerifiedLocation(initialLocation, 'Verified location');
      return;
    }

    resetLocationVerification('Verify the address before saving this report.');
  }

  async function verifyLocation() {
    const location = locationVerification.normalizeLocationQuery(controls.locationInput.value);
    const validation = locationVerification.validateLocationQuery(location);

    if (!validation.valid) {
      setFieldError('incidentLocation', validation.message);
      resetLocationVerification(validation.message, { failed: true });
      controls.locationInput.focus();
      return;
    }

    abortLocationRequest();
    const requestVersion = verificationState.beginSearch(location);
    const controller = new AbortController();
    activeLocationRequest = {
      controller,
      requestVersion
    };
    clearVerifiedLocationFields();
    clearLocationCandidates();
    renderLocationState('Searching OneMap for matching Singapore locations.');

    try {
      const response = await fetch(window.apiUrl('/api/locations/verify'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          location
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        const error = new Error(data.error || 'Unable to verify this location.');
        error.code = data.code || '';
        throw error;
      }

      if (!verificationState.isCurrentRequest(requestVersion, location)) return;

      if (data.verified === false) {
        if (!Array.isArray(data.candidates)) {
          throw new Error('Location verification returned an invalid response. Please try again.');
        }

        const candidates = data.candidates.filter((candidate) => (
          candidate
          && isValidOperationalCoordinate(
            getNumber(candidate.latitude),
            getNumber(candidate.longitude)
          )
        ));

        if (candidates.length === 0) {
          throw new Error('No valid Singapore location candidates were returned.');
        }

        verificationState.showCandidates(requestVersion, location, candidates);
        renderLocationCandidates(candidates);
        renderLocationState('Select the matching location. No candidate is verified until you choose it.');
        clearFieldError('incidentLocation');
        return;
      }

      if (data.verified !== true || !isValidOperationalCoordinate(
        getNumber(data.latitude),
        getNumber(data.longitude)
      )) {
        throw new Error('Location verification returned an invalid response. Please try again.');
      }

      const verifiedLocation = {
        address: data.resolvedLocation || location,
        latitude: data.latitude,
        longitude: data.longitude,
        name: data.resolvedLocation || location,
        source: data.source || 'resolver'
      };

      if (!verificationState.verify(requestVersion, location, verifiedLocation)) return;
      setVerifiedLocation(verifiedLocation, 'Verified location');
      clearFieldError('incidentLocation');
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (!verificationState.isCurrentRequest(requestVersion, location)) return;

      const safeMessage = error instanceof TypeError
        ? 'Location verification is temporarily unavailable. Check your connection and try again.'
        : error.message || 'Unable to verify this location. Please check the address and try again.';
      verificationState.fail(requestVersion, location, safeMessage);
      clearVerifiedLocationFields();
      clearLocationCandidates();
      renderLocationState(safeMessage);
      setFieldError('incidentLocation', safeMessage);
    } finally {
      if (activeLocationRequest && activeLocationRequest.requestVersion === requestVersion) {
        activeLocationRequest = null;
        renderLocationState();
      }
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
    controls.verifiedLocationLabelInput.value = result.address
      || result.name
      || controls.locationInput.value;
    hideUnverifiedLocationWarning();
    clearFieldError('unverifiedLocationAcknowledged');
    dispatchLocationVerificationUpdate();

    clearLocationCandidates();
    showVerifiedLocationCard({
      ...result,
      latitude,
      longitude
    });
    renderLocationState(message || 'This location is verified and ready to save.');
    showCoordinateReadout(latitude, longitude);
    showPreviewMap(latitude, longitude);
  }

  function resetLocationVerification(message, options = {}) {
    abortLocationRequest();
    clearVerifiedLocationFields();
    clearLocationCandidates();

    if (options.failed) {
      const requestVersion = verificationState.beginSearch(controls.locationInput.value);
      verificationState.fail(requestVersion, controls.locationInput.value, message);
    } else {
      verificationState.invalidate(controls.locationInput.value);
    }

    renderLocationState(message || 'Verify the address before saving this report.');
    showUnverifiedLocationWarning(message);
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

      if (window.ResizeObserver) {
        locationMapResizeObserver = new ResizeObserver(() => {
          if (!controls.previewMap.hidden) locationMap.invalidateSize();
        });
        locationMapResizeObserver.observe(controls.previewMap);
      }
    }

    if (!locationMarker) {
      locationMarker = L.marker([latitude, longitude]).addTo(locationMap);
    }

    locationMarker.setLatLng([latitude, longitude]);
    locationMap.setView([latitude, longitude], Math.max(locationMap.getZoom(), 14));
    window.setTimeout(() => locationMap.invalidateSize(), 80);
  }

  function renderLocationCandidates(candidates) {
    if (!controls.candidates || !controls.candidateList) return;

    controls.candidateList.replaceChildren();

    candidates.forEach((candidate, index) => {
      const item = document.createElement('div');
      const button = document.createElement('button');
      const name = document.createElement('strong');
      const address = document.createElement('span');
      const coordinates = document.createElement('small');

      button.type = 'button';
      button.className = 'location-candidate';
      button.setAttribute('aria-label', `Select ${candidate.name || candidate.address}`);
      item.setAttribute('role', 'listitem');
      name.textContent = candidate.name || candidate.address;
      address.textContent = candidate.address || candidate.name;
      coordinates.textContent = candidate.postalCode
        ? `Singapore ${candidate.postalCode}`
        : `Candidate ${index + 1}`;
      button.append(name, address, coordinates);
      button.addEventListener('click', () => {
        if (!verificationState.selectCandidate(candidate)) return;

        setVerifiedLocation(candidate, 'Officer-selected location verified.');
        clearFieldError('incidentLocation');
        if (controls.verifiedCard) controls.verifiedCard.focus({ preventScroll: true });
      });
      item.appendChild(button);
      controls.candidateList.appendChild(item);
    });

    controls.candidates.hidden = false;
  }

  function clearLocationCandidates() {
    if (controls.candidateList) controls.candidateList.replaceChildren();
    if (controls.candidates) controls.candidates.hidden = true;
  }

  function showVerifiedLocationCard(result) {
    if (!controls.verifiedCard) return;

    controls.verifiedCard.hidden = false;
    if (controls.verifiedName) {
      controls.verifiedName.textContent = result.name || result.address || controls.locationInput.value;
    }
    if (controls.verifiedAddress) {
      controls.verifiedAddress.textContent = result.address || result.name || controls.locationInput.value;
    }
  }

  function clearVerifiedLocationFields() {
    if (controls.locationVerifiedInput) controls.locationVerifiedInput.value = '';
    if (controls.locationSourceInput) controls.locationSourceInput.value = '';
    if (controls.verifiedLocationLabelInput) controls.verifiedLocationLabelInput.value = '';
    if (controls.latitudeInput) controls.latitudeInput.value = '';
    if (controls.longitudeInput) controls.longitudeInput.value = '';
    if (controls.verifiedCard) controls.verifiedCard.hidden = true;
    if (controls.coordinateReadout) controls.coordinateReadout.hidden = true;
    if (controls.previewMap) controls.previewMap.hidden = true;

    if (locationMarker && locationMap) {
      locationMap.removeLayer(locationMarker);
      locationMarker = null;
    }

    dispatchLocationVerificationUpdate();
  }

  function abortLocationRequest() {
    if (!activeLocationRequest) return;

    activeLocationRequest.controller.abort();
    activeLocationRequest = null;
  }

  function renderLocationState(message) {
    const snapshot = verificationState.getSnapshot();
    const statePresentation = {
      [locationVerification.STATES.UNVERIFIED]: {
        className: 'pending',
        icon: 'bi-dash-circle-fill',
        label: 'UNVERIFIED',
        message: 'Verify the address before saving this report.'
      },
      [locationVerification.STATES.SEARCHING]: {
        className: 'checking',
        icon: 'bi-hourglass-split',
        label: 'SEARCHING',
        message: 'Searching OneMap for matching Singapore locations.'
      },
      [locationVerification.STATES.CANDIDATES]: {
        className: 'candidates',
        icon: 'bi-list-check',
        label: 'CANDIDATES',
        message: 'Select the correct matching location.'
      },
      [locationVerification.STATES.VERIFIED]: {
        className: 'verified',
        icon: 'bi-check-circle-fill',
        label: 'VERIFIED',
        message: 'This location is verified and ready to save.'
      },
      [locationVerification.STATES.ERROR]: {
        className: 'failed',
        icon: 'bi-exclamation-triangle-fill',
        label: 'ERROR',
        message: snapshot.message || 'Location verification failed.'
      }
    };
    const presentation = statePresentation[snapshot.status];

    if (controls.component) controls.component.dataset.state = snapshot.status;
    if (controls.status) {
      controls.status.className = `location-status location-status-${presentation.className}`;
      controls.status.innerHTML = `<i class="bi ${presentation.icon}"></i>${presentation.label}`;
    }
    if (controls.message) controls.message.textContent = message || presentation.message;
    if (snapshot.status !== locationVerification.STATES.VERIFIED
      && snapshot.status !== locationVerification.STATES.SEARCHING) {
      showUnverifiedLocationWarning(snapshot.status === locationVerification.STATES.ERROR
        ? snapshot.message
        : 'Location verification is required before this report can enter firefighter operational views.');
    }
    if (controls.verifyButton) {
      controls.verifyButton.disabled = [
        locationVerification.STATES.SEARCHING,
        locationVerification.STATES.VERIFIED
      ].includes(snapshot.status);

      if (snapshot.status === locationVerification.STATES.SEARCHING) {
        controls.verifyButton.innerHTML = '<span class="location-spinner" aria-hidden="true"></span>Verifying...';
      } else if (snapshot.status === locationVerification.STATES.VERIFIED) {
        controls.verifyButton.innerHTML = '<i class="bi bi-check2"></i>Verified';
      } else if (snapshot.status === locationVerification.STATES.CANDIDATES) {
        controls.verifyButton.innerHTML = '<i class="bi bi-arrow-repeat"></i>Search Again';
      } else {
        controls.verifyButton.innerHTML = '<i class="bi bi-crosshair"></i>Verify Location';
      }
    }
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

    const decision = locationVerification.getSubmissionLocationDecision({
      verified: isLocationVerified(),
      acknowledged: Boolean(
        controls.unverifiedAcknowledgement && controls.unverifiedAcknowledgement.checked
      )
    });

    if (decision.status === locationVerification.STATES.UNVERIFIED) {
      const warning = 'Location is unverified. This report will be held for higher-rank review and excluded from firefighter operational views.';
      setFieldError('incidentLocation', warning);
      showUnverifiedLocationWarning(warning);

      if (!decision.allowed) {
        setFieldError(
          'unverifiedLocationAcknowledged',
          'Confirm that this report may be saved with an unverified location.'
        );
        return false;
      }

      clearFieldError('unverifiedLocationAcknowledged');
      return true;
    }

    if (!isValidCoordinateRange(latitude, longitude)) {
      setFieldError('incidentLocation', 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.');
      resetLocationVerification('Verified coordinates are invalid.', {
        failed: true
      });
      return false;
    }

    if (!isWithinSingaporeBounds(latitude, longitude)) {
      setFieldError('incidentLocation', 'The verified coordinates must be within the Singapore operational map boundary.');
      resetLocationVerification('Selected coordinates are outside the Singapore operational map boundary.', {
        failed: true
      });
      return false;
    }

    clearFieldError('incidentLocation');
    clearFieldError('unverifiedLocationAcknowledged');
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
    clearFieldError('unverifiedLocationAcknowledged');
  }

  function showUnverifiedLocationWarning(message) {
    if (!controls.unverifiedWarning) return;

    controls.unverifiedWarning.classList.remove('notice-hidden');
    if (controls.unverifiedWarningMessage) {
      const context = String(message || '').trim();
      controls.unverifiedWarningMessage.textContent = `${context ? `${context} ` : ''}`
        + 'You may still submit this report after acknowledging the warning, but it will be marked as unverified and excluded from firefighter operational views until a higher-rank officer verifies it.';
    }
  }

  function hideUnverifiedLocationWarning() {
    if (controls.unverifiedWarning) {
      controls.unverifiedWarning.classList.add('notice-hidden');
    }
    if (controls.unverifiedAcknowledgement) {
      controls.unverifiedAcknowledgement.checked = false;
    }
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

});
