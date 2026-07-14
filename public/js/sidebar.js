(function () {
  var toggle = document.getElementById('sidebarToggle');
  if (!toggle) return;

  var body = document.body;
  var STORAGE_KEY = 'sidebarCollapsed';

  function apply(collapsed) {
    body.classList.toggle('sidebar-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) apply(saved === 'true');
  } catch (e) {}

  toggle.addEventListener('click', function () {
    var collapsed = body.classList.toggle('sidebar-collapsed');
    toggle.setAttribute('aria-expanded', String(!collapsed));
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch (e) {}
  });
})();
