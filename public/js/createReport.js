document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  const CREATE_REPORT_DRAFT_KEY = 'firefighter.createReportDraft';
  const DRAFT_SAVE_DELAY_MS = 700;
  const OTHER_INCIDENT_TYPE_VALUE = '__other_special_incident__';
  const transcriptInput = document.getElementById('transcriptInput');
  const generateButton = document.getElementById('generateDraftButton');
  const aiReportNotice = document.getElementById('aiReportNotice');
  const aiReviewNotice = document.getElementById('aiReviewNotice');
  const reportForm = document.getElementById('reportForm');
  const incidentTypeSelect = document.getElementById('incidentType');
  const customIncidentTypeField = document.getElementById('customIncidentTypeField');
  const customIncidentTypeInput = document.getElementById('customIncidentType');
  const draftRecoveryNotice = document.getElementById('draftRecoveryNotice');
  const draftRecoveryMessage = document.getElementById('draftRecoveryMessage');
  const restoreDraftButton = document.getElementById('restoreCreateReportDraftButton');
  const discardDraftButton = document.getElementById('discardCreateReportDraftButton');
  let draftSaveTimer = null;
  let isRestoringDraft = false;
  let isDiscardingDraft = false;
  let isSubmittingReport = false;
  let isGeneratingReport = false;
  let hasPendingDraftRecovery = false;
  const initialReportingOfficerId = getFieldValue('reportingOfficerId');

  clearDraftAfterSuccessfulSave();

  if (!transcriptInput || !generateButton || !reportForm) return;

  setupCustomIncidentType();
  setupDraftRecovery();
  setupDraftAutosave();
  generateButton.addEventListener('click', generateAiReport);

  // SHAWN 25044598 - Transcript handoff: Loads transcript text sent from Live Call Intake.
  function loadSentTranscript() {
    const params = new URLSearchParams(window.location.search);
    const directTranscript = params.get('transcriptText');
    const storedTranscript = getStorageItem(TRANSCRIPT_STORAGE_KEY);
    let loadedTranscript = false;

    if (directTranscript && !transcriptInput.value.trim()) {
      transcriptInput.value = directTranscript;
      dispatchFieldUpdate(transcriptInput);
      loadedTranscript = true;
    }

    if (params.get('transcript') === 'sent') {
      if (storedTranscript && !transcriptInput.value.trim()) {
        transcriptInput.value = storedTranscript;
        dispatchFieldUpdate(transcriptInput);
        loadedTranscript = true;
      }

      removeStorageItem(TRANSCRIPT_STORAGE_KEY);
    }

    if (loadedTranscript) {
      saveDraftSoon();
    }
  }

  // Done BY SHAWN ID 25044598
  // AI Features: calls the backend AI report endpoint to draft incident fields from transcript text.
  async function generateAiReport() {
    if (isGeneratingReport) return;

    const transcript = transcriptInput.value.trim();

    if (!transcript) {
      showNotice('warning', 'Paste or send a transcript before generating a report.');
      return;
    }

    isGeneratingReport = true;
    generateButton.disabled = true;
    setButtonBusy(generateButton, true, 'Generating Report...');
    showNotice('checking', 'Generating report draft.');

    try {
      const { data } = await fetchAiJson('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transcript })
      });

      if (data.report) {
        fillReportForm(data.report);
        saveDraftSoon();
      }

      if (data.success) {
        showNotice('ready', 'Report draft generated. Review and edit before saving.');
      } else {
        showNotice('warning', data.error || 'Report drafting service is unavailable. A manual draft was loaded for editing.');
      }
    } catch (error) {
      fillReportForm(buildClientFallbackReport(transcript));
      saveDraftSoon();
      showNotice('warning', error.message || 'Report drafting service is unavailable. A manual draft was loaded for editing.');
    } finally {
      isGeneratingReport = false;
      generateButton.disabled = false;
      setButtonBusy(generateButton, false, 'Generate Draft');
    }
  }

  // Done BY SHAWN ID 25044598
  // AI Features: places AI-generated draft fields into the officer review form for editing.
  function fillReportForm(report) {
    setFieldValue('incidentType', report.incident_type || '');
    setFieldValue('incidentLocation', report.location || '');
    setFieldValue('responseStatus', report.response_status || 'Pending Review');
    setFieldValue('incidentSummary', report.incident_summary || '');
    setFieldValue('hazards', report.hazards || '');
    setFieldValue('injuredPersons', report.injured_or_trapped_persons || '');
    setFieldValue('missingInfo', report.missing_information || '');
    setFieldValue('officerNotes', report.officer_notes || '');

    if (aiReviewNotice) {
      aiReviewNotice.className = 'notice-strip';
    }
  }

  // SHAWN 25044598 - Restore/Discard Draft: Detects an unfinished local draft before loading a sent transcript.
  function setupDraftRecovery() {
    const savedDraft = readSavedDraft();

    if (!savedDraft) {
      loadSentTranscript();
      return;
    }

    showDraftRecovery(savedDraft);
  }

  // SHAWN 25044598 - Auto Save Draft: Keeps an unsaved report draft in browser storage.
  function setupDraftAutosave() {
    reportForm.addEventListener('input', saveDraftSoon);
    reportForm.addEventListener('change', saveDraftSoon);
    transcriptInput.addEventListener('input', saveDraftSoon);
    transcriptInput.addEventListener('change', saveDraftSoon);
    reportForm.addEventListener('reset', () => {
      window.setTimeout(() => {
        removeSavedDraft();
        hideDraftRecovery();
      }, 0);
    });
    reportForm.addEventListener('submit', () => {
      isSubmittingReport = true;
      saveDraftNow();
    });
    window.addEventListener('beforeunload', (event) => {
      if (isSubmittingReport || !hasMeaningfulDraft(collectDraft())) return;

      event.preventDefault();
      event.returnValue = '';
    });
  }

  // SHAWN 25044598 - Restore/Discard Draft: Wires the recovery banner actions.
  function showDraftRecovery(savedDraft) {
    if (!draftRecoveryNotice || !draftRecoveryMessage || !restoreDraftButton || !discardDraftButton) return;

    draftRecoveryMessage.textContent = `An unfinished report draft from ${formatSavedAt(savedDraft.savedAt)} was found. Would you like to restore it?`;
    draftRecoveryNotice.className = 'draft-recovery notice-strip';
    hasPendingDraftRecovery = true;
    restoreDraftButton.onclick = () => {
      restoreDraft(savedDraft);
      removeStorageItem(TRANSCRIPT_STORAGE_KEY);
      hasPendingDraftRecovery = false;
      draftRecoveryMessage.textContent = 'Draft restored. Continue editing, or discard it to clear the form.';
      saveDraftSoon();
    };
    discardDraftButton.onclick = () => {
      removeSavedDraft();
      hasPendingDraftRecovery = false;
      hideDraftRecovery();
      discardCurrentDraftValues();
      loadSentTranscript();
    };
  }

  function hideDraftRecovery() {
    if (!draftRecoveryNotice) return;

    draftRecoveryNotice.className = 'draft-recovery notice-strip notice-hidden';
  }

  // SHAWN 25044598 - Restore Draft: Maps stored browser draft values back into the form.
  function restoreDraft(draft) {
    isRestoringDraft = true;

    transcriptInput.value = draft.transcript || '';
    dispatchFieldUpdate(transcriptInput);
    setFieldValue('reportingOfficerId', draft.reportingOfficerId || '');
    setFieldValue('incidentType', draft.incidentType || '');
    setFieldValue('customIncidentType', draft.customIncidentType || '');
    setFieldValue('incidentLocation', draft.incidentLocation || '');
    setFieldValue('incidentDateTime', draft.incidentDateTime || '');
    setFieldValue('incidentSummary', draft.incidentSummary || '');
    setFieldValue('hazards', draft.hazards || '');
    setFieldValue('injuredPersons', draft.injuredPersons || '');
    setFieldValue('responseStatus', draft.responseStatus || 'Pending Review');
    setFieldValue('missingInfo', draft.missingInfo || '');
    setFieldValue('officerNotes', draft.officerNotes || '');
    syncCustomIncidentType();

    updateCompletionWidget();

    isRestoringDraft = false;
  }

  // SHAWN 25044598 - Discard Draft: Clears only the temporary browser draft and visible form values.
  function discardCurrentDraftValues() {
    isDiscardingDraft = true;
    window.clearTimeout(draftSaveTimer);

    transcriptInput.value = '';
    dispatchFieldUpdate(transcriptInput);
    setFieldValue('reportingOfficerId', initialReportingOfficerId);
    setFieldValue('incidentType', '');
    setFieldValue('customIncidentType', '');
    setFieldValue('incidentLocation', '');
    setFieldValue('incidentDateTime', '');
    setFieldValue('incidentSummary', '');
    setFieldValue('hazards', '');
    setFieldValue('injuredPersons', '');
    setFieldValue('responseStatus', '');
    setFieldValue('missingInfo', '');
    setFieldValue('officerNotes', '');
    syncCustomIncidentType();
    removeSavedDraft();

    updateCompletionWidget();

    isDiscardingDraft = false;
  }

  // SHAWN 25044598 - Restore Draft: Reads and validates the saved localStorage payload.
  function readSavedDraft() {
    const savedDraft = getStorageItem(CREATE_REPORT_DRAFT_KEY);

    if (!savedDraft) return null;

    try {
      const draft = JSON.parse(savedDraft);

      if (!draft || typeof draft !== 'object' || !hasMeaningfulDraft(draft)) {
        removeSavedDraft();
        return null;
      }

      return draft;
    } catch (error) {
      removeSavedDraft();
      return null;
    }
  }

  // SHAWN 25044598 - Auto Save Draft: Debounces browser draft writes.
  function saveDraftSoon() {
    if (isRestoringDraft || isDiscardingDraft || hasPendingDraftRecovery) return;

    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
  }

  // SHAWN 25044598 - Auto Save Draft: Stores meaningful draft data temporarily in localStorage.
  function saveDraftNow() {
    const draft = collectDraft();

    if (!hasMeaningfulDraft(draft)) {
      removeSavedDraft();
      return;
    }

    setStorageItem(CREATE_REPORT_DRAFT_KEY, JSON.stringify({
      ...draft,
      savedAt: new Date().toISOString()
    }));
  }

  // SHAWN 25044598 - Auto Save Draft: Collects the fields needed to rebuild the Create Report form.
  function collectDraft() {
    return {
      transcript: transcriptInput.value.trim(),
      reportingOfficerId: getFieldValue('reportingOfficerId'),
      incidentType: getFieldValue('incidentType'),
      customIncidentType: getFieldValue('customIncidentType'),
      incidentLocation: getFieldValue('incidentLocation'),
      incidentDateTime: getFieldValue('incidentDateTime'),
      incidentSummary: getFieldValue('incidentSummary'),
      hazards: getFieldValue('hazards'),
      injuredPersons: getFieldValue('injuredPersons'),
      responseStatus: getFieldValue('responseStatus'),
      missingInfo: getFieldValue('missingInfo'),
      officerNotes: getFieldValue('officerNotes')
    };
  }

  // SHAWN 25044598 - Auto Save Draft: Avoids saving empty default forms.
  function hasMeaningfulDraft(draft) {
    const incidentType = draft.incidentType === OTHER_INCIDENT_TYPE_VALUE
      ? draft.customIncidentType
      : draft.incidentType;
    const meaningfulValues = [
      draft.transcript,
      incidentType,
      draft.incidentLocation,
      draft.incidentDateTime,
      draft.incidentSummary,
      draft.hazards,
      draft.injuredPersons,
      draft.missingInfo,
      draft.officerNotes
    ];

    return meaningfulValues.some((value) => String(value || '').trim().length > 0);
  }

  // SHAWN 25044598 - Discard Draft: Removes the temporary browser draft.
  function removeSavedDraft() {
    removeStorageItem(CREATE_REPORT_DRAFT_KEY);
  }

  // SHAWN 25044598 - Successful Save Cleanup: Clears local drafts after a report save redirect.
  function clearDraftAfterSuccessfulSave() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('reportSaved') !== '1') return;

    removeStorageItem(CREATE_REPORT_DRAFT_KEY);
    removeStorageItem(TRANSCRIPT_STORAGE_KEY);
    params.delete('reportSaved');

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function formatSavedAt(savedAt) {
    const date = new Date(savedAt);

    if (Number.isNaN(date.getTime())) return 'an earlier session';

    return date.toLocaleString();
  }

  function getFieldValue(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  function getStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function setStorageItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // If browser storage is unavailable, the form still works normally.
    }
  }

  function removeStorageItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      // If browser storage is unavailable, there is nothing else to clear.
    }
  }

  function setFieldValue(id, value) {
    if (id === 'incidentType' && setIncidentTypeValue(value)) return;

    const field = document.getElementById(id);
    if (!field) return;
    if (field.dataset.serverControlled === 'true') return;

    if (field.tagName === 'SELECT' && value && !Array.from(field.options).some((option) => option.value === value)) {
      const option = new Option(value, value);
      field.add(option);
    }

    field.value = value;
    dispatchFieldUpdate(field);

    updateCompletionWidget();
  }

  // SHAWN 25044598 - Custom Incident Type: Reveals the custom field only when "Other" is selected.
  function setupCustomIncidentType() {
    if (!reportForm || !incidentTypeSelect || !customIncidentTypeField || !customIncidentTypeInput) return;

    incidentTypeSelect.addEventListener('change', () => {
      syncCustomIncidentType();
      updateCompletionWidget();
    });
    customIncidentTypeInput.addEventListener('input', () => {
      updateCompletionWidget();
    });
    reportForm.addEventListener('reset', () => {
      window.setTimeout(() => {
        syncCustomIncidentType();
        updateCompletionWidget();
      }, 0);
    });
    reportForm.addEventListener('formdata', (event) => {
      if (incidentTypeSelect.value === OTHER_INCIDENT_TYPE_VALUE) {
        event.formData.set('incidentType', customIncidentTypeInput.value.trim());
      }
    });

    syncCustomIncidentType();
  }

  function syncCustomIncidentType() {
    const useCustomIncidentType = incidentTypeSelect.value === OTHER_INCIDENT_TYPE_VALUE;

    customIncidentTypeField.hidden = !useCustomIncidentType;
    customIncidentTypeInput.required = useCustomIncidentType;

    if (!useCustomIncidentType) {
      customIncidentTypeInput.value = '';
    }
  }

  function setIncidentTypeValue(value) {
    if (!incidentTypeSelect) return false;

    const nextValue = String(value || '').trim();
    const matchingOption = Array.from(incidentTypeSelect.options).find((option) => {
      return option.value === nextValue || option.textContent.trim() === nextValue;
    });

    if (!nextValue || matchingOption) {
      incidentTypeSelect.value = matchingOption ? matchingOption.value : nextValue;
      if (customIncidentTypeInput) {
        customIncidentTypeInput.value = '';
      }
    } else {
      incidentTypeSelect.value = OTHER_INCIDENT_TYPE_VALUE;
      if (customIncidentTypeInput) {
        customIncidentTypeInput.value = nextValue;
      }
    }

    if (customIncidentTypeField && customIncidentTypeInput) {
      syncCustomIncidentType();
      dispatchFieldUpdate(customIncidentTypeInput);
    }
    dispatchFieldUpdate(incidentTypeSelect);

    updateCompletionWidget();

    return true;
  }

  function updateCompletionWidget() {
    if (window.updateReportCompletion) {
      window.updateReportCompletion();
    }
  }

  function dispatchFieldUpdate(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function buildClientFallbackReport(transcript) {
    return {
      incident_type: '',
      location: '',
      incident_datetime: '',
      incident_summary: `Transcript received for officer review: ${transcript.slice(0, 450)}`,
      hazards: 'Not identified in transcript.',
      injured_or_trapped_persons: 'Not identified in transcript.',
      response_status: 'Pending Review',
      missing_information: 'Report drafting service was unavailable. Officer should complete missing incident details from the transcript.',
      officer_notes: 'Manual review required before saving.'
    };
  }

  function showNotice(state, message) {
    if (!aiReportNotice) return;

    aiReportNotice.className = state === 'warning'
      ? 'notice-strip notice-warning'
      : 'notice-strip';
    aiReportNotice.querySelector('span').textContent = message;
  }

  async function fetchAiJson(url, options) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 110000);

    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const body = await response.text();
      let data;

      try {
        data = body ? JSON.parse(body) : null;
      } catch (error) {
        throw new Error('The AI service returned an invalid response. Please try again.');
      }

      if (!data || typeof data !== 'object') {
        throw new Error('The AI service returned an empty response. Please try again.');
      }

      return { response, data };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The AI request timed out. Please try again in a moment.');
      }

      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function setButtonBusy(button, isBusy, busyLabel) {
    if (!button) return;

    const labelNode = Array.from(button.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

    if (!labelNode) return;
    if (!button.dataset.idleLabel) button.dataset.idleLabel = labelNode.textContent.trim();
    labelNode.textContent = `\n      ${isBusy ? busyLabel : button.dataset.idleLabel}\n    `;
    button.setAttribute('aria-busy', String(isBusy));
  }
});
