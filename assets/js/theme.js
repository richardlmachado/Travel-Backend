/**
 * TravelAgent OS — Theme System (Dark / Light Mode)
 * Persiste preferência no localStorage
 */

const Theme = (() => {
  const STORAGE_KEY = 'travelos-theme';
  let _btnBound = false;

  /**
   * Aplica o tema ao <html>
   * @param {'light'|'dark'} mode
   */
  function apply(mode) {
    document.documentElement.setAttribute('data-bs-theme', mode);
    localStorage.setItem(STORAGE_KEY, mode);

    // Atualiza ícone do botão de toggle (se existir)
    const iconEl = document.getElementById('theme-icon');
    if (iconEl) {
      iconEl.className = mode === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
    }

    // Atualiza tooltip/title do botão (se existir)
    const btnEl = document.getElementById('theme-toggle');
    if (btnEl) {
      btnEl.title = mode === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro';
    }
  }

  /**
   * Alterna entre dark e light
   */
  function toggle() {
    const current = document.documentElement.getAttribute('data-bs-theme') || 'light';
    apply(current === 'dark' ? 'light' : 'dark');
  }

  /**
   * Inicializa com preferência salva ou preferência do sistema
   */
  function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      apply(saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      apply(prefersDark ? 'dark' : 'light');
    }

    // Vincula o botão de toggle (se existir na página) — uma única vez
    if (!_btnBound) {
      const btn = document.getElementById('theme-toggle');
      if (btn) {
        btn.addEventListener('click', toggle);
        _btnBound = true;
      }
    }
  }

  /**
   * Retorna o tema atual
   * @returns {'light'|'dark'}
   */
  function current() {
    return document.documentElement.getAttribute('data-bs-theme') || 'light';
  }

  return { init, apply, toggle, current };
})();
