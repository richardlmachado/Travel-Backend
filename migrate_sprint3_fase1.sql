-- ═══════════════════════════════════════════════════════════════
-- TravelAgent OS — Sprint 3 Fase 1: Schema de Vendas
-- Aplica em: /docker/travelos/ via docker exec
-- Pré-requisito: Fase 0 aplicada
-- Tipos: INT (signed) — compatível com lojas, usuarios, fornecedores
-- ═══════════════════════════════════════════════════════════════

-- ── vendas ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendas (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  loja_id          INT          NOT NULL,
  codigo           VARCHAR(20)  NOT NULL,          -- YYYYMMDD-0001
  status           ENUM('cotacao','confirmada','cancelada','concluida') NOT NULL DEFAULT 'cotacao',
  cliente_id       INT,                            -- pagante (clientes.id)
  agente_id        INT          NOT NULL,           -- auto do JWT
  origem_lead      ENUM('agencia','agente') NOT NULL DEFAULT 'agencia',
  moeda_base       VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  cotacao_validade DATETIME,
  data_abertura    DATE         NOT NULL DEFAULT (CURDATE()),
  data_fechamento  DATE,
  total_custo      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_venda      DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  observacoes      TEXT,
  condicoes_gerais TEXT,
  regras           TEXT,
  criado_por       INT          NOT NULL,
  criado_em        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_loja_codigo (loja_id, codigo),
  FOREIGN KEY (loja_id)   REFERENCES lojas(id),
  FOREIGN KEY (agente_id) REFERENCES usuarios(id),
  INDEX idx_vendas_loja_status (loja_id, status),
  INDEX idx_vendas_cliente (cliente_id),
  INDEX idx_vendas_data (data_abertura)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── venda_itens ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venda_itens (
  id                     INT AUTO_INCREMENT PRIMARY KEY,
  venda_id               INT          NOT NULL,
  ordem                  TINYINT      NOT NULL DEFAULT 1,
  tipo_produto           ENUM('AIRFARE','HOSTING','INSURANCE','PACKAGE','CAR','BUS','TRAIN','CRUISE','TOUR','TICKET','EDUCATIONAL','OTHER') NOT NULL DEFAULT 'OTHER',
  fornecedor_id          INT,
  descricao              VARCHAR(500),
  localizador            VARCHAR(100),
  data_inicio            DATE,
  data_fim               DATE,
  moeda_fornecedor       VARCHAR(3)    NOT NULL DEFAULT 'BRL',
  taxa_cambio            DECIMAL(10,4) NOT NULL DEFAULT 1.0000,
  tarifa                 DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  taxas                  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  outros_custos          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total_custo_brl        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  markup_tipo            ENUM('percentual','fixo') NOT NULL DEFAULT 'percentual',
  markup_valor           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_venda_brl        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  comissao_forn_pct      DECIMAL(6,2)  NOT NULL DEFAULT 0.00,
  comissao_forn_valor    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  comissao_agente_pct    DECIMAL(6,2)  NOT NULL DEFAULT 0.00,
  comissao_agente_valor  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  detalhes_json          JSON,
  observacoes            TEXT,
  criado_em              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venda_id)     REFERENCES vendas(id)      ON DELETE CASCADE,
  FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id) ON DELETE SET NULL,
  INDEX idx_venda_itens_venda (venda_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── venda_pax ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS venda_pax (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  venda_id              INT NOT NULL,
  nome                  VARCHAR(100) NOT NULL,
  sobrenome             VARCHAR(100),
  genero                ENUM('M','F','O'),
  nascimento            DATE,
  tipo_doc              ENUM('cpf','passaporte','rg') DEFAULT 'cpf',
  num_doc               VARCHAR(30),
  passaporte_numero     VARCHAR(30),
  passaporte_validade   DATE,
  passaporte_emissor    VARCHAR(60),
  nacionalidade         VARCHAR(60),
  email                 VARCHAR(200),
  telefone              VARCHAR(30),
  tipo_pax              ENUM('ADT','CHD','INF','INS','UNN') DEFAULT 'ADT',
  observacoes           TEXT,
  criado_em             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (venda_id) REFERENCES vendas(id) ON DELETE CASCADE,
  INDEX idx_pax_venda (venda_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── pax_itens  (muitos-para-muitos pax × item) ───────────────
CREATE TABLE IF NOT EXISTS pax_itens (
  item_id       INT NOT NULL,
  pax_id        INT NOT NULL,
  detalhes_json JSON,
  PRIMARY KEY (item_id, pax_id),
  FOREIGN KEY (item_id) REFERENCES venda_itens(id) ON DELETE CASCADE,
  FOREIGN KEY (pax_id)  REFERENCES venda_pax(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Sequência de numeração (por loja × dia) ──────────────────
CREATE TABLE IF NOT EXISTS vendas_seq (
  loja_id  INT  NOT NULL,
  dia      DATE NOT NULL,
  seq      INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (loja_id, dia),
  FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SELECT 'Fase 1 aplicada com sucesso.' AS status;
