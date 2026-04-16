-- ─────────────────────────────────────────────────────────────
-- Sprint 3 – Fase 2: Pagamentos
-- Tabelas: pagamentos, pagamento_parcelas
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pagamentos (
  id              INT            NOT NULL AUTO_INCREMENT,
  loja_id         INT            NOT NULL,
  venda_id        INT            NOT NULL,
  tipo            ENUM('cliente_agencia','cliente_fornecedor','fornecedor_agencia') NOT NULL,
  venda_item_id   INT            NULL COMMENT 'Produto vinculado (NULL = venda inteira)',
  pagante_id      INT            NULL COMMENT 'cliente_id do pagante',
  moeda           VARCHAR(3)     NOT NULL DEFAULT 'BRL',
  valor           DECIMAL(15,4)  NOT NULL DEFAULT 0,
  forma_pagamento VARCHAR(50)    NOT NULL DEFAULT 'Pix',
  num_parcelas    INT            NOT NULL DEFAULT 1,
  observacoes     TEXT           NULL,
  status          ENUM('pendente','parcial','pago','cancelado') NOT NULL DEFAULT 'pendente',
  criado_por      INT            NOT NULL,
  criado_em       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pag_venda (venda_id),
  INDEX idx_pag_loja  (loja_id),
  INDEX idx_pag_tipo  (tipo),
  CONSTRAINT fk_pag_venda FOREIGN KEY (venda_id)  REFERENCES vendas(id),
  CONSTRAINT fk_pag_loja  FOREIGN KEY (loja_id)   REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pagamento_parcelas (
  id              INT            NOT NULL AUTO_INCREMENT,
  pagamento_id    INT            NOT NULL,
  loja_id         INT            NOT NULL,
  numero          INT            NOT NULL,
  valor           DECIMAL(15,4)  NOT NULL DEFAULT 0,
  multa_encargo   DECIMAL(15,4)  NOT NULL DEFAULT 0,
  data_vencimento DATE           NOT NULL,
  data_pagamento  DATE           NULL,
  pago            TINYINT(1)     NOT NULL DEFAULT 0,
  conta           VARCHAR(100)   NULL,
  criado_em       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_parc_pag (pagamento_id),
  CONSTRAINT fk_parc_pag  FOREIGN KEY (pagamento_id) REFERENCES pagamentos(id) ON DELETE CASCADE,
  CONSTRAINT fk_parc_loja FOREIGN KEY (loja_id)      REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
