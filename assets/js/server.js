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
    next();
  } catch {
    res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

// Admin/Financeiro only
function adminOrFinanceiro(req, res, next) {
  if (!['admin', 'financeiro'].includes(req.user.role))
    return res.status(403).json({ ok: false, error: 'Acesso negado' });
  next();
}

// ── Audit helper ─────────────────────────────────────────────
async function audit(tabela, registro_id, acao, campo, valor_antes, valor_depois, usuario_id) {
  await pool.query(
    'INSERT INTO auditoria (tabela,registro_id,acao,campo,valor_antes,valor_depois,usuario_id) VALUES (?,?,?,?,?,?,?)',
    [tabela, registro_id, acao, campo, valor_antes?.toString(), valor_depois?.toString(), usuario_id]
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
  res.json({ ok: true, version: '2.0.0', ts: new Date().toISOString() });
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
      { id: user.id, email: user.email, nome: user.nome, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      ok: true, token,
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Erro interno' });
  }
});

// ── Usuários (listagem para selects) ─────────────────────────
app.get('/api/usuarios', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, nome, email, role FROM usuarios WHERE ativo = 1 ORDER BY nome'
    );
    res.json({ ok: true, data: rows });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Clientes ──────────────────────────────────────────────────
app.get('/api/clientes', auth, async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = '', params = [];
    if (q) {
      where = 'WHERE nome LIKE ? OR email LIKE ? OR telefone LIKE ? OR cpf LIKE ?';
      params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    }
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
       LEFT JOIN usuarios u ON c.agente_id = u.id WHERE c.id = ?`, [req.params.id]
    );
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado' });

    const [reservas] = await pool.query(
      `SELECT r.*, f.nome as fornecedor_nome FROM reservas r
       LEFT JOIN fornecedores f ON r.fornecedor_id = f.id
       WHERE r.cliente_id = ? ORDER BY r.criado_em DESC`, [req.params.id]
    );

    res.json({ ok: true, data: { ...cliente, reservas } });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/api/clientes', auth, async (req, res) => {
  try {
    const { nome, email, telefone, whatsapp, cpf, passaporte, data_nascimento, endereco, observacoes, agente_id } = req.body;
    if (!nome) return res.status(400).json({ ok: false, error: 'Nome obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO clientes (nome,email,telefone,whatsapp,cpf,passaporte,data_nascimento,endereco,observacoes,agente_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [nome, email, telefone, whatsapp, cpf, passaporte, data_nascimento, endereco, observacoes, agente_id || req.user.id]
    );
    await audit('clientes', r.insertId, 'criacao', null, null, nome, req.user.id);
    broadcast('cliente_criado', { id: r.insertId, nome });
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.put('/api/clientes/:id', auth, async (req, res) => {
  try {
    const { nome, email, telefone, whatsapp, cpf, passaporte, data_nascimento, endereco, observacoes, agente_id } = req.body;
    await pool.query(
      `UPDATE clientes SET nome=?,email=?,telefone=?,whatsapp=?,cpf=?,passaporte=?,
       data_nascimento=?,endereco=?,observacoes=?,agente_id=? WHERE id=?`,
      [nome, email, telefone, whatsapp, cpf, passaporte, data_nascimento, endereco, observacoes, agente_id, req.params.id]
    );
    await audit('clientes', req.params.id, 'edicao', 'geral', null, nome, req.user.id);
    broadcast('cliente_atualizado', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete('/api/clientes/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM clientes WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Fornecedores ──────────────────────────────────────────────
app.get('/api/fornecedores', auth, async (req, res) => {
  try {
    const { q, tipo, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE f.ativo = 1', params = [];
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
      `INSERT INTO fornecedores (nome,razao_social,cnpj,tipo,contato_nome,contato_email,contato_telefone,condicoes_pgto,comissao_padrao,observacoes)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [nome, razao_social, cnpj, tipo || 'operadora', contato_nome, contato_email, contato_telefone, condicoes_pgto, comissao_padrao || 0, observacoes]
    );
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
    let where = 'WHERE 1=1', params = [];

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

app.post('/api/reservas', auth, async (req, res) => {
  try {
    const {
      tipo_produto, cliente_id, fornecedor_id, agente_id,
      origem_lead, destino, data_saida, data_embarque, data_retorno,
      custo, markup, markup_tipo, valor_total,
      forma_pgto, vencimento, observacoes
    } = req.body;

    if (!destino || !data_saida)
      return res.status(400).json({ ok: false, error: 'Destino e data de saída são obrigatórios' });

    // Calcula valor_total se não fornecido
    let vt = valor_total;
    if (!vt && custo && markup) {
      vt = markup_tipo === 'percentual'
        ? +(custo * (1 + markup / 100)).toFixed(2)
        : +(+custo + +markup).toFixed(2);
    }

    const codigo = 'RES' + Date.now().toString().slice(-8);
    const agent  = agente_id || req.user.id;
    const mes    = new Date().toISOString().slice(0, 7); // YYYY-MM

    const [r] = await pool.query(
      `INSERT INTO reservas
       (codigo,tipo_produto,cliente_id,fornecedor_id,agente_id,origem_lead,
        destino,data_saida,data_embarque,data_retorno,valor_total,custo,markup,markup_tipo,
        forma_pgto,vencimento,observacoes,criado_por)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [codigo, tipo_produto||'pacote', cliente_id, fornecedor_id, agent, origem_lead||'agencia',
       destino, data_saida, data_embarque||null, data_retorno||null,
       vt||0, custo||0, markup||0, markup_tipo||'percentual',
       forma_pgto||null, vencimento||null, observacoes, req.user.id]
    );

    await audit('reservas', r.insertId, 'criacao', null, null, codigo, req.user.id);
    broadcast('reserva_criada', { id: r.insertId, codigo, destino });
    res.status(201).json({ ok: true, id: r.insertId, codigo });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
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

app.listen(PORT, () => console.log(`TravelOS API v2.0 na porta ${PORT}`));
