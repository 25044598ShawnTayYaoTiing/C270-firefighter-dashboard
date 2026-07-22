// Done BY SHAWN ID 25044598
// Report completion measures report requirements, not AI input readiness or optional notes.
document.addEventListener('DOMContentLoaded', () => {
  const OTHER_INCIDENT_TYPE_VALUE = '__other_special_incident__';
  const widget = document.querySelector('[data-report-completion]');
  const form = document.querySelector('[data-completion-form]');

  if (!widget || !form) return;

  const fields = [
    { key: 'location', name: 'incidentLocation', label: 'Incident Location' },
    { key: 'locationVerified', name: 'locationVerified', label: 'Location Verification' },
    { key: 'type', name: 'incidentType', label: 'Incident Type' },
    { key: 'dateTime', name: 'incidentDateTime', label: 'Date and Time' },
    { key: 'status', name: 'responseStatus', label: 'Response Status' },
    { key: 'summary', name: 'incidentSummary', label: 'Incident Summary' },
    { key: 'hazards', name: 'hazards', label: 'Hazards' },
    { key: 'injured', name: 'injuredPersons', label: 'Injured or Trapped Persons' }
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
  const conditionalConfirmations = [
    {
      fieldName: 'hazards',
      checkboxId: 'noHazardsReported',
      canonicalText: 'No hazards reported'
    },
    {
      fieldName: 'injuredPersons',
      checkboxId: 'noInjuredPersonsReported',
      canonicalText: 'No injured or trapped persons reported'
    }
  ];

  let currentCompletion = { percent: 0, missing: fields };

  setupConditionalConfirmations();

  function updateCompletion() {
    const missing = fields.filter((field) => !hasMeaningfulFieldValue(field));
    const completedCount = fields.filter(hasMeaningfulFieldValue).length;
    const percent = Math.round((completedCount / fields.length) * 100);
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

    if (field.key === 'locationVerified') return normalized === 'true';
    if (field.key === 'dateTime') {
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(String(value).trim())
        && !Number.isNaN(new Date(value).getTime());
    }
    if (!normalized) return false;

    return !nonMeaningfulText.has(normalized);
  }

  function getCompletionMessage(percent) {
    if (percent === 100) return 'Report is complete and ready for final review.';
    if (percent < 50) return 'Critical incident details are still missing.';
    return 'Almost complete. Review the remaining required information.';
  }

  function setupConditionalConfirmations() {
    conditionalConfirmations.forEach((definition) => {
      const field = form.elements[definition.fieldName];
      const checkbox = document.getElementById(definition.checkboxId);
      if (!field || !checkbox) return;

      syncConditionalConfirmation(definition, field, checkbox);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          field.value = definition.canonicalText;
        } else if (isExplicitNoValue(field.value)) {
          field.value = '';
        }

        field.dispatchEvent(new Event('input', { bubbles: true }));
        updateCompletion();
      });
      field.addEventListener('input', () => {
        syncConditionalConfirmation(definition, field, checkbox);
        updateCompletion();
      });
    });
  }

  function syncConditionalConfirmation(definition, field, checkbox) {
    checkbox.checked = isExplicitNoValue(field.value, definition.fieldName);
  }

  function isExplicitNoValue(value, fieldName = '') {
    const normalized = String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .replace(/\.+$/, '');

    if (!normalized) return false;
    if (fieldName === 'hazards') {
      return ['no hazards reported', 'none', 'none reported'].includes(normalized);
    }
    if (fieldName === 'injuredPersons') {
      return ['no injured or trapped persons reported', 'none', 'none reported'].includes(normalized);
    }
    return normalized.startsWith('no hazards reported')
      || normalized.startsWith('no injured or trapped persons reported');
  }

  function createMissingItem(text) {
    const item = document.createElement('li');
    item.textContent = text;
    return item;
  }

  form.addEventListener('input', updateCompletion);
  form.addEventListener('change', updateCompletion);
  form.addEventListener('reset', () => {
    window.setTimeout(() => {
      conditionalConfirmations.forEach((definition) => {
        const field = form.elements[definition.fieldName];
        const checkbox = document.getElementById(definition.checkboxId);
        if (field && checkbox) syncConditionalConfirmation(definition, field, checkbox);
      });
      updateCompletion();
    }, 0);
  });
  form.addEventListener('submit', updateCompletion);

  window.updateReportCompletion = updateCompletion;
  updateCompletion();
});
