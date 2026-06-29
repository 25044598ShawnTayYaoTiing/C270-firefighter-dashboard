document.addEventListener('DOMContentLoaded', () => {
  const widget = document.querySelector('[data-report-completion]');
  const form = document.querySelector('[data-completion-form]');

  if (!widget || !form) return;

  const fields = [
    { name: 'incidentLocation', label: 'Incident Location' },
    { name: 'incidentType', label: 'Incident Type' },
    { name: 'incidentDateTime', label: 'Date and Time' },
    { name: 'incidentSummary', label: 'Incident Summary' },
    { name: 'responseStatus', label: 'Response Status' },
    { name: 'hazards', label: 'Hazards' },
    { name: 'injuredPersons', label: 'Injured or Trapped Persons' }
  ];

  function updateCompletion() {
    const missing = fields.filter((field) => {
      const input = form.elements[field.name];
      return !input || !String(input.value || '').trim();
    });
    const filledCount = fields.length - missing.length;
    const percent = Math.round((filledCount / fields.length) * 100);
    const message = percent === 100
      ? 'Report appears complete.'
      : percent < 70
        ? 'Review required before submission.'
        : 'Report is almost complete.';

    widget.querySelector('[data-completion-percent]').textContent = `${percent}%`;
    widget.querySelector('[data-completion-message]').textContent = message;
    widget.querySelector('[data-completion-bar]').style.width = `${percent}%`;

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

  window.updateReportCompletion = updateCompletion;
  updateCompletion();
});
