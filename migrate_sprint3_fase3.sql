-- ─────────────────────────────────────────────────────────────
-- Sprint 3 – Fase 3: Comissões 2 níveis
-- Tabelas: fornecedor_comissoes_config, agente_comissoes_config,
--          venda_comissoes
-- ─────────────────────────────────────────────────────────────

-- Nível 1: % padrão de comissão por Fornecedor + Tipo de Produto
-- (Fornecedor → Agência)
CREATE TABLE IF NOT EXISTS fornecedor_comissoes_config (
  id           INT            NOT NULL AUTO_INCREMENT,
  loja_id      INT            NOT NULL,
  fornecedor_id INT           NULL     COMMENT 'NULL = regra global da loja',
  tipo_produto VARCHAR(20)    NOT NULL DEFAULT 'OTHER',
  percentual   DECIMAL(6,2)   NOT NULL DEFAULT 0,
  ativo        TINYINT(1)     NOT NULL DEFAULT 1,
  criado_em    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_fcc_forn_tipo (loja_id, fornecedor_id, tipo_produto),
  INDEX idx_fcc_loja (loja_id),
  CONSTRAINT fk_fcc_loja FOREIGN KEY (loja_id)       REFERENCES lojas(id),
  CONSTRAINT fk_fcc_forn FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Nível 2: % de repasse ao Agente (por cargo + origem_lead)
-- (Agência → Agente)
CREATE TABLE IF NOT EXISTS agente_comissoes_config (
  id           INT            NOT NULL AUTO_INCREMENT,
  loja_id      INT            NOT NULL,
  cargo        VARCHAR(30)    NOT NULL COMMENT 'agente, gerente, diretor...',
  origem_lead  ENUM('agencia','agente') NOT NULL,
  percentual   DECIMAL(6,2)   NOT NULL DEFAULT 0,
  ativo        TINYINT(1)     NOT NULL DEFAULT 1,
  criado_em    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_acc_cargo_origem (loja_id, cargo, origem_lead),
  INDEX idx_acc_loja (loja_id),
  CONSTRAINT fk_acc_loja FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registros reais de comissão por venda (substituem/coexistem com tabela legada comissoes)
CREATE TABLE IF NOT EXISTS venda_comissoes (
  id            INT            NOT NULL AUTO_INCREMENT,
  loja_id       INT            NOT NULL,
  venda_id      INT            NOT NULL,
  venda_item_id INT            NULL     COMMENT 'NULL = comissão da venda toda',
  agente_id     INT            NOT NULL,
  nivel         ENUM('forn_agencia','agencia_agente') NOT NULL,
  base_calculo  DECIMAL(15,4)  NOT NULL DEFAULT 0 COMMENT 'valor sobre o qual o % incide',
  percentual    DECIMAL(6,2)   NOT NULL DEFAULT 0,
  valor         DECIMAL(15,4)  NOT NULL DEFAULT 0,
  mes_referencia CHAR(7)       NOT NULL COMMENT 'YYYY-MM',
  status        ENUM('pendente','aprovado','pago','estornado') NOT NULL DEFAULT 'pendente',
  observacoes   TEXT           NULL,
  criado_em     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_vc_venda  (venda_id),
  INDEX idx_vc_agente (agente_id),
  INDEX idx_vc_mes    (mes_referencia),
  INDEX idx_vc_loja   (loja_id),
  CONSTRAINT fk_vc_venda FOREIGN KEY (venda_id) REFERENCES vendas(id),
  CONSTRAINT fk_vc_loja  FOREIGN KEY (loja_id)  REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Dados iniciais: regras de comissão agente para loja 1 ─────
INSERT IGNORE INTO agente_comissoes_config
  (loja_id, cargo, origem_lead, percentual)
VALUES
  (1, 'agente',  'agente',  50.00),
  (1, 'agente',  'agencia', 20.00),
  (1, 'gerente', 'agente',  50.00),
  (1, 'gerente', 'agencia', 25.00),
  (1, 'diretor', 'agente',  50.00),
  (1, 'diretor', 'agencia', 30.00);
