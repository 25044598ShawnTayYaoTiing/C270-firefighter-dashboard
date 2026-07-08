document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  const OTHER_INCIDENT_TYPE_VALUE = '__other_special_incident__';
  const transcriptInput = document.getElementById('transcriptInput');
  const generateButton = document.getElementById('generateDraftButton');
  const aiReportNotice = document.getElementById('aiReportNotice');
  const reportForm = document.getElementById('reportForm');
  const incidentTypeSelect = document.getElementById('incidentType');
  const customIncidentTypeField = document.getElementById('customIncidentTypeField');
  const customIncidentTypeInput = document.getElementById('customIncidentType');
  const enhanceMissingInfoButton = document.getElementById('enhanceMissingInfoButton');
  const missingInfoEnhancementNotice = document.getElementById('missingInfoEnhancementNotice');
  const enhanceMissingInfoButtonContent = enhanceMissingInfoButton ? enhanceMissingInfoButton.innerHTML : '';

  setupCustomIncidentType();

  if (!transcriptInput || !generateButton) return;

  loadSentTranscript();
  generateButton.addEventListener('click', generateAiReport);
  if (enhanceMissingInfoButton) {
    enhanceMissingInfoButton.addEventListener('click', enhanceMissingInformation);
  }

  function loadSentTranscript() {
    const params = new URLSearchParams(window.location.search);
    const directTranscript = params.get('transcriptText');
    const storedTranscript = localStorage.getItem(TRANSCRIPT_STORAGE_KEY);

    if (directTranscript && !transcriptInput.value.trim()) {
      transcriptInput.value = directTranscript;
    }

    if (params.get('transcript') === 'sent' && storedTranscript && !transcriptInput.value.trim()) {
      transcriptInput.value = storedTranscript;
      localStorage.removeItem(TRANSCRIPT_STORAGE_KEY);
    }
  }

  // Done BY SHAWN ID 25044598
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
      }

      if (data.success) {
        showNotice('ready', 'Report draft generated. Review and edit before saving.');
      } else {
        showNotice('warning', data.error || 'Report drafting service is unavailable. A manual draft was loaded for editing.');
      }
    } catch (error) {
      fillReportForm(buildClientFallbackReport(transcript));
      showNotice('warning', 'Report drafting service is unavailable. A manual draft was loaded for editing.');
    } finally {
      generateButton.disabled = false;
    }
  }

  // Done BY SHAWN ID 25044598
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

  // Done BY SHAWN ID 25044598
  // AI Missing Information enhancement: sends current report context to Ollama and keeps the result editable.
  async function enhanceMissingInformation() {
    if (!enhanceMissingInfoButton) return;

    setEnhanceMissingInfoLoading(true);
    showMissingInfoNotice('checking', 'Enhancing missing information with Ollama AI.');

    try {
      const response = await fetch('/api/ai/enhance-missing-information', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(getMissingInformationPayload())
      });
      const data = await readJsonResponse(response);

      if (!response.ok || !data.success || typeof data.missingInformation !== 'string') {
        showMissingInfoNotice('warning', data.error || 'Missing information enhancement is unavailable. Please review manually.');
        return;
      }

      setFieldValue('missingInfo', data.missingInformation);
      showMissingInfoNotice('ready', 'Missing information enhanced. Review and edit before saving.');
    } catch (error) {
      console.error('Missing information enhancement failed:', error);
      showMissingInfoNotice('warning', 'Missing information enhancement is unavailable. Please review manually.');
    } finally {
      setEnhanceMissingInfoLoading(false);
    }
  }

  // Done BY SHAWN ID 25044598
  // AI Missing Information enhancement: safely handles JSON API responses and stale non-JSON server errors.
  async function readJsonResponse(response) {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      throw new Error(`Enhancement endpoint returned ${response.status} without JSON.`);
    }

    return response.json();
  }

  function getMissingInformationPayload() {
    return {
      transcript: transcriptInput.value.trim(),
      location: getFieldValue('incidentLocation'),
      incident_type: getIncidentTypeValue(),
      incident_summary: getFieldValue('incidentSummary'),
      hazards: getFieldValue('hazards'),
      injured_or_trapped_persons: getFieldValue('injuredPersons'),
      missing_information: getFieldValue('missingInfo')
    };
  }

  function getFieldValue(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  function getIncidentTypeValue() {
    if (!incidentTypeSelect) return '';

    if (incidentTypeSelect.value === OTHER_INCIDENT_TYPE_VALUE) {
      return customIncidentTypeInput ? customIncidentTypeInput.value.trim() : '';
    }

    return incidentTypeSelect.value.trim();
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

  function showMissingInfoNotice(state, message) {
    if (!missingInfoEnhancementNotice) return;

    missingInfoEnhancementNotice.className = state === 'warning'
      ? 'notice-strip notice-warning'
      : 'notice-strip';
    missingInfoEnhancementNotice.querySelector('span').textContent = message;
  }

  function setEnhanceMissingInfoLoading(isLoading) {
    enhanceMissingInfoButton.disabled = isLoading;
    enhanceMissingInfoButton.innerHTML = isLoading
      ? '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span><span>Enhancing...</span>'
      : enhanceMissingInfoButtonContent;
  }
});
