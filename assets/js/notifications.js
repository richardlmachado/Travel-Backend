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

    const icon = document.createElement('i');
    icon.className = `bi ${ICONS[type]} os-toast-icon`;

    const body = document.createElement('span');
    body.className = 'os-toast-body';
    body.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'os-toast-close';
    closeBtn.setAttribute('aria-label', 'Fechar');
    closeBtn.innerHTML = '<i class="bi bi-x"></i>';
    closeBtn.addEventListener('click', () => _remove(toast));

    toast.append(icon, body, closeBtn);

    container.appendChild(toast);

    // Auto-remove após DURATION ms
    setTimeout(() => {
      if (document.getElementById(id)) _remove(toast);
    }, DURATION);
  }

  /**
   * Modal de confirmação (substitui window.confirm nativo).
   * @param {string} message  texto da pergunta
   * @param {object} [opts]   { title, confirmLabel, cancelLabel, variant: 'primary'|'danger' }
   * @returns {Promise<boolean>}
   */
  function confirm(message, opts = {}) {
    const {
      title        = 'Confirmar',
      confirmLabel = 'Confirmar',
      cancelLabel  = 'Cancelar',
      variant      = 'primary',
    } = opts;

    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'os-confirm-backdrop';

      const modal = document.createElement('div');
      modal.className = 'os-confirm-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'os-confirm-title');

      const h = document.createElement('h3');
      h.id = 'os-confirm-title';
      h.className = 'os-confirm-title';
      h.textContent = title;

      const p = document.createElement('p');
      p.className = 'os-confirm-message';
      p.textContent = message;

      const actions = document.createElement('div');
      actions.className = 'os-confirm-actions';

      const btnCancel = document.createElement('button');
      btnCancel.className = 'os-confirm-btn os-confirm-btn-ghost';
      btnCancel.textContent = cancelLabel;

      const btnOk = document.createElement('button');
      btnOk.className = `os-confirm-btn os-confirm-btn-${variant === 'danger' ? 'danger' : 'primary'}`;
      btnOk.textContent = confirmLabel;

      actions.append(btnCancel, btnOk);
      modal.append(h, p, actions);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      function cleanup(result) {
        document.removeEventListener('keydown', onKey);
        backdrop.remove();
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') cleanup(true);
      }
      btnCancel.addEventListener('click', () => cleanup(false));
      btnOk.addEventListener('click', () => cleanup(true));
      backdrop.addEventListener('click', e => { if (e.target === backdrop) cleanup(false); });
      document.addEventListener('keydown', onKey);
      setTimeout(() => btnOk.focus(), 50);
    });
  }

  return {
    show,
    confirm,
    success: (msg) => show(msg, 'success'),
    error:   (msg) => show(msg, 'error'),
    warning: (msg) => show(msg, 'warning'),
    info:    (msg) => show(msg, 'info'),
  };
})();
