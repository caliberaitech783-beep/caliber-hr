// Additive connection check for the current Hostinger bundle. Does not replace
// the existing Caliber Pulse login or send its credentials to the HR API.
(() => {
  const origin = 'https://hr-api-cmll-783.azurewebsites.net';
  window.HR_API_ORIGIN = origin;
  const badge = document.createElement('span');
  badge.setAttribute('role', 'status');
  badge.setAttribute('aria-label', 'HR database service');
  badge.className = 'hr-cloud-status';
  badge.textContent = 'Checking service...';
  const style = document.createElement('style');
  style.textContent = '.hr-cloud-status{display:inline-block;font:500 12px/1.4 sans-serif;padding:6px 10px;border-radius:18px;background:#edf2f7;color:#52657a;white-space:nowrap}.hr-cloud-status.connected{background:#e6f7ef;color:#146b49}.hr-cloud-status.unavailable{background:#fff0ee;color:#a52b22}.login-card>.hr-cloud-status{display:block;width:max-content;margin:10px auto 0}@media(max-width:760px){.hr-cloud-status{font-size:10px;padding:5px 7px}}';
  document.head.appendChild(style);
  function mount() {
    const header = document.querySelector('.header-actions');
    const note = document.querySelector('.secure-note');
    if (header && badge.parentNode !== header) header.prepend(badge);
    else if (!header && note && badge.previousElementSibling !== note) note.after(badge);
  }
  new MutationObserver(mount).observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
  mount();
  async function check() {
    try {
      const response = await fetch(`${origin}/api/ready`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      const connected = response.ok && result.status === 'ready' && result.database === 'connected';
      badge.className = `hr-cloud-status ${connected ? 'connected' : 'unavailable'}`;
      badge.textContent = connected ? 'Service connected' : 'Service unavailable';
    } catch {
      badge.className = 'hr-cloud-status unavailable';
      badge.textContent = 'Service unavailable';
    }
  }
  void check();
  window.setInterval(check, 60000);
})();
