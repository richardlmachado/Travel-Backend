const express  = require('express');
const mysql    = require('mysql2/promise');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');

const app        = express();
const JWT_SECRET = process.env.JWT_SECRET || 'travelos_secret_2025';
const PORT       = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Pool MySQL
const pool = mysql.createPool({
  host:               process.env.DB_HOST || 'travelos-db',
  user:               process.env.DB_USER || 'travelos',
  password:           process.env.DB_PASS || '***REDACTED-DB***',
  database:           process.env.DB_NAME || 'travelos',
  waitForConnections: true,
  connectionLimit:    10,
});

// ── Middleware JWT ────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ ok: false, error: 'Não autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!req.user.loja_id) return res.status(401).json({ ok: false, error: 'Sessão sem loja vinculada. Refazer login.' });
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

// Admin/Financeiro only (por role)
function adminOrFinanceiro(req, res, next) {
  if (!['admin', 'financeiro'].includes(req.user.role))
    return res.status(403).json({ ok: false, error: 'Acesso negado' });
  next();
}

// Gestor (diretor/gerente por cargo)
function gestorOnly(req, res, next) {
  if (!['diretor', 'gerente'].includes(req.user.cargo))
    return res.status(403).json({ ok: false, error: 'Acesso restrito a gestores' });
  next();
}

// ── Audit helper ─────────────────────────────────────────────
async function audit(tabela, registro_id, acao, campo, valor_antes, valor_depois, usuario_id, loja_id) {
  await pool.query(
    'INSERT INTO auditoria (loja_id,tabela,registro_id,acao,campo,valor_antes,valor_depois,usuario_id) VALUES (?,?,?,?,?,?,?,?)',
    [loja_id || null, tabela, registro_id, acao, campo, valor_antes?.toString(), valor_depois?.toString(), usuario_id]
  );
}

// ── Comissão engine ──────────────────────────────────────────
async function calcularComissao(reserva_id, agente_id, origem_lead, valor_venda, mes_referencia) {
  let percentual;

  if (origem_lead === 'agente') {
    percentual = 50;
  } else {
    // Busca acumulado do mês ANTES desta venda
    const [[{ acumulado }]] = await pool.query(
      `SELECT COALESCE(SUM(valor_comissao),0) as acumulado
       FROM comissoes
       WHERE agente_id = ? AND mes_referencia = ? AND status != 'estornado'`,
      [agente_id, mes_referencia]
    );

    // Tabela progressiva: 20% até 10k, +1% a cada 2k, teto 30%
    if (acumulado >= 30000)      percentual = 30;
    else if (acumulado >= 10000) percentual = 20 + Math.floor((acumulado - 10000) / 2000) + 1;
    else                         percentual = 20;

    percentual = Math.min(percentual, 30);
  }

  const valor_comissao = +(valor_venda * percentual / 100).toFixed(2);

  await pool.query(
    `INSERT INTO comissoes (reserva_id,agente_id,origem_lead,percentual,valor_venda,valor_comissao,mes_referencia)
     VALUES (?,?,?,?,?,?,?)`,
    [reserva_id, agente_id, origem_lead, percentual, valor_venda, valor_comissao, mes_referencia]
  );

  return { percentual, valor_comissao };
}

// ── Health ────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '4.0.0-sprint4', ts: new Date().toISOString() });
});

// ── Auth ──────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha)
      return res.status(400).json({ ok: false, error: 'Email e senha obrigatórios' });

    const [rows] = await pool.query(
      'SELECT * FROM usuarios WHERE email = ? AND ativo = 1', [email]
    );
    if (!rows.length)
      return res.status(401).json({ ok: false, error: 'Email ou senha incorretos' });

    const user  = rows[0];
    const valid = await bcrypt.compare(senha, user.senha);
    if (!valid)
      return res.status(401).json({ ok: false, error: 'Email ou senha incorretos' });

    const token = jwt.sign(
      { id: user.id, email: user.email, nome: user.nome, role: user.role, loja_id: user.loja_id, cargo: user.cargo },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      ok: true, token,
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role, loja_id: user.loja_id, cargo: user.cargo }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

// ── Contexto da sessão (loja + moedas + usuario) ─────────────
app.get('/api/contexto', auth, async (req, res) => {
  try {
    const [[loja]]  = await pool.query('SELECT id, codigo, nome, razao_social, cnpj FROM lojas WHERE id = ?', [req.user.loja_id]);
    const [moedas]  = await pool.query('SELECT codigo, nome, simbolo, padrao FROM moedas WHERE ativo = 1 ORDER BY padrao DESC, codigo');
    res.json({ ok: true, data: {
      usuario: { id: req.user.id, nome: req.user.nome, email: req.user.email, role: req.user.role, cargo: req.user.cargo, loja_id: req.user.loja_id },
      loja, moedas,
    }});
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Lojas (listagem — diretor vê todas, outros só a própria) ──
app.get('/api/lojas', auth, async (req, res) => {
  try {
    const where = req.user.cargo === 'diretor' ? '' : 'WHERE id = ?';
    const params = req.user.cargo === 'diretor' ? [] : [req.user.loja_id];
    const [rows] = await pool.query(`SELECT id, codigo, nome, cnpj, ativo FROM lojas ${where} ORDER BY nome`, params);
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Moedas (listagem) ────────────────────────────────────────
app.get('/api/moedas', auth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT codigo, nome, simbolo, padrao FROM moedas WHERE ativo = 1 ORDER BY padrao DESC, codigo');
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Usuários (listagem para selects — sempre escopada à loja) ──
app.get('/api/usuarios', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nome, email, role, cargo FROM usuarios WHERE ativo = 1 AND loja_id = ? ORDER BY nome',
      [req.user.loja_id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Clientes (unificado: CRM + Pagantes, PF/PJ) ──────────────
app.get('/api/clientes', auth, async (req, res) => {
  try {
    const { q, tipo_pessoa, eh_pagante, eh_passageiro, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE c.loja_id = ?', params = [req.user.loja_id];
    if (q) {
      where += ' AND (c.nome LIKE ? OR c.razao_social LIKE ? OR c.email LIKE ? OR c.telefone LIKE ? OR c.cpf LIKE ? OR c.cnpj LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (tipo_pessoa)   { where += ' AND c.tipo_pessoa = ?';   params.push(tipo_pessoa); }
    if (eh_pagante)    { where += ' AND c.eh_pagante = 1'; }
    if (eh_passageiro) { where += ' AND c.eh_passageiro = 1'; }

    const [rows] = await pool.query(
      `SELECT c.*, u.nome as agente_nome FROM clientes c
       LEFT JOIN usuarios u ON c.agente_id = u.id
       ${where} ORDER BY c.nome LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM clientes c ${where}`, params
    );
    res.json({ ok: true, data: rows, total, page: +page });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/clientes/:id', auth, async (req, res) => {
  try {
    const [[cliente]] = await pool.query(
      `SELECT c.*, u.nome as agente_nome FROM clientes c
       LEFT JOIN usuarios u ON c.agente_id = u.id
       WHERE c.id = ? AND c.loja_id = ?`, [req.params.id, req.user.loja_id]
    );
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

    res.json({ ok: true, data: cliente });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/clientes', auth, async (req, res) => {
  try {
    const {
      tipo_pessoa = 'PF', nome, razao_social, email, telefone, whatsapp,
      cpf, cnpj, passaporte, data_nascimento, endereco, observacoes,
      eh_pagante = 1, eh_passageiro = 1, agente_id,
    } = req.body;
    if (!nome) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });

    const [r] = await pool.query(
      `INSERT INTO clientes
        (loja_id, tipo_pessoa, nome, razao_social, email, telefone, whatsapp,
         cpf, cnpj, passaporte, data_nascimento, endereco, observacoes,
         eh_pagante, eh_passageiro, agente_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.loja_id, tipo_pessoa, nome, razao_social, email, telefone, whatsapp,
       cpf, cnpj, passaporte, data_nascimento || null, endereco, observacoes,
       eh_pagante ? 1 : 0, eh_passageiro ? 1 : 0, agente_id || req.user.id]
    );
    await audit('clientes', r.insertId, 'criacao', null, null, nome, req.user.id, req.user.loja_id);
    broadcast('cliente_criado', { id: r.insertId, nome, loja_id: req.user.loja_id });
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.put('/api/clientes/:id', auth, async (req, res) => {
  try {
    // garante que só edita cliente da própria loja
    const [[exist]] = await pool.query('SELECT id FROM clientes WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!exist) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

    const {
      tipo_pessoa, nome, razao_social, email, telefone, whatsapp,
      cpf, cnpj, passaporte, data_nascimento, endereco, observacoes,
      eh_pagante, eh_passageiro, agente_id,
    } = req.body;

    await pool.query(
      `UPDATE clientes SET tipo_pessoa=?, nome=?, razao_social=?, email=?, telefone=?, whatsapp=?,
         cpf=?, cnpj=?, passaporte=?, data_nascimento=?, endereco=?, observacoes=?,
         eh_pagante=?, eh_passageiro=?, agente_id=?
       WHERE id=? AND loja_id=?`,
      [tipo_pessoa, nome, razao_social, email, telefone, whatsapp,
       cpf, cnpj, passaporte, data_nascimento || null, endereco, observacoes,
       eh_pagante ? 1 : 0, eh_passageiro ? 1 : 0, agente_id,
       req.params.id, req.user.loja_id]
    );
    await audit('clientes', req.params.id, 'edicao', 'geral', null, nome, req.user.id, req.user.loja_id);
    broadcast('cliente_atualizado', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/clientes/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM clientes WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    await audit('clientes', req.params.id, 'cancelamento', null, null, null, req.user.id, req.user.loja_id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Fornecedores ──────────────────────────────────────────────
app.get('/api/fornecedores', auth, async (req, res) => {
  try {
    const { q, tipo, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE f.ativo = 1 AND f.loja_id = ?', params = [req.user.loja_id];
    if (q)    { where += ' AND (f.nome LIKE ? OR f.cnpj LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
    if (tipo) { where += ' AND f.tipo = ?'; params.push(tipo); }

    const [rows] = await pool.query(
      `SELECT f.*, COUNT(r.id) as total_reservas FROM fornecedores f
       LEFT JOIN reservas r ON r.fornecedor_id = f.id
       ${where} GROUP BY f.id ORDER BY f.nome LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM fornecedores f ${where}`, params
    );
    res.json({ ok: true, data: rows, total, page: +page });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/fornecedores/:id', auth, async (req, res) => {
  try {
    const [[f]] = await pool.query('SELECT * FROM fornecedores WHERE id=?', [req.params.id]);
    if (!f) return res.status(404).json({ ok: false, error: 'Fornecedor não encontrado' });
    const [reservas] = await pool.query(
      `SELECT r.codigo, r.destino, r.status, r.valor_total, r.criado_em FROM reservas r
       WHERE r.fornecedor_id = ? ORDER BY r.criado_em DESC LIMIT 20`, [req.params.id]
    );
    res.json({ ok: true, data: { ...f, reservas } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/fornecedores', auth, async (req, res) => {
  try {
    const { nome, razao_social, cnpj, tipo, contato_nome, contato_email, contato_telefone, condicoes_pgto, comissao_padrao, observacoes } = req.body;
    if (!nome) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO fornecedores (loja_id,nome,razao_social,cnpj,tipo,contato_nome,contato_email,contato_telefone,condicoes_pgto,comissao_padrao,observacoes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.loja_id, nome, razao_social, cnpj, tipo || 'operadora', contato_nome, contato_email, contato_telefone, condicoes_pgto, comissao_padrao || 0, observacoes]
    );
    await audit('fornecedores', r.insertId, 'criacao', null, null, nome, req.user.id, req.user.loja_id);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.put('/api/fornecedores/:id', auth, async (req, res) => {
  try {
    const { nome, razao_social, cnpj, tipo, contato_nome, contato_email, contato_telefone, condicoes_pgto, comissao_padrao, observacoes } = req.body;
    await pool.query(
      `UPDATE fornecedores SET nome=?,razao_social=?,cnpj=?,tipo=?,contato_nome=?,contato_email=?,
       contato_telefone=?,condicoes_pgto=?,comissao_padrao=?,observacoes=? WHERE id=?`,
      [nome, razao_social, cnpj, tipo, contato_nome, contato_email, contato_telefone, condicoes_pgto, comissao_padrao, observacoes, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/fornecedores/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE fornecedores SET ativo=0 WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Reservas ──────────────────────────────────────────────────
app.get('/api/reservas', auth, async (req, res) => {
  try {
    const { status, tipo_produto, agente_id, page = 1, limit = 20, q } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE (r.loja_id = ? OR r.loja_id IS NULL)', params = [req.user.loja_id];

    // Agente só vê suas próprias reservas
    if (req.user.role === 'agente') {
      where += ' AND r.agente_id = ?'; params.push(req.user.id);
    } else if (agente_id) {
      where += ' AND r.agente_id = ?'; params.push(agente_id);
    }

    if (status)       { where += ' AND r.status = ?';       params.push(status); }
    if (tipo_produto) { where += ' AND r.tipo_produto = ?'; params.push(tipo_produto); }
    if (q) {
      where += ' AND (c.nome LIKE ? OR r.codigo LIKE ? OR r.destino LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const [rows] = await pool.query(
      `SELECT r.*,
              c.nome  as cliente_nome,
              f.nome  as fornecedor_nome,
              u.nome  as agente_nome
       FROM reservas r
       LEFT JOIN clientes    c ON r.cliente_id    = c.id
       LEFT JOIN fornecedores f ON r.fornecedor_id = f.id
       LEFT JOIN usuarios    u ON r.agente_id     = u.id
       ${where}
       ORDER BY r.criado_em DESC LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );

    // Agente não vê custo
    const data = rows.map(r => {
      if (req.user.role === 'agente') { delete r.custo; }
      return r;
    });

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM reservas r
       LEFT JOIN clientes c ON r.cliente_id = c.id
       ${where}`, params
    );

    res.json({ ok: true, data, total, page: +page });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.get('/api/reservas/:id', auth, async (req, res) => {
  try {
    const [[r]] = await pool.query(
      `SELECT r.*,
              c.nome  as cliente_nome, c.email as cliente_email, c.telefone as cliente_telefone,
              f.nome  as fornecedor_nome,
              u.nome  as agente_nome
       FROM reservas r
       LEFT JOIN clientes     c ON r.cliente_id    = c.id
       LEFT JOIN fornecedores f ON r.fornecedor_id = f.id
       LEFT JOIN usuarios     u ON r.agente_id     = u.id
       WHERE r.id = ?`, [req.params.id]
    );
    if (!r) return res.status(404).json({ ok: false, error: 'Reserva não encontrada' });
    if (req.user.role === 'agente') delete r.custo;

    const [audit_log] = await pool.query(
      `SELECT a.*, u.nome as usuario_nome FROM auditoria a
       LEFT JOIN usuarios u ON a.usuario_id = u.id
       WHERE a.tabela = 'reservas' AND a.registro_id = ?
       ORDER BY a.criado_em DESC`, [req.params.id]
    );

    res.json({ ok: true, data: { ...r, audit_log } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/reservas', auth, (req, res) => {
  res.status(410).json({ ok: false, error: 'Endpoint descontinuado em Sprint 3. Use /api/vendas.' });
});

app.put('/api/reservas/:id', auth, async (req, res) => {
  try {
    const {
      tipo_produto, cliente_id, fornecedor_id, agente_id,
      origem_lead, destino, data_saida, data_embarque, data_retorno,
      custo, markup, markup_tipo, valor_total,
      forma_pgto, valor_recebido, status_pgto, vencimento, observacoes
    } = req.body;

    let vt = valor_total;
    if (!vt && custo && markup) {
      vt = markup_tipo === 'percentual'
        ? +(custo * (1 + markup / 100)).toFixed(2)
        : +(+custo + +markup).toFixed(2);
    }

    await pool.query(
      `UPDATE reservas SET
       tipo_produto=?,cliente_id=?,fornecedor_id=?,agente_id=?,origem_lead=?,
       destino=?,data_saida=?,data_embarque=?,data_retorno=?,valor_total=?,
       custo=?,markup=?,markup_tipo=?,forma_pgto=?,valor_recebido=?,
       status_pgto=?,vencimento=?,observacoes=? WHERE id=?`,
      [tipo_produto, cliente_id, fornecedor_id, agente_id, origem_lead,
       destino, data_saida, data_embarque||null, data_retorno||null, vt,
       custo, markup, markup_tipo, forma_pgto, valor_recebido||0,
       status_pgto, vencimento||null, observacoes, req.params.id]
    );

    await audit('reservas', req.params.id, 'edicao', 'geral', null, destino, req.user.id);
    broadcast('reserva_atualizada', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/reservas/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const [[old]] = await pool.query('SELECT status, agente_id, origem_lead, valor_total FROM reservas WHERE id=?', [req.params.id]);

    await pool.query('UPDATE reservas SET status=? WHERE id=?', [status, req.params.id]);
    await audit('reservas', req.params.id, 'status', 'status', old.status, status, req.user.id);

    // Gera comissão ao confirmar
    if (status === 'confirmada' && old.status !== 'confirmada' && old.agente_id) {
      const mes = new Date().toISOString().slice(0, 7);
      await calcularComissao(req.params.id, old.agente_id, old.origem_lead, old.valor_total, mes);
    }

    // Estorna comissão ao cancelar reserva confirmada
    if (status === 'cancelada' && old.status === 'confirmada') {
      await pool.query(
        'UPDATE comissoes SET status="estornado" WHERE reserva_id=?', [req.params.id]
      );
    }

    broadcast('reserva_status', { id: req.params.id, status });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Dashboard ─────────────────────────────────────────────────
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const mes = new Date().toISOString().slice(0, 7);
    const [[{ total_reservas }]]  = await pool.query('SELECT COUNT(*) as total_reservas FROM reservas');
    const [[{ pendentes }]]       = await pool.query("SELECT COUNT(*) as pendentes FROM reservas WHERE status='pendente'");
    const [[{ confirmadas }]]     = await pool.query("SELECT COUNT(*) as confirmadas FROM reservas WHERE status='confirmada'");
    const [[{ total_clientes }]]  = await pool.query('SELECT COUNT(*) as total_clientes FROM clientes');
    const [[{ receita_total }]]   = await pool.query("SELECT COALESCE(SUM(valor_total),0) as receita_total FROM reservas WHERE status='confirmada'");
    const [[{ comissoes_mes }]]   = await pool.query(
      "SELECT COALESCE(SUM(valor_comissao),0) as comissoes_mes FROM comissoes WHERE mes_referencia=? AND status!='estornado'", [mes]
    );

    // Embarques nas próximas 48h
    const [embarques] = await pool.query(
      `SELECT r.id, r.codigo, r.destino, r.data_embarque, r.lembrete_enviado,
              c.nome as cliente_nome, u.nome as agente_nome
       FROM reservas r
       LEFT JOIN clientes c ON r.cliente_id = c.id
       LEFT JOIN usuarios u ON r.agente_id  = u.id
       WHERE r.status = 'confirmada'
         AND r.data_embarque BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 48 HOUR)
       ORDER BY r.data_embarque ASC`
    );

    res.json({ ok: true, data: { total_reservas, pendentes, confirmadas, total_clientes, receita_total, comissoes_mes, embarques } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Financeiro ────────────────────────────────────────────────
app.get('/api/financeiro', auth, async (req, res) => {
  try {
    const { tipo, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '', params = [];
    if (tipo) { where = 'WHERE tipo = ?'; params = [tipo]; }
    const [rows] = await pool.query(
      `SELECT f.*, r.codigo as reserva_codigo FROM financeiro f
       LEFT JOIN reservas r ON f.reserva_id = r.id
       ${where} ORDER BY f.criado_em DESC LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM financeiro ${where}`, params);
    res.json({ ok: true, data: rows, total });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/financeiro', auth, async (req, res) => {
  try {
    const { reserva_id, tipo, descricao, valor, vencimento } = req.body;
    if (!tipo || !descricao || !valor)
      return res.status(400).json({ ok: false, error: 'tipo, descricao e valor obrigatórios' });
    const [r] = await pool.query(
      'INSERT INTO financeiro (reserva_id,tipo,descricao,valor,vencimento) VALUES (?,?,?,?,?)',
      [reserva_id, tipo, descricao, valor, vencimento]
    );
    broadcast('financeiro_criado', { id: r.insertId, tipo, valor });
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Comissões ─────────────────────────────────────────────────
app.get('/api/comissoes', auth, async (req, res) => {
  try {
    const { mes, agente_id, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1', params = [];

    if (req.user.role === 'agente') {
      where += ' AND c.agente_id = ?'; params.push(req.user.id);
    } else if (agente_id) {
      where += ' AND c.agente_id = ?'; params.push(agente_id);
    }
    if (mes) { where += ' AND c.mes_referencia = ?'; params.push(mes); }

    const [rows] = await pool.query(
      `SELECT c.*, r.codigo as reserva_codigo, r.destino, u.nome as agente_nome
       FROM comissoes c
       JOIN reservas r ON c.reserva_id = r.id
       JOIN usuarios u ON c.agente_id  = u.id
       ${where} ORDER BY c.criado_em DESC LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM comissoes c ${where}`, params
    );
    const [[{ total_valor }]] = await pool.query(
      `SELECT COALESCE(SUM(c.valor_comissao),0) as total_valor FROM comissoes c
       ${where} AND c.status != 'estornado'`, params
    );
    res.json({ ok: true, data: rows, total, total_valor });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.patch('/api/comissoes/:id/status', auth, adminOrFinanceiro, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE comissoes SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── SSE: Tempo Real ───────────────────────────────────────────
const sseClients = new Set();

app.get('/api/eventos', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ ok: false, error: 'Não autorizado' });
  try { req.user = jwt.verify(token, JWT_SECRET); } catch { return res.status(401).json({ ok: false, error: 'Token inválido' }); }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
  res.write(`data: ${JSON.stringify({ tipo: 'conectado', ts: new Date().toISOString() })}\n\n`);
});

function broadcast(tipo, payload) {
  const msg = `data: ${JSON.stringify({ tipo, payload, ts: new Date().toISOString() })}\n\n`;
  sseClients.forEach(client => client.write(msg));
}

// ── Vendas ────────────────────────────────────────────────────

/**
 * Gera próximo código de venda: YYYYMMDD-NNNN (por loja × dia)
 * Usa vendas_seq com INSERT ... ON DUPLICATE KEY para ser atômico.
 */
async function gerarCodigoVenda(conn, loja_id, data_abertura) {
  const dia = (data_abertura || new Date().toISOString().slice(0, 10));
  await conn.query(
    `INSERT INTO vendas_seq (loja_id, dia, seq) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE seq = seq + 1`,
    [loja_id, dia]
  );
  const [[{ seq }]] = await conn.query(
    'SELECT seq FROM vendas_seq WHERE loja_id = ? AND dia = ?',
    [loja_id, dia]
  );
  const ymd = dia.replace(/-/g, '');
  return `${ymd}-${String(seq).padStart(4, '0')}`;
}

/**
 * Recalcula total_custo e total_venda de uma venda a partir dos itens.
 */
async function recalcVendaTotais(conn, venda_id) {
  await conn.query(
    `UPDATE vendas v SET
       total_custo = COALESCE((SELECT SUM(total_custo_brl) FROM venda_itens WHERE venda_id = ?), 0),
       total_venda = COALESCE((SELECT SUM(total_venda_brl) FROM venda_itens WHERE venda_id = ?), 0)
     WHERE id = ?`,
    [venda_id, venda_id, venda_id]
  );
}

// GET /api/vendas — listagem com filtros
app.get('/api/vendas', auth, async (req, res) => {
  try {
    const { status, agente_id, cliente_id, q, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE v.loja_id = ?', params = [req.user.loja_id];

    if (req.user.role === 'agente') {
      where += ' AND v.agente_id = ?'; params.push(req.user.id);
    } else if (agente_id) {
      where += ' AND v.agente_id = ?'; params.push(agente_id);
    }
    if (status)    { where += ' AND v.status = ?'; params.push(status); }
    if (cliente_id){ where += ' AND v.cliente_id = ?'; params.push(cliente_id); }
    if (q) {
      where += ' AND (v.codigo LIKE ? OR c.nome LIKE ? OR c.razao_social LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const [rows] = await pool.query(
      `SELECT v.id, v.codigo, v.status, v.origem_lead, v.moeda_base,
              v.total_custo, v.total_venda, v.data_abertura, v.data_fechamento,
              v.cotacao_validade, v.criado_em,
              c.nome  AS cliente_nome,  c.tipo_pessoa,
              u.nome  AS agente_nome
         FROM vendas v
         LEFT JOIN clientes  c ON v.cliente_id = c.id
         LEFT JOIN usuarios  u ON v.agente_id  = u.id
         ${where}
         ORDER BY v.criado_em DESC LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM vendas v
         LEFT JOIN clientes c ON v.cliente_id = c.id
         ${where}`, params
    );
    res.json({ ok: true, data: rows, total, page: +page });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/vendas/:id — detalhe com itens, pax e log
app.get('/api/vendas/:id', auth, async (req, res) => {
  try {
    const [[venda]] = await pool.query(
      `SELECT v.*, c.nome AS cliente_nome, c.tipo_pessoa, c.email AS cliente_email,
              c.telefone AS cliente_telefone, c.cpf, c.cnpj,
              u.nome AS agente_nome, u.email AS agente_email
         FROM vendas v
         LEFT JOIN clientes  c ON v.cliente_id = c.id
         LEFT JOIN usuarios  u ON v.agente_id  = u.id
         WHERE v.id = ? AND v.loja_id = ?`,
      [req.params.id, req.user.loja_id]
    );
    if (!venda) return res.status(404).json({ ok: false, error: 'Venda não encontrada' });

    const [itens] = await pool.query(
      `SELECT vi.*, f.nome AS fornecedor_nome
         FROM venda_itens vi
         LEFT JOIN fornecedores f ON vi.fornecedor_id = f.id
         WHERE vi.venda_id = ? ORDER BY vi.ordem, vi.id`,
      [req.params.id]
    );

    const [pax] = await pool.query(
      'SELECT * FROM venda_pax WHERE venda_id = ? ORDER BY id',
      [req.params.id]
    );

    const [pax_itens] = await pool.query(
      'SELECT * FROM pax_itens WHERE item_id IN (SELECT id FROM venda_itens WHERE venda_id = ?)',
      [req.params.id]
    );

    const [audit_log] = await pool.query(
      `SELECT a.*, u.nome AS usuario_nome FROM auditoria a
         LEFT JOIN usuarios u ON a.usuario_id = u.id
         WHERE a.tabela = 'vendas' AND a.registro_id = ?
         ORDER BY a.criado_em DESC LIMIT 50`,
      [req.params.id]
    );

    res.json({ ok: true, data: { ...venda, itens, pax, pax_itens, audit_log } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/vendas — cria venda (com itens e pax opcionais)
app.post('/api/vendas', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const {
      cliente_id, origem_lead = 'agencia', moeda_base = 'BRL',
      cotacao_validade, data_abertura, observacoes, condicoes_gerais, regras,
      itens = [], pax = [],
    } = req.body;

    const dia    = data_abertura || new Date().toISOString().slice(0, 10);
    const codigo = await gerarCodigoVenda(conn, req.user.loja_id, dia);

    const [r] = await conn.query(
      `INSERT INTO vendas
         (loja_id, codigo, status, cliente_id, agente_id, origem_lead,
          moeda_base, cotacao_validade, data_abertura, observacoes,
          condicoes_gerais, regras, criado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.loja_id, codigo, 'cotacao', cliente_id || null,
       req.user.id, origem_lead, moeda_base,
       cotacao_validade || null, dia, observacoes || null,
       condicoes_gerais || null, regras || null, req.user.id]
    );
    const venda_id = r.insertId;

    // Insere itens
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      const custo_brl = +((+it.tarifa + +it.taxas + +(it.outros_custos || 0)) * +(it.taxa_cambio || 1)).toFixed(2);
      let venda_brl = custo_brl;
      if (it.markup_tipo === 'percentual') venda_brl = +(custo_brl * (1 + +(it.markup_valor || 0) / 100)).toFixed(2);
      else if (it.markup_tipo === 'fixo')  venda_brl = +(custo_brl + +(it.markup_valor || 0)).toFixed(2);
      const com_forn_val = +(+(it.comissao_forn_pct || 0) / 100 * custo_brl).toFixed(2);

      const [ir] = await conn.query(
        `INSERT INTO venda_itens
           (venda_id, ordem, tipo_produto, fornecedor_id, descricao, localizador,
            data_inicio, data_fim, moeda_fornecedor, taxa_cambio,
            tarifa, taxas, outros_custos, total_custo_brl,
            markup_tipo, markup_valor, total_venda_brl,
            comissao_forn_pct, comissao_forn_valor, detalhes_json, observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [venda_id, i + 1, it.tipo_produto || 'OTHER', it.fornecedor_id || null,
         it.descricao || null, it.localizador || null,
         it.data_inicio || null, it.data_fim || null,
         it.moeda_fornecedor || 'BRL', +(it.taxa_cambio || 1),
         +(it.tarifa || 0), +(it.taxas || 0), +(it.outros_custos || 0), custo_brl,
         it.markup_tipo || 'percentual', +(it.markup_valor || 0), venda_brl,
         +(it.comissao_forn_pct || 0), com_forn_val,
         it.detalhes_json ? JSON.stringify(it.detalhes_json) : null,
         it.observacoes || null]
      );

      // Vincula pax ao item se informado
      if (Array.isArray(it.pax_ids)) {
        for (const pid of it.pax_ids) {
          await conn.query('INSERT IGNORE INTO pax_itens (item_id, pax_id) VALUES (?,?)', [ir.insertId, pid]);
        }
      }
    }

    // Insere passageiros
    const paxIds = [];
    for (const p of pax) {
      const [pr] = await conn.query(
        `INSERT INTO venda_pax
           (venda_id, nome, sobrenome, genero, nascimento, tipo_doc, num_doc,
            passaporte_numero, passaporte_validade, passaporte_emissor,
            nacionalidade, email, telefone, tipo_pax, observacoes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [venda_id, p.nome, p.sobrenome || null, p.genero || null, p.nascimento || null,
         p.tipo_doc || 'cpf', p.num_doc || null,
         p.passaporte_numero || null, p.passaporte_validade || null, p.passaporte_emissor || null,
         p.nacionalidade || null, p.email || null, p.telefone || null,
         p.tipo_pax || 'ADT', p.observacoes || null]
      );
      paxIds.push(pr.insertId);
    }

    await recalcVendaTotais(conn, venda_id);
    await conn.query(
      'INSERT INTO auditoria (loja_id,tabela,registro_id,acao,campo,valor_depois,usuario_id) VALUES (?,?,?,?,?,?,?)',
      [req.user.loja_id, 'vendas', venda_id, 'criacao', null, codigo, req.user.id]
    );

    await conn.commit();
    broadcast('venda_criada', { id: venda_id, codigo, loja_id: req.user.loja_id });
    res.status(201).json({ ok: true, id: venda_id, codigo });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally { conn.release(); }
});

// PUT /api/vendas/:id — atualiza cabeçalho da venda
app.put('/api/vendas/:id', auth, async (req, res) => {
  try {
    const [[venda]] = await pool.query('SELECT id, status FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!venda) return res.status(404).json({ ok: false, error: 'Venda não encontrada' });
    if (venda.status === 'cancelada') return res.status(400).json({ ok: false, error: 'Venda cancelada não pode ser editada' });

    const { cliente_id, agente_id, origem_lead, moeda_base, cotacao_validade,
            observacoes, condicoes_gerais, regras,
            grupo, responsavel_compra, voucher_status } = req.body;
    await pool.query(
      `UPDATE vendas SET cliente_id=?, agente_id=?, origem_lead=?, moeda_base=?,
         cotacao_validade=?, observacoes=?, condicoes_gerais=?, regras=?,
         grupo=?, responsavel_compra=?, voucher_status=?
       WHERE id=? AND loja_id=?`,
      [cliente_id || null, agente_id || req.user.id, origem_lead || 'agencia', moeda_base || 'BRL',
       cotacao_validade || null, observacoes || null, condicoes_gerais || null, regras || null,
       grupo || null, responsavel_compra || null, voucher_status || null,
       req.params.id, req.user.loja_id]
    );
    await audit('vendas', req.params.id, 'edicao', 'cabecalho', null, null, req.user.id, req.user.loja_id);
    broadcast('venda_atualizada', { id: +req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// PATCH /api/vendas/:id/status — muda status
app.patch('/api/vendas/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const VALIDOS = ['cotacao', 'confirmada', 'cancelada', 'concluida'];
    if (!VALIDOS.includes(status)) return res.status(400).json({ ok: false, error: 'Status inválido' });

    const [[old]] = await pool.query('SELECT status FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!old) return res.status(404).json({ ok: false, error: 'Venda não encontrada' });

    const extra = {};
    if (['confirmada', 'concluida'].includes(status)) extra.data_fechamento = new Date().toISOString().slice(0, 10);

    await pool.query(
      `UPDATE vendas SET status=? ${extra.data_fechamento ? ', data_fechamento=?' : ''} WHERE id=? AND loja_id=?`,
      extra.data_fechamento
        ? [status, extra.data_fechamento, req.params.id, req.user.loja_id]
        : [status, req.params.id, req.user.loja_id]
    );
    await audit('vendas', req.params.id, 'status', 'status', old.status, status, req.user.id, req.user.loja_id);
    broadcast('venda_status', { id: +req.params.id, status });

    // Auto-calcular comissoes ao confirmar
    if (['confirmada','concluida'].includes(status) && !['confirmada','concluida'].includes(old.status)) {
      try {
        const [[v2]] = await pool.query(
          `SELECT v.*, u.cargo FROM vendas v LEFT JOIN usuarios u ON v.agente_id = u.id WHERE v.id = ?`,
          [req.params.id]
        );
        if (v2 && v2.agente_id) {
          const conn2 = await pool.getConnection();
          try {
            await conn2.beginTransaction();
            const mes2 = (v2.data_fechamento || new Date().toISOString()).slice(0, 7);
            await calcularComissoesVenda(conn2, +req.params.id, req.user.loja_id, v2.agente_id, v2.cargo, v2.origem_lead, mes2);
            await conn2.commit();
          } catch (e) { await conn2.rollback(); console.error('Comissao err:', e.message); }
          finally { conn2.release(); }
        }
      } catch (e) { console.error('Comissao auto err:', e.message); }
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/vendas/:id/itens — adiciona item
app.post('/api/vendas/:id/itens', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[venda]] = await conn.query('SELECT id, status FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!venda) return conn.rollback(), conn.release(), res.status(404).json({ ok: false, error: 'Venda não encontrada' });
    if (venda.status === 'cancelada') return conn.rollback(), conn.release(), res.status(400).json({ ok: false, error: 'Venda cancelada' });

    const it = req.body;
    const [[{ ordem }]] = await conn.query('SELECT COALESCE(MAX(ordem),0)+1 AS ordem FROM venda_itens WHERE venda_id=?', [req.params.id]);
    const custo_brl = +((+it.tarifa + +it.taxas + +(it.outros_custos || 0)) * +(it.taxa_cambio || 1)).toFixed(2);
    let venda_brl = custo_brl;
    if (it.markup_tipo === 'percentual') venda_brl = +(custo_brl * (1 + +(it.markup_valor || 0) / 100)).toFixed(2);
    else if (it.markup_tipo === 'fixo')  venda_brl = +(custo_brl + +(it.markup_valor || 0)).toFixed(2);
    const com_forn_val = +(+(it.comissao_forn_pct || 0) / 100 * custo_brl).toFixed(2);

    const [r] = await conn.query(
      `INSERT INTO venda_itens
         (venda_id, ordem, tipo_produto, fornecedor_id, descricao, localizador,
          data_inicio, data_fim, moeda_fornecedor, taxa_cambio,
          tarifa, taxas, outros_custos, total_custo_brl,
          markup_tipo, markup_valor, total_venda_brl,
          comissao_forn_pct, comissao_forn_valor, detalhes_json, observacoes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.id, ordem, it.tipo_produto || 'OTHER', it.fornecedor_id || null,
       it.descricao || null, it.localizador || null,
       it.data_inicio || null, it.data_fim || null,
       it.moeda_fornecedor || 'BRL', +(it.taxa_cambio || 1),
       +(it.tarifa || 0), +(it.taxas || 0), +(it.outros_custos || 0), custo_brl,
       it.markup_tipo || 'percentual', +(it.markup_valor || 0), venda_brl,
       +(it.comissao_forn_pct || 0), com_forn_val,
       it.detalhes_json ? JSON.stringify(it.detalhes_json) : null,
       it.observacoes || null]
    );
    await recalcVendaTotais(conn, +req.params.id);
    await audit('vendas', req.params.id, 'edicao', 'item_adicionado', null, it.tipo_produto, req.user.id, req.user.loja_id);
    await conn.commit();
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: err.message });
  } finally { conn.release(); }
});

// PUT /api/vendas/:id/itens/:itemId — atualiza item
app.put('/api/vendas/:id/itens/:itemId', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[item]] = await conn.query(
      'SELECT vi.id FROM venda_itens vi JOIN vendas v ON vi.venda_id=v.id WHERE vi.id=? AND v.id=? AND v.loja_id=?',
      [req.params.itemId, req.params.id, req.user.loja_id]
    );
    if (!item) return conn.rollback(), conn.release(), res.status(404).json({ ok: false, error: 'Item não encontrado' });

    const it = req.body;
    const custo_brl = +((+it.tarifa + +it.taxas + +(it.outros_custos || 0)) * +(it.taxa_cambio || 1)).toFixed(2);
    let venda_brl = custo_brl;
    if (it.markup_tipo === 'percentual') venda_brl = +(custo_brl * (1 + +(it.markup_valor || 0) / 100)).toFixed(2);
    else if (it.markup_tipo === 'fixo')  venda_brl = +(custo_brl + +(it.markup_valor || 0)).toFixed(2);
    const com_forn_val = +(+(it.comissao_forn_pct || 0) / 100 * custo_brl).toFixed(2);

    await conn.query(
      `UPDATE venda_itens SET
         tipo_produto=?, fornecedor_id=?, descricao=?, localizador=?,
         data_inicio=?, data_fim=?, moeda_fornecedor=?, taxa_cambio=?,
         tarifa=?, taxas=?, outros_custos=?, total_custo_brl=?,
         markup_tipo=?, markup_valor=?, total_venda_brl=?,
         comissao_forn_pct=?, comissao_forn_valor=?,
         comissao_agente_pct=?, comissao_agente_valor=?,
         detalhes_json=?, observacoes=?
       WHERE id=?`,
      [it.tipo_produto || 'OTHER', it.fornecedor_id || null,
       it.descricao || null, it.localizador || null,
       it.data_inicio || null, it.data_fim || null,
       it.moeda_fornecedor || 'BRL', +(it.taxa_cambio || 1),
       +(it.tarifa || 0), +(it.taxas || 0), +(it.outros_custos || 0), custo_brl,
       it.markup_tipo || 'percentual', +(it.markup_valor || 0), venda_brl,
       +(it.comissao_forn_pct || 0), com_forn_val,
       +(it.comissao_agente_pct || 0), +(it.comissao_agente_valor || 0),
       it.detalhes_json ? JSON.stringify(it.detalhes_json) : null,
       it.observacoes || null,
       req.params.itemId]
    );
    await recalcVendaTotais(conn, +req.params.id);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: err.message });
  } finally { conn.release(); }
});

// DELETE /api/vendas/:id/itens/:itemId — remove item
app.delete('/api/vendas/:id/itens/:itemId', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[item]] = await conn.query(
      'SELECT vi.id FROM venda_itens vi JOIN vendas v ON vi.venda_id=v.id WHERE vi.id=? AND v.id=? AND v.loja_id=?',
      [req.params.itemId, req.params.id, req.user.loja_id]
    );
    if (!item) return conn.rollback(), conn.release(), res.status(404).json({ ok: false, error: 'Item não encontrado' });
    await conn.query('DELETE FROM venda_itens WHERE id=?', [req.params.itemId]);
    await recalcVendaTotais(conn, +req.params.id);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: err.message });
  } finally { conn.release(); }
});

// POST /api/vendas/:id/pax — adiciona passageiro
app.post('/api/vendas/:id/pax', auth, async (req, res) => {
  try {
    const [[venda]] = await pool.query('SELECT id FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!venda) return res.status(404).json({ ok: false, error: 'Venda não encontrada' });
    const p = req.body;
    if (!p.nome) return res.status(400).json({ ok: false, error: 'Nome do passageiro obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO venda_pax
         (venda_id, nome, sobrenome, genero, nascimento, tipo_doc, num_doc,
          passaporte_numero, passaporte_validade, passaporte_emissor,
          nacionalidade, email, telefone, tipo_pax, observacoes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.id, p.nome, p.sobrenome || null, p.genero || null, p.nascimento || null,
       p.tipo_doc || 'cpf', p.num_doc || null,
       p.passaporte_numero || null, p.passaporte_validade || null, p.passaporte_emissor || null,
       p.nacionalidade || null, p.email || null, p.telefone || null,
       p.tipo_pax || 'ADT', p.observacoes || null]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// PUT /api/vendas/:id/pax/:paxId — atualiza passageiro
app.put('/api/vendas/:id/pax/:paxId', auth, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT vp.id FROM venda_pax vp JOIN vendas v ON vp.venda_id=v.id WHERE vp.id=? AND v.id=? AND v.loja_id=?',
      [req.params.paxId, req.params.id, req.user.loja_id]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'Passageiro não encontrado' });
    const p = req.body;
    await pool.query(
      `UPDATE venda_pax SET nome=?, sobrenome=?, genero=?, nascimento=?, tipo_doc=?, num_doc=?,
         passaporte_numero=?, passaporte_validade=?, passaporte_emissor=?,
         nacionalidade=?, email=?, telefone=?, tipo_pax=?, observacoes=?
       WHERE id=?`,
      [p.nome, p.sobrenome || null, p.genero || null, p.nascimento || null,
       p.tipo_doc || 'cpf', p.num_doc || null,
       p.passaporte_numero || null, p.passaporte_validade || null, p.passaporte_emissor || null,
       p.nacionalidade || null, p.email || null, p.telefone || null,
       p.tipo_pax || 'ADT', p.observacoes || null, req.params.paxId]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// DELETE /api/vendas/:id/pax/:paxId — remove passageiro
app.delete('/api/vendas/:id/pax/:paxId', auth, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      'SELECT vp.id FROM venda_pax vp JOIN vendas v ON vp.venda_id=v.id WHERE vp.id=? AND v.id=? AND v.loja_id=?',
      [req.params.paxId, req.params.id, req.user.loja_id]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'Passageiro não encontrado' });
    await pool.query('DELETE FROM venda_pax WHERE id=?', [req.params.paxId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/vendas/:id/pax-item — vincula pax a item
app.post('/api/vendas/:id/pax-item', auth, async (req, res) => {
  try {
    const { item_id, pax_id, detalhes_json } = req.body;
    await pool.query(
      'INSERT IGNORE INTO pax_itens (item_id, pax_id, detalhes_json) VALUES (?,?,?)',
      [item_id, pax_id, detalhes_json ? JSON.stringify(detalhes_json) : null]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Server listen ─────────────────────────────────────────────

// ── Pagamentos ────────────────────────────────────────────────

// GET /api/vendas/:id/pagamentos — lista pagamentos (filtro tipo opcional)
app.get('/api/vendas/:id/pagamentos', auth, async (req, res) => {
  try {
    const [[venda]] = await pool.query('SELECT id FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!venda) return res.status(404).json({ ok: false, error: 'Venda não encontrada' });

    const { tipo } = req.query;
    let where = 'WHERE p.venda_id = ? AND p.loja_id = ?';
    const params = [req.params.id, req.user.loja_id];
    if (tipo) { where += ' AND p.tipo = ?'; params.push(tipo); }

    const [pagamentos] = await pool.query(
      `SELECT p.*, c.nome AS pagante_nome
         FROM pagamentos p
         LEFT JOIN clientes c ON p.pagante_id = c.id
         ${where} ORDER BY p.id`,
      params
    );

    const ids = pagamentos.map(p => p.id);
    let parcelas = [];
    if (ids.length) {
      [parcelas] = await pool.query(
        'SELECT * FROM pagamento_parcelas WHERE pagamento_id IN (?) ORDER BY pagamento_id, numero',
        [ids]
      );
    }

    const parcelasPorPag = {};
    parcelas.forEach(pc => {
      if (!parcelasPorPag[pc.pagamento_id]) parcelasPorPag[pc.pagamento_id] = [];
      parcelasPorPag[pc.pagamento_id].push(pc);
    });

    const data = pagamentos.map(p => ({ ...p, parcelas: parcelasPorPag[p.id] || [] }));
    res.json({ ok: true, data });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/vendas/:id/pagamentos/sync
app.post('/api/vendas/:id/pagamentos/sync', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[venda]] = await conn.query('SELECT id, status FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!venda) return conn.rollback(), conn.release(), res.status(404).json({ ok: false, error: 'Venda não encontrada' });

    const { tipo, pagamentos = [] } = req.body;
    const TIPOS_VALIDOS = ['cliente_agencia', 'cliente_fornecedor', 'fornecedor_agencia'];
    if (!TIPOS_VALIDOS.includes(tipo))
      return conn.rollback(), conn.release(), res.status(400).json({ ok: false, error: 'Tipo inválido' });

    await conn.query('DELETE FROM pagamentos WHERE venda_id=? AND loja_id=? AND tipo=?', [req.params.id, req.user.loja_id, tipo]);

    const ids = [];
    for (const pag of pagamentos) {
      const valor = +(pag.valor || 0);
      if (valor <= 0) continue;

      const [r] = await conn.query(
        `INSERT INTO pagamentos
           (loja_id, venda_id, tipo, venda_item_id, pagante_id, moeda, valor,
            forma_pagamento, num_parcelas, observacoes, status, criado_por)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.user.loja_id, req.params.id, tipo,
         pag.venda_item_id || null, pag.pagante_id || null,
         pag.moeda || 'BRL', valor,
         pag.forma_pagamento || 'Pix', +(pag.num_parcelas || 1),
         pag.observacoes || null, 'pendente', req.user.id]
      );
      const pagId = r.insertId;
      ids.push(pagId);

      const parcelas = Array.isArray(pag.parcelas) ? pag.parcelas : [];
      for (const pc of parcelas) {
        if (!pc.data_vencimento) continue;
        await conn.query(
          `INSERT INTO pagamento_parcelas
             (pagamento_id, loja_id, numero, valor, multa_encargo,
              data_vencimento, data_pagamento, pago, conta)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [pagId, req.user.loja_id, +(pc.numero || 1),
           +(pc.valor || 0), +(pc.multa_encargo || 0),
           pc.data_vencimento,
           pc.data_pagamento || null,
           pc.pago ? 1 : 0,
           pc.conta || null]
        );
      }

      const [pagas]  = await conn.query('SELECT COUNT(*) AS n FROM pagamento_parcelas WHERE pagamento_id=? AND pago=1', [pagId]);
      const [totais] = await conn.query('SELECT COUNT(*) AS n FROM pagamento_parcelas WHERE pagamento_id=?', [pagId]);
      let statusPag = 'pendente';
      if (totais[0].n > 0) {
        if (pagas[0].n === totais[0].n)   statusPag = 'pago';
        else if (pagas[0].n > 0)          statusPag = 'parcial';
      }
      if (statusPag !== 'pendente')
        await conn.query('UPDATE pagamentos SET status=? WHERE id=?', [statusPag, pagId]);
    }

    await audit('vendas', req.params.id, 'edicao', `pagamentos_${tipo}`, null, `${pagamentos.length} pagamento(s)`, req.user.id, req.user.loja_id);
    await conn.commit();
    broadcast('pagamentos_sincronizados', { venda_id: +req.params.id, tipo, loja_id: req.user.loja_id });
    res.json({ ok: true, ids });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  } finally { conn.release(); }
});

// PATCH /api/vendas/:id/pagamentos/:pagId/parcelas/:parcId
app.patch('/api/vendas/:id/pagamentos/:pagId/parcelas/:parcId', auth, async (req, res) => {
  try {
    const [[row]] = await pool.query(
      `SELECT pp.id FROM pagamento_parcelas pp
         JOIN pagamentos p ON pp.pagamento_id = p.id
         JOIN vendas v ON p.venda_id = v.id
         WHERE pp.id=? AND p.id=? AND v.id=? AND v.loja_id=?`,
      [req.params.parcId, req.params.pagId, req.params.id, req.user.loja_id]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'Parcela não encontrada' });

    const { pago, data_pagamento, conta, valor, multa_encargo, data_vencimento } = req.body;

    await pool.query(
      `UPDATE pagamento_parcelas SET
         pago           = COALESCE(?,pago),
         data_pagamento = COALESCE(?,data_pagamento),
         conta          = COALESCE(?,conta),
         valor          = COALESCE(?,valor),
         multa_encargo  = COALESCE(?,multa_encargo),
         data_vencimento= COALESCE(?,data_vencimento)
       WHERE id=?`,
      [pago != null ? (pago ? 1 : 0) : null,
       data_pagamento || null,
       conta != null ? conta : null,
       valor != null ? +valor : null,
       multa_encargo != null ? +multa_encargo : null,
       data_vencimento || null,
       req.params.parcId]
    );

    const [pagas]  = await pool.query('SELECT COUNT(*) AS n FROM pagamento_parcelas WHERE pagamento_id=? AND pago=1', [req.params.pagId]);
    const [totais] = await pool.query('SELECT COUNT(*) AS n FROM pagamento_parcelas WHERE pagamento_id=?', [req.params.pagId]);
    let statusPag = 'pendente';
    if (totais[0].n > 0) {
      if (pagas[0].n === totais[0].n)  statusPag = 'pago';
      else if (pagas[0].n > 0)         statusPag = 'parcial';
    }
    await pool.query('UPDATE pagamentos SET status=? WHERE id=?', [statusPag, req.params.pagId]);

    broadcast('parcela_atualizada', { venda_id: +req.params.id, pagamento_id: +req.params.pagId });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});


// ── Comissões Fase 3 ──────────────────────────────────────────

// Helper: busca % comissão fornecedor para item
async function getComissaoFornPct(loja_id, fornecedor_id, tipo_produto) {
  const [rows] = await pool.query(
    `SELECT percentual FROM fornecedor_comissoes_config
     WHERE loja_id = ? AND ativo = 1
       AND (fornecedor_id = ? OR fornecedor_id IS NULL)
       AND tipo_produto = ?
     ORDER BY fornecedor_id DESC LIMIT 1`,
    [loja_id, fornecedor_id || null, tipo_produto]
  );
  return rows.length ? +rows[0].percentual : 0;
}

// Helper: busca % repasse ao agente
async function getComissaoAgentePct(loja_id, cargo, origem_lead) {
  const [rows] = await pool.query(
    `SELECT percentual FROM agente_comissoes_config
     WHERE loja_id = ? AND cargo = ? AND origem_lead = ? AND ativo = 1
     LIMIT 1`,
    [loja_id, cargo || 'agente', origem_lead || 'agencia']
  );
  return rows.length ? +rows[0].percentual : 0;
}

// Helper: calcula e grava comissões de uma venda
async function calcularComissoesVenda(conn, venda_id, loja_id, agente_id, cargo, origem_lead, mes) {
  await conn.query('DELETE FROM venda_comissoes WHERE venda_id = ? AND loja_id = ?', [venda_id, loja_id]);

  const [itens] = await conn.query(
    `SELECT id, fornecedor_id, tipo_produto, total_custo_brl, total_venda_brl,
            comissao_forn_pct, comissao_forn_valor,
            comissao_agente_pct, comissao_agente_valor
     FROM venda_itens WHERE venda_id = ?`,
    [venda_id]
  );

  for (const item of itens) {
    const forn_pct = +item.comissao_forn_pct || 0;
    const forn_val = +item.comissao_forn_valor || 0;

    if (forn_val > 0) {
      await conn.query(
        `INSERT INTO venda_comissoes
           (loja_id, venda_id, venda_item_id, agente_id, nivel,
            base_calculo, percentual, valor, mes_referencia)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [loja_id, venda_id, item.id, agente_id, 'forn_agencia',
         +item.total_custo_brl, forn_pct, forn_val, mes]
      );
    }

    const agente_pct_conf = await getComissaoAgentePct(loja_id, cargo, origem_lead);
    const agente_pct_item = +item.comissao_agente_pct || agente_pct_conf;
    const agente_val      = +(forn_val * agente_pct_item / 100).toFixed(4);

    if (!+item.comissao_agente_pct && agente_pct_item > 0) {
      await conn.query(
        'UPDATE venda_itens SET comissao_agente_pct=?, comissao_agente_valor=? WHERE id=?',
        [agente_pct_item, agente_val, item.id]
      );
    }

    if (agente_val > 0) {
      await conn.query(
        `INSERT INTO venda_comissoes
           (loja_id, venda_id, venda_item_id, agente_id, nivel,
            base_calculo, percentual, valor, mes_referencia)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [loja_id, venda_id, item.id, agente_id, 'agencia_agente',
         forn_val, agente_pct_item, agente_val, mes]
      );
    }
  }
}

// GET /api/comissoes/config/fornecedor
app.get('/api/comissoes/config/fornecedor', auth, async (req, res) => {
  try {
    const { fornecedor_id } = req.query;
    let where = 'WHERE c.loja_id = ? AND c.ativo = 1', params = [req.user.loja_id];
    if (fornecedor_id) { where += ' AND c.fornecedor_id = ?'; params.push(fornecedor_id); }
    const [rows] = await pool.query(
      `SELECT c.*, f.nome AS fornecedor_nome FROM fornecedor_comissoes_config c
       LEFT JOIN fornecedores f ON c.fornecedor_id = f.id
       ${where} ORDER BY f.nome, c.tipo_produto`,
      params
    );
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/comissoes/config/fornecedor
app.post('/api/comissoes/config/fornecedor', auth, async (req, res) => {
  try {
    const { fornecedor_id, tipo_produto, percentual } = req.body;
    if (!tipo_produto || percentual == null)
      return res.status(400).json({ ok: false, error: 'tipo_produto e percentual obrigatorios' });
    const [r] = await pool.query(
      `INSERT INTO fornecedor_comissoes_config (loja_id, fornecedor_id, tipo_produto, percentual)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE percentual=VALUES(percentual), ativo=1`,
      [req.user.loja_id, fornecedor_id || null, tipo_produto, +percentual]
    );
    res.status(201).json({ ok: true, id: r.insertId || null });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// PUT /api/comissoes/config/fornecedor/:id
app.put('/api/comissoes/config/fornecedor/:id', auth, async (req, res) => {
  try {
    const { tipo_produto, percentual, ativo } = req.body;
    await pool.query(
      `UPDATE fornecedor_comissoes_config SET tipo_produto=?, percentual=?, ativo=?
       WHERE id=? AND loja_id=?`,
      [tipo_produto, +percentual, ativo != null ? +ativo : 1, req.params.id, req.user.loja_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// DELETE /api/comissoes/config/fornecedor/:id
app.delete('/api/comissoes/config/fornecedor/:id', auth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE fornecedor_comissoes_config SET ativo=0 WHERE id=? AND loja_id=?',
      [req.params.id, req.user.loja_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/comissoes/config/agente
app.get('/api/comissoes/config/agente', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM agente_comissoes_config
       WHERE loja_id = ? AND ativo = 1 ORDER BY cargo, origem_lead`,
      [req.user.loja_id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// PUT /api/comissoes/config/agente/:id
app.put('/api/comissoes/config/agente/:id', auth, gestorOnly, async (req, res) => {
  try {
    const { percentual } = req.body;
    if (percentual == null) return res.status(400).json({ ok: false, error: 'percentual obrigatorio' });
    await pool.query(
      'UPDATE agente_comissoes_config SET percentual=? WHERE id=? AND loja_id=?',
      [+percentual, req.params.id, req.user.loja_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/comissoes/config/agente
app.post('/api/comissoes/config/agente', auth, gestorOnly, async (req, res) => {
  try {
    const { cargo, origem_lead, percentual } = req.body;
    if (!cargo || !origem_lead || percentual == null)
      return res.status(400).json({ ok: false, error: 'cargo, origem_lead e percentual obrigatorios' });
    const [r] = await pool.query(
      `INSERT INTO agente_comissoes_config (loja_id, cargo, origem_lead, percentual)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE percentual=VALUES(percentual), ativo=1`,
      [req.user.loja_id, cargo, origem_lead, +percentual]
    );
    res.status(201).json({ ok: true, id: r.insertId || null });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/comissoes/lookup?fornecedor_id=X&tipo_produto=Y
app.get('/api/comissoes/lookup', auth, async (req, res) => {
  try {
    const { fornecedor_id, tipo_produto } = req.query;
    const forn_pct   = await getComissaoFornPct(req.user.loja_id, fornecedor_id, tipo_produto || 'OTHER');
    const agente_pct = await getComissaoAgentePct(req.user.loja_id, req.user.cargo, 'agencia');
    res.json({ ok: true, data: { comissao_forn_pct: forn_pct, comissao_agente_pct: agente_pct } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/vendas/:id/comissoes
app.get('/api/vendas/:id/comissoes', auth, async (req, res) => {
  try {
    const [[venda]] = await pool.query('SELECT id FROM vendas WHERE id=? AND loja_id=?', [req.params.id, req.user.loja_id]);
    if (!venda) return res.status(404).json({ ok: false, error: 'Venda nao encontrada' });
    const [rows] = await pool.query(
      `SELECT vc.*, u.nome AS agente_nome, vi.descricao AS item_descricao, vi.tipo_produto
         FROM venda_comissoes vc
         LEFT JOIN usuarios u ON vc.agente_id = u.id
         LEFT JOIN venda_itens vi ON vc.venda_item_id = vi.id
         WHERE vc.venda_id = ? AND vc.loja_id = ?
         ORDER BY vc.nivel, vc.id`,
      [req.params.id, req.user.loja_id]
    );
    const totalFornAgencia   = rows.filter(r => r.nivel === 'forn_agencia').reduce((a, r) => a + +r.valor, 0);
    const totalAgenciaAgente = rows.filter(r => r.nivel === 'agencia_agente').reduce((a, r) => a + +r.valor, 0);
    res.json({ ok: true, data: rows, totais: { forn_agencia: +totalFornAgencia.toFixed(4), agencia_agente: +totalAgenciaAgente.toFixed(4) } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/vendas/:id/comissoes/calcular
app.post('/api/vendas/:id/comissoes/calcular', auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[v]] = await conn.query(
      `SELECT v.*, u.cargo FROM vendas v LEFT JOIN usuarios u ON v.agente_id = u.id WHERE v.id = ? AND v.loja_id = ?`,
      [req.params.id, req.user.loja_id]
    );
    if (!v) return conn.rollback(), conn.release(), res.status(404).json({ ok: false, error: 'Venda nao encontrada' });
    if (!v.agente_id) return conn.rollback(), conn.release(), res.status(400).json({ ok: false, error: 'Venda sem agente' });
    const mes = (v.data_fechamento || new Date().toISOString()).slice(0, 7);
    await calcularComissoesVenda(conn, +req.params.id, req.user.loja_id, v.agente_id, v.cargo, v.origem_lead, mes);
    await audit('vendas', req.params.id, 'comissoes_calculadas', null, null, mes, req.user.id, req.user.loja_id);
    await conn.commit();
    broadcast('comissoes_calculadas', { venda_id: +req.params.id, loja_id: req.user.loja_id });
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ ok: false, error: err.message });
  } finally { conn.release(); }
});

// PATCH /api/vendas/:id/comissoes/:comId/status
app.patch('/api/vendas/:id/comissoes/:comId/status', auth, gestorOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const VALIDOS = ['pendente','aprovado','pago','estornado'];
    if (!VALIDOS.includes(status)) return res.status(400).json({ ok: false, error: 'Status invalido' });
    await pool.query(
      `UPDATE venda_comissoes SET status=? WHERE id=? AND venda_id=? AND loja_id=?`,
      [status, req.params.comId, req.params.id, req.user.loja_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/comissoes/agente — relatorio consolidado
app.get('/api/comissoes/agente', auth, async (req, res) => {
  try {
    const { mes, status, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE vc.loja_id = ? AND vc.nivel = ?';
    const params = [req.user.loja_id, 'agencia_agente'];
    if (!['diretor','gerente'].includes(req.user.cargo)) {
      where += ' AND vc.agente_id = ?'; params.push(req.user.id);
    }
    if (mes)    { where += ' AND vc.mes_referencia = ?'; params.push(mes); }
    if (status) { where += ' AND vc.status = ?';         params.push(status); }

    const [rows] = await pool.query(
      `SELECT vc.*, v.codigo AS venda_codigo, u.nome AS agente_nome,
              vi.descricao AS item_descricao, vi.tipo_produto
         FROM venda_comissoes vc
         JOIN vendas v ON vc.venda_id = v.id
         LEFT JOIN usuarios u ON vc.agente_id = u.id
         LEFT JOIN venda_itens vi ON vc.venda_item_id = vi.id
         ${where}
         ORDER BY vc.mes_referencia DESC, vc.criado_em DESC
         LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM venda_comissoes vc ${where}`, params);
    const [[{ total_valor }]] = await pool.query(
      `SELECT COALESCE(SUM(vc.valor),0) AS total_valor FROM venda_comissoes vc ${where} AND vc.status != 'estornado'`, params
    );
    res.json({ ok: true, data: rows, total, total_valor: +total_valor });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});


// ── Financeiro Títulos (Fase 3 Complemento) ───────────────────

// GET /api/financeiro/titulos — lista pagamentos com join a vendas/clientes/parcelas
app.get('/api/financeiro/titulos', auth, async (req, res) => {
  try {
    const { tipo, status, q, mes, page = 1, limit = 20 } = req.query;
    const offset = (+page - 1) * +limit;
    const params = [req.user.loja_id];
    let where = 'WHERE p.loja_id = ?';
    if (tipo)   { where += ' AND p.tipo = ?';   params.push(tipo); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    if (mes)    { where += " AND DATE_FORMAT(p.criado_em,'%Y-%m') = ?"; params.push(mes); }
    if (q)      {
      where += ' AND (v.codigo LIKE ? OR COALESCE(cli.nome,cli.razao_social) LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    const [rows] = await pool.query(
      `SELECT p.*,
              v.codigo                                AS venda_codigo,
              v.status                                AS venda_status,
              COALESCE(cli.nome, cli.razao_social)    AS cliente_nome,
              COUNT(pp.id)                            AS total_parcelas,
              COALESCE(SUM(pp.pago), 0)               AS parcelas_pagas,
              COALESCE(SUM(pp.valor + COALESCE(pp.multa_encargo,0)), 0) AS valor_total_parcelas,
              COALESCE(SUM(CASE WHEN pp.pago=0 AND pp.data_vencimento < CURDATE()
                                THEN pp.valor + COALESCE(pp.multa_encargo,0)
                                ELSE 0 END), 0)       AS valor_atrasado,
              MIN(CASE WHEN pp.pago=0 THEN pp.data_vencimento END) AS prox_vencimento
         FROM pagamentos p
         JOIN vendas v ON p.venda_id = v.id
         LEFT JOIN clientes cli ON v.cliente_id = cli.id
         LEFT JOIN pagamento_parcelas pp ON pp.pagamento_id = p.id
         ${where}
         GROUP BY p.id
         ORDER BY p.criado_em DESC
         LIMIT ? OFFSET ?`,
      [...params, +limit, +offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(DISTINCT p.id) AS total
         FROM pagamentos p
         JOIN vendas v ON p.venda_id = v.id
         LEFT JOIN clientes cli ON v.cliente_id = cli.id
         ${where}`,
      params
    );

    // KPIs globais (sem filtro de busca)
    const [[kpis]] = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN p.tipo='cliente_agencia' AND p.status NOT IN ('cancelado')
                           THEN p.valor ELSE 0 END), 0)  AS total_a_receber,
         COALESCE(SUM(CASE WHEN p.tipo='cliente_agencia' AND p.status='pago'
                           THEN p.valor ELSE 0 END), 0)  AS total_recebido,
         COALESCE(SUM(CASE WHEN p.tipo='fornecedor_agencia' AND p.status NOT IN ('cancelado')
                           THEN p.valor ELSE 0 END), 0)  AS total_a_pagar,
         COALESCE(SUM(CASE WHEN p.tipo='fornecedor_agencia' AND p.status='pago'
                           THEN p.valor ELSE 0 END), 0)  AS total_pago_forn,
         COALESCE((
           SELECT SUM(pp2.valor + COALESCE(pp2.multa_encargo,0))
             FROM pagamento_parcelas pp2
             JOIN pagamentos p2 ON pp2.pagamento_id = p2.id
            WHERE p2.loja_id = ? AND pp2.pago = 0 AND pp2.data_vencimento < CURDATE()
         ), 0) AS total_atrasado
         FROM pagamentos p WHERE p.loja_id = ?`,
      [req.user.loja_id, req.user.loja_id]
    );

    res.json({ ok: true, data: rows, total, kpis });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// GET /api/financeiro/titulos/:id/parcelas — lista parcelas de um pagamento
app.get('/api/financeiro/titulos/:id/parcelas', auth, async (req, res) => {
  try {
    const [[p]] = await pool.query(
      'SELECT id FROM pagamentos WHERE id=? AND loja_id=?',
      [req.params.id, req.user.loja_id]
    );
    if (!p) return res.status(404).json({ ok: false, error: 'Pagamento nao encontrado' });
    const [rows] = await pool.query(
      'SELECT * FROM pagamento_parcelas WHERE pagamento_id=? ORDER BY numero',
      [req.params.id]
    );
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});


// ── Sprint 4: Lembretes & E-mail ──────────────────────────────

const nodemailer = require('nodemailer');

// Configuração SMTP via variáveis de ambiente
const smtpConfig = process.env.SMTP_HOST ? {
  host:   process.env.SMTP_HOST,
  port:   +process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
} : null;

const transporter = smtpConfig ? nodemailer.createTransport(smtpConfig) : null;


// WhatsApp via Evolution API (self-hosted)
async function enviarWhatsAppLembrete(dados) {
  const { telefone, mensagem, venda_codigo } = dados;
  const evolutionUrl  = process.env.EVOLUTION_API_URL;
  const evolutionKey  = process.env.EVOLUTION_API_KEY;
  const evolutionInst = process.env.EVOLUTION_INSTANCE || 'travelos';
  if (!evolutionUrl) {
    console.log(`[WHATSAPP-MOCK] Para: ${telefone} | Venda: ${venda_codigo}`);
    return { ok: true, mock: true };
  }
  const numero = (telefone || '').replace(/\D/g, '');
  if (!numero) throw new Error('Telefone invalido');
  const resp = await fetch(`${evolutionUrl}/message/sendText/${evolutionInst}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': evolutionKey },
    body: JSON.stringify({
      number: numero.startsWith('55') ? numero : `55${numero}`,
      text: mensagem || `Lembrete de embarque — Venda ${venda_codigo}. Boa viagem! ✈️`,
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Evolution API ${resp.status}: ${txt.slice(0,200)}`);
  }
  return await resp.json();
}

// GET /api/lembretes/evolution/status — verifica conexão WhatsApp
app.get('/api/lembretes/evolution/status', auth, async (req, res) => {
  const evolutionUrl  = process.env.EVOLUTION_API_URL;
  const evolutionKey  = process.env.EVOLUTION_API_KEY;
  const evolutionInst = process.env.EVOLUTION_INSTANCE || 'travelos';
  if (!evolutionUrl) return res.json({ ok: true, configurado: false, status: 'nao_configurado' });
  try {
    const resp = await fetch(`${evolutionUrl}/instance/fetchInstances`, {
      headers: { 'apikey': evolutionKey }
    });
    const data = await resp.json();
    const inst = Array.isArray(data) ? data.find(i => i.name === evolutionInst || i.instance?.instanceName === evolutionInst) : null;
    const connectionState = inst?.instance?.state || inst?.connectionStatus || 'desconectado';
    res.json({ ok: true, configurado: true, status: connectionState, instance: evolutionInst });
  } catch (e) { res.json({ ok: false, configurado: true, status: 'erro', error: e.message }); }
});

// POST /api/lembretes/evolution/qrcode — gera QR para conectar WhatsApp
app.post('/api/lembretes/evolution/connect', auth, gestorOnly, async (req, res) => {
  const evolutionUrl  = process.env.EVOLUTION_API_URL;
  const evolutionKey  = process.env.EVOLUTION_API_KEY;
  const evolutionInst = process.env.EVOLUTION_INSTANCE || 'travelos';
  if (!evolutionUrl) return res.status(400).json({ ok: false, error: 'Evolution API nao configurada' });
  try {
    // Tenta criar instância (retorna erro se já existe — tudo bem)
    await fetch(`${evolutionUrl}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': evolutionKey },
      body: JSON.stringify({ instanceName: evolutionInst, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    });
    // Busca QR code
    const resp = await fetch(`${evolutionUrl}/instance/connect/${evolutionInst}`, {
      headers: { 'apikey': evolutionKey }
    });
    const data = await resp.json();
    res.json({ ok: true, data });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

async function enviarEmailLembrete(dados) {
  const { destinatario_email, destinatario_nome, assunto, mensagem, venda_codigo, data_embarque } = dados;
  if (!transporter) {
    console.log(`[EMAIL-MOCK] Para: ${destinatario_email} | ${assunto}`);
    return { ok: true, mock: true };
  }
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <div style="background:#1e1b4b;color:white;padding:20px 24px;border-radius:12px 12px 0 0">
        <h2 style="margin:0;font-size:20px">✈️ Lembrete de Embarque</h2>
        <p style="margin:4px 0 0;opacity:.8;font-size:14px">TravelAgent OS</p>
      </div>
      <div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
        <p style="font-size:16px;font-weight:600;color:#1e293b">Olá, ${destinatario_nome}!</p>
        <p style="color:#475569;font-size:14px">
          Seu embarque da venda <strong>${venda_codigo}</strong> está previsto para
          <strong>${new Date(data_embarque).toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong>.
        </p>
        <div style="background:#0d9488;color:white;padding:16px 20px;border-radius:8px;margin:20px 0;font-size:15px;font-weight:700">
          ${mensagem || 'Lembre-se de confirmar seus documentos e chegar com antecedência!'}
        </div>
        <p style="color:#94a3b8;font-size:12px">
          Este é um lembrete automático da sua agência de viagens. Em caso de dúvidas, entre em contato.
        </p>
      </div>
    </div>`;
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      destinatario_email,
    subject: assunto || `Lembrete de Embarque — ${venda_codigo}`,
    html,
    text: mensagem || `Lembrete de embarque da venda ${venda_codigo} em ${data_embarque}.`,
  });
  return { ok: true };
}

// ── Cron: verifica embarques nas próximas 48h sem lembrete ────
async function checkAndDispararLembretes() {
  try {
    const [vendas] = await pool.query(`
      SELECT v.id, v.codigo, v.loja_id,
             COALESCE(cli.nome, cli.razao_social) AS cliente_nome,
             cli.email                             AS cliente_email,
             MIN(vi.data_inicio)                  AS data_embarque,
             u.id                                 AS agente_id,
             cli.telefone                          AS cliente_telefone
        FROM vendas v
        JOIN venda_itens vi ON vi.venda_id = v.id
        LEFT JOIN clientes cli ON v.cliente_id = cli.id
        LEFT JOIN usuarios u   ON v.agente_id = u.id
       WHERE v.status IN ('confirmada','concluida')
         AND vi.data_inicio IS NOT NULL
         AND vi.data_inicio BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 48 HOUR)
         AND NOT EXISTS (
           SELECT 1 FROM venda_lembretes vl
           WHERE vl.venda_id = v.id
             AND vl.tipo = 'checkin_48h'
             AND vl.status IN ('agendado','enviado')
         )
       GROUP BY v.id`);

    for (const v of vendas) {
      const assunto = `Lembrete de Embarque — ${v.codigo}`;
      const [ins] = await pool.query(
        `INSERT INTO venda_lembretes
           (loja_id, venda_id, tipo, canal, status, agendado_para,
            destinatario_email, destinatario_nome, assunto, disparado_por, criado_por)
         VALUES (?,?,?,?,?,NOW(),?,?,?,?,?)`,
        [v.loja_id, v.id, 'checkin_48h', 'email', 'agendado',
         v.cliente_email, v.cliente_nome, assunto, 'automatico', v.agente_id]
      );
      const lembreteId = ins.insertId;
      try {
        if (v.canal === 'whatsapp' && v.cliente_telefone) {
          await enviarWhatsAppLembrete({ telefone: v.cliente_telefone, mensagem: null, venda_codigo: v.codigo });
        } else {
          await enviarEmailLembrete({ ...v, assunto });
        }
        await pool.query(
          "UPDATE venda_lembretes SET status='enviado', enviado_em=NOW(), tentativas=tentativas+1 WHERE id=?",
          [lembreteId]
        );
        console.log(`[LEMBRETE] Enviado para venda ${v.codigo} — ${v.cliente_email || 'mock'}`);
      } catch (e) {
        await pool.query(
          "UPDATE venda_lembretes SET status='falhou', erro=?, tentativas=tentativas+1 WHERE id=?",
          [e.message, lembreteId]
        );
      }
    }
    if (vendas.length) console.log(`[CRON] ${vendas.length} lembrete(s) processados`);
  } catch (e) { console.error('[CRON] Erro no checkLembretes:', e.message); }
}

// Roda ao iniciar e a cada hora
checkAndDispararLembretes();
setInterval(checkAndDispararLembretes, 60 * 60 * 1000);

// GET /api/lembretes — lista todos os lembretes
app.get('/api/lembretes', auth, async (req, res) => {
  try {
    const { status, tipo, canal, page = 1, limit = 20 } = req.query;
    const offset = (+page - 1) * +limit;
    const params = [req.user.loja_id];
    let where = 'WHERE vl.loja_id = ?';
    if (status) { where += ' AND vl.status = ?'; params.push(status); }
    if (tipo)   { where += ' AND vl.tipo = ?';   params.push(tipo); }
    if (canal)  { where += ' AND vl.canal = ?';  params.push(canal); }
    const [rows] = await pool.query(
      `SELECT vl.*,
              v.codigo                             AS venda_codigo,
              v.status                             AS venda_status,
              COALESCE(cli.nome,cli.razao_social)  AS cliente_nome,
              MIN(vi.data_inicio)                  AS data_embarque
         FROM venda_lembretes vl
         JOIN vendas v ON vl.venda_id = v.id
         LEFT JOIN clientes cli ON v.cliente_id = cli.id
         LEFT JOIN venda_itens vi ON vi.venda_id = v.id
         ${where}
         GROUP BY vl.id
         ORDER BY vl.criado_em DESC
         LIMIT ? OFFSET ?`,
      [...params, +limit, offset]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(DISTINCT vl.id) AS total FROM venda_lembretes vl ${where}`, params
    );
    // KPIs
    const [[kpis]] = await pool.query(
      `SELECT
         SUM(status='agendado')  AS agendados,
         SUM(status='enviado')   AS enviados,
         SUM(status='falhou')    AS falhos,
         SUM(status='cancelado') AS cancelados,
         SUM(disparado_por='manual') AS manuais
         FROM venda_lembretes WHERE loja_id = ?`, [req.user.loja_id]
    );
    res.json({ ok: true, data: rows, total, kpis });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/lembretes — criar lembrete manual
app.post('/api/lembretes', auth, async (req, res) => {
  try {
    const { venda_id, canal = 'email', destinatario_email, destinatario_nome, assunto, mensagem, agendado_para } = req.body;
    if (!venda_id) return res.status(400).json({ ok: false, error: 'venda_id obrigatorio' });
    const [[v]] = await pool.query(
      `SELECT v.*, COALESCE(cli.nome,cli.razao_social) AS cliente_nome, cli.email AS cliente_email,
              MIN(vi.data_inicio) AS data_embarque
         FROM vendas v
         LEFT JOIN clientes cli ON v.cliente_id = cli.id
         LEFT JOIN venda_itens vi ON vi.venda_id = v.id
        WHERE v.id = ? AND v.loja_id = ? GROUP BY v.id`,
      [venda_id, req.user.loja_id]
    );
    if (!v) return res.status(404).json({ ok: false, error: 'Venda nao encontrada' });
    const email = destinatario_email || v.cliente_email;
    const nome  = destinatario_nome  || v.cliente_nome;
    const [ins] = await pool.query(
      `INSERT INTO venda_lembretes
         (loja_id, venda_id, tipo, canal, status, agendado_para,
          destinatario_email, destinatario_nome, assunto, mensagem, disparado_por, criado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.loja_id, venda_id, 'manual', canal,
       agendado_para ? 'agendado' : 'enviado',
       agendado_para || new Date(),
       email, nome, assunto || `Lembrete — ${v.codigo}`, mensagem, 'manual', req.user.id]
    );
    const lembreteId = ins.insertId;
    if (!agendado_para) {
      try {
        await enviarEmailLembrete({ ...v, assunto, mensagem, destinatario_email: email, destinatario_nome: nome });
        await pool.query("UPDATE venda_lembretes SET status='enviado',enviado_em=NOW(),tentativas=1 WHERE id=?", [lembreteId]);
      } catch (e) {
        await pool.query("UPDATE venda_lembretes SET status='falhou',erro=?,tentativas=1 WHERE id=?", [e.message, lembreteId]);
      }
    }
    broadcast('lembrete_criado', { venda_id, loja_id: req.user.loja_id });
    res.status(201).json({ ok: true, id: lembreteId });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// POST /api/lembretes/:id/disparar — reenviar / disparar manualmente
app.post('/api/lembretes/:id/disparar', auth, async (req, res) => {
  try {
    const [[vl]] = await pool.query(
      `SELECT vl.*, v.codigo, COALESCE(cli.nome,cli.razao_social) AS cliente_nome,
              MIN(vi.data_inicio) AS data_embarque
         FROM venda_lembretes vl
         JOIN vendas v ON vl.venda_id = v.id
         LEFT JOIN clientes cli ON v.cliente_id = cli.id
         LEFT JOIN venda_itens vi ON vi.venda_id = v.id
        WHERE vl.id = ? AND vl.loja_id = ? GROUP BY vl.id`,
      [req.params.id, req.user.loja_id]
    );
    if (!vl) return res.status(404).json({ ok: false, error: 'Lembrete nao encontrado' });
    try {
      await enviarEmailLembrete({
        destinatario_email: vl.destinatario_email,
        destinatario_nome:  vl.destinatario_nome,
        assunto:            vl.assunto,
        mensagem:           vl.mensagem,
        venda_codigo:       vl.codigo,
        data_embarque:      vl.data_embarque,
      });
      await pool.query(
        "UPDATE venda_lembretes SET status='enviado',enviado_em=NOW(),disparado_por='manual',tentativas=tentativas+1 WHERE id=?",
        [req.params.id]
      );
      res.json({ ok: true });
    } catch (e) {
      await pool.query(
        "UPDATE venda_lembretes SET status='falhou',erro=?,tentativas=tentativas+1 WHERE id=?",
        [e.message, req.params.id]
      );
      res.status(500).json({ ok: false, error: e.message });
    }
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// PATCH /api/lembretes/:id/cancelar
app.patch('/api/lembretes/:id/cancelar', auth, async (req, res) => {
  try {
    await pool.query(
      "UPDATE venda_lembretes SET status='cancelado' WHERE id=? AND loja_id=? AND status='agendado'",
      [req.params.id, req.user.loja_id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.listen(PORT, () => console.log(`TravelAgent OS API v4.0-sprint4 — porta ${PORT}`));
