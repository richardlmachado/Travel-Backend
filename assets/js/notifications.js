/**
 * TravelAgent OS — Notification System
 * Substitui o Sonner (React) por toasts vanilla JS
 * Uso: Notify.success('msg') | Notify.error('msg') | Notify.info('msg') | Notify.warning('msg')
 */

const Notify = (() => {
  const ICONS = {
    success: 'bi-check-circle-fill',
    error:   'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info:    'bi-info-circle-fill',
  };

  const DURATION = 4000;

  function _getContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function _remove(el) {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  function show(message, type = 'info') {
    const container = _getContainer();
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const toast = document.createElement('div');
    toast.id = id;
    toast.className = `os-toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <i class="bi ${ICONS[type]} os-toast-icon"></i>
      <span class="os-toast-body">${message}</span>
      <button class="os-toast-close" aria-label="Fechar">
        <i class="bi bi-x"></i>
      </button>
    `;

    toast.querySelector('.os-toast-close').addEventListener('click', () => _remove(toast));

    container.appendChild(toast);

    // Auto-remove após DURATION ms
    setTimeout(() => {
      if (document.getElementById(id)) _remove(toast);
    }, DURATION);
  }

  return {
    show,
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error'),
    warning: (msg) => show(msg, 'warning'),
    info:    (msg) => show(msg, 'info'),
  };
})();
