document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.js-delete-report').forEach((button) => {
    const form = button.closest('form');

    if (!form) return;

    form.addEventListener('submit', (event) => {
      const reportId = button.dataset.reportId;
      if (!window.confirm(`Delete ${reportId}?`)) {
        event.preventDefault();
      }
    });
  });

  const statusFilter = document.getElementById('statusFilter');
  const incidentSearch = document.getElementById('incidentSearch');
  const incidentsTable = document.getElementById('incidentsTable');

  function filterRows() {
    if (!incidentsTable) return;

    const statusValue = statusFilter ? statusFilter.value : 'All';
    const query = incidentSearch ? incidentSearch.value.trim().toLowerCase() : '';

    incidentsTable.querySelectorAll('tbody tr').forEach((row) => {
      const matchesStatus = statusValue === 'All' || row.dataset.status === statusValue;
      const searchableText = row.dataset.search || row.textContent.toLowerCase();
      const matchesSearch = searchableText.includes(query);
      row.hidden = !(matchesStatus && matchesSearch);
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      const status = statusFilter.value;
      const search = incidentSearch ? incidentSearch.value.trim() : '';
      const params = new URLSearchParams();

      if (status !== 'All') params.set('status', status);
      if (search) params.set('search', search);

      window.location.href = status === 'All'
        ? `/incidents${params.toString() ? `?${params.toString()}` : ''}`
        : `/incidents?${params.toString()}`;
    });
  }
  if (incidentSearch) {
    incidentSearch.addEventListener('input', filterRows);
  }
  filterRows();
});
