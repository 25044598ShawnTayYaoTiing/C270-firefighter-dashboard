// Done BY SHAWN ID 25044598
// AI Features: report completion logic highlights missing fields while officers review AI-generated drafts.
document.addEventListener('DOMContentLoaded', () => {
  const OTHER_INCIDENT_TYPE_VALUE = '__other_special_incident__';
  const widget = document.querySelector('[data-report-completion]');
  const form = document.querySelector('[data-completion-form]');

  if (!widget || !form) return;

  const fields = [
    { key: 'transcript', name: 'transcript', label: 'Transcript', weight: 10 },
    { key: 'reportingOfficer', name: 'reportingOfficerId', label: 'Reporting Officer', weight: 10 },
    { key: 'location', name: 'incidentLocation', label: 'Incident Location', weight: 15 },
    { key: 'type', name: 'incidentType', label: 'Incident Type', weight: 15 },
    { key: 'dateTime', name: 'incidentDateTime', label: 'Date and Time', weight: 10 },
    { key: 'summary', name: 'incidentSummary', label: 'Incident Summary', weight: 15 },
    { key: 'hazards', name: 'hazards', label: 'Hazards', weight: 10 },
    { key: 'injured', name: 'injuredPersons', label: 'Injured or Trapped Persons', weight: 10 },
    { key: 'status', name: 'responseStatus', label: 'Response Status', weight: 5 }
  ];
  const nonMeaningfulText = new Set([
    'null',
    'undefined',
    'select type',
    'select reporting officer',
    'not identified in transcript',
    'not available',
    'n/a',
    'placeholder text'
  ]);
  let currentCompletion = {
    percent: 0,
    missing: fields
  };

  function updateCompletion() {
    const missing = fields.filter((field) => !hasMeaningfulFieldValue(field));
    const percent = fields.reduce((total, field) => {
      return hasMeaningfulFieldValue(field) ? total + field.weight : total;
    }, 0);
    const message = getCompletionMessage(percent);

    widget.querySelector('[data-completion-percent]').textContent = `${percent}%`;
    widget.querySelector('[data-completion-message]').textContent = message;
    widget.querySelector('[data-completion-bar]').style.width = `${percent}%`;
    currentCompletion = { percent, missing };

    const missingList = widget.querySelector('[data-missing-fields]');
    missingList.innerHTML = '';

    if (missing.length === 0) {
      missingList.appendChild(createMissingItem('None'));
      return;
    }

    missing.forEach((field) => {
      missingList.appendChild(createMissingItem(field.label));
    });
  }

  function hasMeaningfulFieldValue(field) {
    const input = form.elements[field.name];
    if (!input) return false;

    const value = field.key === 'type' && input.value === OTHER_INCIDENT_TYPE_VALUE
      ? (form.elements.customIncidentType ? form.elements.customIncidentType.value : '')
      : input.value || '';
    const normalized = String(value)
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\.+$/, '');

    if (!normalized) return false;
    if (field.key === 'status') return normalized !== 'draft';

    return !nonMeaningfulText.has(normalized);
  }

  function getCompletionMessage(percent) {
    if (percent === 0) return 'No report drafted yet.';
    if (percent < 50) return 'Critical details still missing.';
    if (percent < 80) return 'Review required before submission.';
    if (percent < 100) return 'Almost complete. Please verify remaining details.';
    return 'Report appears complete.';
  }

  function createMissingItem(text) {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }

  form.addEventListener('input', updateCompletion);
  form.addEventListener('change', updateCompletion);
  form.addEventListener('reset', () => {
    window.setTimeout(updateCompletion, 0);
  });
  form.addEventListener('submit', (event) => {
    updateCompletion();

    if (event.submitter && event.submitter.value === 'report' && currentCompletion.percent < 100) {
      const missingLabels = currentCompletion.missing.map((field) => field.label).join(', ');
      window.alert(`Report completion is ${currentCompletion.percent}%. Missing fields: ${missingLabels || 'None'}. Saving will continue for this prototype.`);
    }
  });

  window.updateReportCompletion = updateCompletion;
  updateCompletion();
});
