(() => {
  const storageKey = 'data-mess:theme:v1';
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  const backgrounds = {light:'#f6f7f8',dark:'#141414'};
  const icons = {
    dark: '<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>'
  };
  const validTheme = value => value === 'light' || value === 'dark';
  let preference = null;
  try { const saved = localStorage.getItem(storageKey); if (validTheme(saved)) preference = saved; } catch {}
  let selectedTheme = preference || (systemTheme?.matches ? 'dark' : 'light');

  function updateButtons() {
    const nextTheme = selectedTheme === 'dark' ? 'light' : 'dark';
    const label = nextTheme === 'dark' ? 'Mode gelap' : 'Mode terang';
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-label', `Gunakan ${label.toLowerCase()}`);
      button.title = `Gunakan ${label.toLowerCase()}`;
      button.innerHTML = `<svg class="theme-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[nextTheme]}</svg><span class="theme-label">${label}</span>`;
    });
  }
  function applyTheme(theme) {
    selectedTheme = theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgrounds[theme]);
    updateButtons();
  }
  // Runs before the stylesheet and page content, avoiding a light page flash.
  applyTheme(selectedTheme);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-theme-toggle]')) return;
    preference = selectedTheme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(storageKey, preference); } catch {}
    applyTheme(preference);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateButtons, {once:true});
  else updateButtons();
  systemTheme?.addEventListener?.('change', event => {
    if (!preference) applyTheme(event.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = validTheme(event.newValue) ? event.newValue : null;
    applyTheme(preference || (systemTheme?.matches ? 'dark' : 'light'));
  });
})();
