-- ── Sprint 2 Migration ──────────────────────────────────────

-- 2. Alter reservas: add missing fields
ALTER TABLE reservas
  ADD COLUMN tipo_produto      ENUM('pacote','aereo','hotel','cruzeiro','seguro','carro','transfer','outro') DEFAULT 'pacote' AFTER codigo,
  ADD COLUMN fornecedor_id     INT AFTER cliente_id,
  ADD COLUMN agente_id         INT AFTER fornecedor_id,
  ADD COLUMN origem_lead       ENUM('agencia','agente') DEFAULT 'agencia' AFTER agente_id,
  ADD COLUMN data_embarque     DATETIME AFTER data_saida,
  ADD COLUMN custo             DECIMAL(10,2) DEFAULT 0.00 AFTER valor_total,
  ADD COLUMN markup            DECIMAL(10,2) DEFAULT 0.00 AFTER custo,
  ADD COLUMN markup_tipo       ENUM('percentual','fixo') DEFAULT 'percentual' AFTER markup,
  ADD COLUMN forma_pgto        ENUM('cartao','pix','boleto','parcelado','outro') AFTER markup_tipo,
  ADD COLUMN valor_recebido    DECIMAL(10,2) DEFAULT 0.00 AFTER forma_pgto,
  ADD COLUMN status_pgto       ENUM('em_aberto','parcial','pago','inadimplente') DEFAULT 'em_aberto' AFTER valor_recebido,
  ADD COLUMN vencimento        DATE AFTER status_pgto,
  ADD COLUMN lembrete_enviado  TINYINT(1) DEFAULT 0 AFTER vencimento;

-- 3. Comissoes
CREATE TABLE IF NOT EXISTS comissoes (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  reserva_id     INT NOT NULL,
  agente_id      INT NOT NULL,
  origem_lead    ENUM('agencia','agente') NOT NULL,
  percentual     DECIMAL(5,2) NOT NULL,
  valor_venda    DECIMAL(10,2) NOT NULL,
  valor_comissao DECIMAL(10,2) NOT NULL,
  mes_referencia CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  status         ENUM('pendente','aprovado','pago','estornado') DEFAULT 'pendente',
  criado_em      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reserva_id) REFERENCES reservas(id),
  FOREIGN KEY (agente_id)  REFERENCES usuarios(id)
);

-- 4. Lembretes log
CREATE TABLE IF NOT EXISTS lembretes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  reserva_id INT NOT NULL,
  canal      ENUM('email','whatsapp','sistema') DEFAULT 'email',
  enviado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status     ENUM('enviado','falhou') DEFAULT 'enviado',
  FOREIGN KEY (reserva_id) REFERENCES reservas(id)
);

-- 5. Audit log
CREATE TABLE IF NOT EXISTS auditoria (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tabela      VARCHAR(50) NOT NULL,
  registro_id INT NOT NULL,
  acao        ENUM('criacao','edicao','cancelamento','status') NOT NULL,
  campo       VARCHAR(100),
  valor_antes TEXT,
  valor_depois TEXT,
  usuario_id  INT,
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. Clientes: add fields
ALTER TABLE clientes
  ADD COLUMN passaporte VARCHAR(30) AFTER cpf,
  ADD COLUMN whatsapp   VARCHAR(30) AFTER telefone,
  ADD COLUMN agente_id  INT AFTER observacoes;
