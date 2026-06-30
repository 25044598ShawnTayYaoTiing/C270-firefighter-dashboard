document.addEventListener('DOMContentLoaded', () => {
  const TRANSCRIPT_STORAGE_KEY = 'firefighter.transcriptDraft';
  const transcriptInput = document.getElementById('transcriptInput');
  const generateButton = document.getElementById('generateDraftButton');
  const aiReportNotice = document.getElementById('aiReportNotice');

  if (!transcriptInput || !generateButton) return;

  loadSentTranscript();
  generateButton.addEventListener('click', generateAiReport);

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

  function setFieldValue(id, value) {
    const field = document.getElementById(id);
    if (!field) return;

    if (field.tagName === 'SELECT' && value && !Array.from(field.options).some((option) => option.value === value)) {
      const option = new Option(value, value);
      field.add(option);
    }

    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));

    if (window.updateReportCompletion) {
      window.updateReportCompletion();
    }
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
