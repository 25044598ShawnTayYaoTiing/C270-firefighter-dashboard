document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  // SHAWN 25044598 - Auto Save Draft: Identifies the temporary report draft in localStorage.
  const CREATE_REPORT_DRAFT_KEY = 'firefighter.createReportDraft';
  // SHAWN 25044598 - Auto Save Draft: Waits briefly so rapid typing does not save every keystroke.
  const DRAFT_SAVE_DELAY_MS = 700;
  const OTHER_INCIDENT_TYPE_VALUE = '__other_special_incident__';
  const transcriptInput = document.getElementById('transcriptInput');
  const generateButton = document.getElementById('generateDraftButton');
  const aiReportNotice = document.getElementById('aiReportNotice');
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
  let hasPendingDraftRecovery = false;
  const initialReportingOfficerId = getFieldValue('reportingOfficerId');

  clearDraftAfterSuccessfulSave();

  if (!transcriptInput || !generateButton || !reportForm) return;

  setupCustomIncidentType();
  setupDraftRecovery();
  setupDraftAutosave();
  generateButton.addEventListener('click', generateAiReport);

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

  // StudentID 25044598 ShawnTay
  // AI Features: calls the backend AI report endpoint to draft incident fields from transcript text.
  async function generateAiReport() {
    const transcript = transcriptInput.value.trim();

    if (!transcript) {
      showNotice('warning', 'Paste or send a transcript before generating a report.');
      return;
    }

    generateButton.disabled = true;
    showNotice('checking', 'Generating report draft.');

    try {
      const response = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ transcript })
      });
      const data = await response.json();

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
      showNotice('warning', 'Report drafting service is unavailable. A manual draft was loaded for editing.');
    } finally {
      generateButton.disabled = false;
    }
  }

  // StudentID 25044598 ShawnTay
  // AI Features: places AI-generated draft fields into the officer review form for editing.
  function fillReportForm(report) {
    setFieldValue('incidentType', report.incident_type || '');
    setFieldValue('incidentLocation', report.location || '');
    setFieldValue('incidentDateTime', report.incident_datetime || '');
    setFieldValue('responseStatus', report.response_status || 'Pending Review');
    setFieldValue('incidentSummary', report.incident_summary || '');
    setFieldValue('hazards', report.hazards || '');
    setFieldValue('injuredPersons', report.injured_or_trapped_persons || '');
    setFieldValue('missingInfo', report.missing_information || '');
    setFieldValue('officerNotes', report.officer_notes || '');
  }

  /**
   * SHAWN 25044598 - Restore Draft
   * Checks localStorage for an unfinished draft when the Create Report page opens.
   * If one exists, the recovery controls are shown before new input can overwrite it.
   */
  function setupDraftRecovery() {
    const savedDraft = readSavedDraft();

    if (!savedDraft) {
      loadSentTranscript();
      return;
    }

    showDraftRecovery(savedDraft);
  }

  /**
   * SHAWN 25044598 - Auto Save Draft
   * Input and change events trigger autosave, but saving is delayed so
   * localStorage is not updated on every single keystroke.
   */
  function setupDraftAutosave() {
    reportForm.addEventListener('input', saveDraftSoon);
    reportForm.addEventListener('change', saveDraftSoon);
    transcriptInput.addEventListener('input', saveDraftSoon);
    transcriptInput.addEventListener('change', saveDraftSoon);
    reportForm.addEventListener('reset', () => {
      // SHAWN 25044598 - Discard Draft: Reset clears the saved recovery copy after the form resets.
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

  /**
   * SHAWN 25044598 - Restore/Discard Draft
   * Shows the Restore and Discard controls and connects each button
   * to the correct draft-recovery handler.
   */
  function showDraftRecovery(savedDraft) {
    if (!draftRecoveryNotice || !draftRecoveryMessage || !restoreDraftButton || !discardDraftButton) return;

    draftRecoveryMessage.textContent = `An unfinished report draft from ${formatSavedAt(savedDraft.savedAt)} was found. Would you like to restore it?`;
    draftRecoveryNotice.className = 'draft-recovery notice-strip';
    hasPendingDraftRecovery = true;
    restoreDraftButton.onclick = () => {
      restoreDraft(savedDraft);
      // SHAWN 25044598 - Restore Draft: The restored report takes priority over a waiting transcript.
      removeStorageItem(TRANSCRIPT_STORAGE_KEY);
      hasPendingDraftRecovery = false;
      draftRecoveryMessage.textContent = 'Draft restored. Continue editing, or discard it to clear the form.';
      saveDraftSoon();
    };
    discardDraftButton.onclick = () => {
      // SHAWN 25044598 - Discard Draft: Deletes only the temporary browser draft, not MySQL reports.
      removeSavedDraft();
      hasPendingDraftRecovery = false;
      hideDraftRecovery();
      discardCurrentDraftValues();
      loadSentTranscript();
    };
  }

  // SHAWN 25044598 - Discard Draft: Hides the recovery controls after the saved draft is removed.
  function hideDraftRecovery() {
    if (!draftRecoveryNotice) return;

    draftRecoveryNotice.className = 'draft-recovery notice-strip notice-hidden';
  }

  /**
   * SHAWN 25044598 - Restore Draft
   * Maps saved draft values back into the form, uses safe defaults
   * for missing properties, and refreshes the completion percentage.
   */
  function restoreDraft(draft) {
    isRestoringDraft = true;

    // SHAWN 25044598 - Restore Draft: Missing properties fall back safely for older drafts.
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
    // SHAWN 25044598 - Restore Draft: Use Pending Review when an older draft has no saved status.
    setFieldValue('responseStatus', draft.responseStatus || 'Pending Review');
    setFieldValue('missingInfo', draft.missingInfo || '');
    setFieldValue('officerNotes', draft.officerNotes || '');
    syncCustomIncidentType();

    if (window.updateReportCompletion) {
      window.updateReportCompletion();
    }

    isRestoringDraft = false;
  }

  /**
   * SHAWN 25044598 - Discard Draft
   * Clears the visible form and removes only the temporary localStorage draft.
   * This does not delete any report stored in MySQL.
   */
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

    if (window.updateReportCompletion) {
      window.updateReportCompletion();
    }

    isDiscardingDraft = false;
  }

  /**
   * SHAWN 25044598 - Restore Draft
   * Reads the saved JSON string from localStorage, parses it back into an object,
   * and safely removes invalid or empty saved data.
   */
  function readSavedDraft() {
    const savedDraft = getStorageItem(CREATE_REPORT_DRAFT_KEY);

    if (!savedDraft) return null;

    try {
      // SHAWN 25044598 - Restore Draft: JSON.parse converts the stored string back into a draft object.
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

  /**
   * SHAWN 25044598 - Auto Save Draft
   * Clears the previous autosave timer, then waits briefly before calling
   * saveDraftNow() with the latest form values.
   */
  function saveDraftSoon() {
    if (isRestoringDraft || isDiscardingDraft || hasPendingDraftRecovery) return;

    window.clearTimeout(draftSaveTimer);
    draftSaveTimer = window.setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
  }

  /**
   * SHAWN 25044598 - Auto Save Draft
   * Collects the current form values, converts the draft object with
   * JSON.stringify(), and stores it temporarily in browser localStorage.
   */
  function saveDraftNow() {
    // SHAWN 25044598 - Auto Save Draft: Collect the latest form values before saving.
    const draft = collectDraft();

    if (!hasMeaningfulDraft(draft)) {
      // SHAWN 25044598 - Auto Save Draft: Empty forms remove the saved temporary draft instead of storing blanks.
      removeSavedDraft();
      return;
    }

    // SHAWN 25044598 - Auto Save Draft: localStorage requires JSON.stringify() because it stores strings.
    setStorageItem(CREATE_REPORT_DRAFT_KEY, JSON.stringify({
      ...draft,
      savedAt: new Date().toISOString()
    }));
  }

  /**
   * SHAWN 25044598 - Auto Save Draft
   * Gathers the current transcript and report field values needed
   * to rebuild the Create Report form later.
   */
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

  /**
   * SHAWN 25044598 - Auto Save Draft
   * Checks whether officer-entered incident information is meaningful enough to save.
   * Default officer and status values alone do not create a temporary draft.
   */
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

  // SHAWN 25044598 - Discard Draft: Removes the draft storage key from localStorage.
  function removeSavedDraft() {
    removeStorageItem(CREATE_REPORT_DRAFT_KEY);
  }

  function clearDraftAfterSuccessfulSave() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('reportSaved') !== '1') return;

    removeStorageItem(CREATE_REPORT_DRAFT_KEY);
    removeStorageItem(TRANSCRIPT_STORAGE_KEY);
    params.delete('reportSaved');

    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
    window.history.replaceState({}, document.title, nextUrl);
  }

  // SHAWN 25044598 - Restore Draft: Formats the saved timestamp shown in the recovery notice.
  function formatSavedAt(savedAt) {
    const date = new Date(savedAt);

    if (Number.isNaN(date.getTime())) return 'an earlier session';

    return date.toLocaleString();
  }

  function getFieldValue(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  // SHAWN 25044598 - Restore Draft: Reads browser storage without breaking the form if access fails.
  function getStorageItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  // SHAWN 25044598 - Auto Save Draft: Writes the serialized draft when browser storage is available.
  function setStorageItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      // If browser storage is unavailable, the form still works normally.
    }
  }

  // SHAWN 25044598 - Discard Draft: Removes a temporary storage key when browser storage is available.
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

    if (field.tagName === 'SELECT' && value && !Array.from(field.options).some((option) => option.value === value)) {
      const option = new Option(value, value);
      field.add(option);
    }

    field.value = value;
    dispatchFieldUpdate(field);

    if (window.updateReportCompletion) {
      window.updateReportCompletion();
    }
  }

  function setupCustomIncidentType() {
    if (!reportForm || !incidentTypeSelect || !customIncidentTypeField || !customIncidentTypeInput) return;

    incidentTypeSelect.addEventListener('change', () => {
      syncCustomIncidentType();
      if (window.updateReportCompletion) {
        window.updateReportCompletion();
      }
    });
    customIncidentTypeInput.addEventListener('input', () => {
      if (window.updateReportCompletion) {
        window.updateReportCompletion();
      }
    });
    reportForm.addEventListener('reset', () => {
      window.setTimeout(() => {
        syncCustomIncidentType();
        if (window.updateReportCompletion) {
          window.updateReportCompletion();
        }
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

    if (window.updateReportCompletion) {
      window.updateReportCompletion();
    }

    return true;
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
    aiReportNotice.className = state === 'warning'
      ? 'notice-strip notice-warning'
      : 'notice-strip';
    aiReportNotice.querySelector('span').textContent = message;
  }
});
