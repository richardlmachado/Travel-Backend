/**
 * TravelAgent OS — Auth System
 * Autenticação via API real com fallback local para desenvolvimento
 */

const Auth = (() => {
  const STORAGE_KEY = 'travelos-user';
  const API_BASE    = '/api';

  /**
   * Tenta autenticar via API
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ ok: boolean, error?: string, user?: object }>}
   */
  async function login(email, password) {
    if (!email || !password) {
      return { ok: false, error: 'Preencha todos os campos.' };
    }

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.toLowerCase().trim(), senha: password }),
      });

      const data = await res.json();

      if (!data.ok) {
        return { ok: false, error: data.error || 'E-mail ou senha incorretos.' };
      }

      const session = {
        id:      data.user.id,
        email:   data.user.email,
        name:    data.user.nome,
        role:    data.user.role,
        cargo:   data.user.cargo,
        loja_id: data.user.loja_id,
        token:   data.token,
        loginAt: new Date().toISOString(),
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));

      // Salvar permissões RBAC
      if (data.permissoes) {
        localStorage.setItem('travelos-perms', JSON.stringify(data.permissoes));
      }

      return { ok: true, user: session };

    } catch (err) {
      console.error('Auth.login error:', err);
      return { ok: false, error: 'Não foi possível conectar ao servidor.' };
    }
  }

  /**
   * Encerra a sessão e redireciona para o login
   */
  function logout() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('travelos-perms');
    sessionStorage.removeItem('travelos-contexto');
    Notify.info('Sessão encerrada. Até logo!');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 800);
  }

  /**
   * Retorna o usuário logado ou null
   * @returns {object|null}
   */
  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  /**
   * Retorna o token JWT armazenado
   * @returns {string|null}
   */
  function getToken() {
    const user = getUser();
    return user ? user.token : null;
  }

  /**
   * Helper para fetch autenticado
   * @param {string} path  - ex: '/api/clientes'
   * @param {object} opts  - options do fetch
   */
  async function apiFetch(path, opts = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    };
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) {
      logout();
      throw new Error('Sessão expirada');
    }
    return res;
  }

  /**
   * Verifica se há sessão ativa
   * @returns {boolean}
   */
  function isLoggedIn() {
    return !!getUser();
  }

  /**
   * Guarda de rota — redireciona para login se não autenticado
   */
  function guard() {
    if (!isLoggedIn()) {
      window.location.href = 'index.html';
    }
  }

  /**
   * Preenche elementos com dados do usuário logado
   */
  function populateUI() {
    const user = getUser();
    if (!user) return;

    document.querySelectorAll('[data-user-name]').forEach(el => { el.textContent = user.name; });
    document.querySelectorAll('[data-user-role]').forEach(el => { el.textContent = user.role; });
    document.querySelectorAll('[data-user-cargo]').forEach(el => { el.textContent = user.cargo || user.role; });
    document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = user.email; });

    const initials = user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    document.querySelectorAll('[data-user-initials]').forEach(el => { el.textContent = initials; });

    const ctx = getContexto();
    if (ctx?.loja) {
      document.querySelectorAll('[data-loja-nome]').forEach(el => { el.textContent = ctx.loja.nome; });
      document.querySelectorAll('[data-loja-codigo]').forEach(el => { el.textContent = ctx.loja.codigo; });
    }
  }

  /**
   * Busca e cacheia o contexto da sessão (loja + moedas)
   * @returns {Promise<object|null>}
   */
  async function loadContexto() {
    try {
      const res  = await apiFetch('/api/contexto');
      const body = await res.json();
      if (body.ok) {
        sessionStorage.setItem('travelos-contexto', JSON.stringify(body.data));
        return body.data;
      }
    } catch (e) { console.error('loadContexto:', e); }
    return null;
  }

  /**
   * Retorna o contexto cacheado (loja, moedas) ou null
   */
  function getContexto() {
    try { return JSON.parse(sessionStorage.getItem('travelos-contexto')); }
    catch { return null; }
  }

  /**
   * Retorna as permissões RBAC do usuário logado
   * @returns {object} ex: { vendas: ['ver','criar','editar'], ... }
   */
  function getPerms() {
    try { return JSON.parse(localStorage.getItem('travelos-perms')) || {}; }
    catch { return {}; }
  }

  /**
   * Verifica se o usuário tem permissão para uma ação num módulo
   * @param {string} modulo - ex: 'vendas'
   * @param {string} acao   - ex: 'ver' (default) | 'criar' | 'editar' | 'excluir'
   * @returns {boolean}
   */
  function temPerm(modulo, acao = 'ver') {
    const perms = getPerms();
    return Array.isArray(perms[modulo]) && perms[modulo].includes(acao);
  }

  /**
   * Esconde itens da sidebar e botões com base nas permissões
   * Chamar após populateUI()
   */
  function aplicarRBAC() {
    const perms = getPerms();

    // Sidebar: esconder links para módulos sem permissão de ver
    const modMap = {
      'dashboard.html': 'dashboard',
      'reservas.html': 'vendas',
      'clientes.html': 'clientes',
      'financeiro.html': 'financeiro',
      'comissoes-config.html': 'comissoes',
      'lembretes.html': 'lembretes',
      'usuarios.html': 'usuarios',
      'configuracoes.html': 'configuracoes',
    };

    document.querySelectorAll('.os-nav-item[data-page]').forEach(link => {
      const page = link.dataset.page;
      const modulo = modMap[page];
      if (modulo && !temPerm(modulo, 'ver')) {
        link.style.display = 'none';
      }
    });

    // Botões de criar: esconder se sem permissão
    document.querySelectorAll('[data-perm]').forEach(el => {
      const [mod, act] = el.dataset.perm.split(':');
      if (!temPerm(mod, act)) el.style.display = 'none';
    });
  }

  return { login, logout, getUser, getToken, isLoggedIn, guard, populateUI, apiFetch, loadContexto, getContexto, getPerms, temPerm, aplicarRBAC };
})();
