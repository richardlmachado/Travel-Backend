/**
 * TravelAgent OS — App Init
 * Inicialização global: carrega Theme, Auth.populateUI e Sidebar
 * Incluir em todas as páginas internas (após notifications.js, auth.js, theme.js)
 */

const App = (() => {

  let _initialized = false;

  /** Inicializa a sidebar responsiva */
  function _initSidebar() {
    const sidebar  = document.getElementById('sidebar');
    const overlay  = document.getElementById('os-overlay');
    const btnOpen  = document.getElementById('sidebar-open');
    const btnClose = document.getElementById('sidebar-close');

    if (!sidebar) return;

    function open() {
      sidebar.classList.add('open');
      if (overlay) overlay.classList.add('active');
    }

    function close() {
      sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('active');
    }

    if (btnOpen)  btnOpen.addEventListener('click', open);
    if (btnClose) btnClose.addEventListener('click', close);
    if (overlay)  overlay.addEventListener('click', close);
  }

  /** Inicializa o botão de logout */
  function _initLogout() {
    document.querySelectorAll('[data-action="logout"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        Auth.logout();
      });
    });
  }

  /** Destaca o nav item ativo conforme a página atual */
  function _highlightNav() {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.os-nav-item[data-page]').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.page === page) {
        item.classList.add('active');
      }
    });
  }

  /**
   * Inicialização principal — chamar em todas as páginas internas
   * Faz guard de autenticação, aplica tema e popula UI
   */
  async function init() {
    if (_initialized) return;
    _initialized = true;

    // 1. Protege a rota
    Auth.guard();

    // 2. Aplica tema salvo
    Theme.init();

    // 3. Carrega contexto da sessão (loja + moedas) se ainda não cacheado
    if (!Auth.getContexto()) await Auth.loadContexto();

    // 4. Preenche dados do usuário e da loja na UI
    Auth.populateUI();

    // 5. Sidebar responsiva
    _initSidebar();

    // 6. Logout
    _initLogout();

    // 7. Nav ativo
    _highlightNav();

    // 8. RBAC — esconde itens sem permissão
    Auth.aplicarRBAC();
  }

  /**
   * Inicialização para a página de login (sem guard)
   * Redireciona para dashboard se já estiver logado
   */
  function initLogin() {
    Theme.init();

    if (Auth.isLoggedIn()) {
      window.location.href = 'dashboard.html';
    }
  }

  return { init, initLogin };
})();
