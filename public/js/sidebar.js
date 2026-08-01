(function () {
  const toggle = document.getElementById('sidebarToggle');
  if (!toggle) return;

  const body = document.body;
  const STORAGE_KEY = 'sidebarCollapsed';

  function apply(collapsed) {
    body.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function readSavedState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === null ? null : saved === 'true';
    } catch {
      return null;
    }
  }

  function saveState(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      // Storage may be blocked; the in-page sidebar toggle still works.
    }
  }

  const savedState = readSavedState();
  if (savedState !== null) apply(savedState);

  toggle.addEventListener('click', function () {
    const collapsed = !body.classList.contains('sidebar-collapsed');
    apply(collapsed);
    saveState(collapsed);
  });
})();
