-- ╔════════════════════════════════════════════════════════════════╗
-- ║  SPRINT 3 — FASE 0: FUNDAÇÃO                                   ║
-- ║  lojas · moedas · PF/PJ em clientes · multi-loja · cargos      ║
-- ╚════════════════════════════════════════════════════════════════╝

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ── 1. LOJAS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  codigo      VARCHAR(10) NOT NULL UNIQUE COMMENT 'Ex: LOJA01, MATRIZ',
  nome        VARCHAR(150) NOT NULL,
  razao_social VARCHAR(200),
  cnpj        VARCHAR(20),
  matriz_id   INT NULL COMMENT 'NULL = é matriz',
  endereco    TEXT,
  telefone    VARCHAR(30),
  email       VARCHAR(150),
  ativo       TINYINT(1) DEFAULT 1,
  criado_em   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (matriz_id) REFERENCES lojas(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: 1 loja matriz (para migrar dados existentes)
INSERT IGNORE INTO lojas (id, codigo, nome, ativo)
VALUES (1, 'MATRIZ', 'Matriz TravelAgent', 1);

-- ── 2. MOEDAS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS moedas (
  codigo    CHAR(3) PRIMARY KEY COMMENT 'ISO 4217: BRL, USD, EUR',
  nome      VARCHAR(60) NOT NULL,
  simbolo   VARCHAR(5),
  padrao    TINYINT(1) DEFAULT 0 COMMENT '1 = moeda base do sistema',
  ativo     TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO moedas (codigo, nome, simbolo, padrao) VALUES
  ('BRL', 'Real Brasileiro',  'R$', 1),
  ('USD', 'Dólar Americano',  'US$', 0),
  ('EUR', 'Euro',              '€',  0),
  ('GBP', 'Libra Esterlina',   '£',  0),
  ('ARS', 'Peso Argentino',    '$',  0),
  ('CLP', 'Peso Chileno',      '$',  0),
  ('UYU', 'Peso Uruguaio',     '$',  0);

-- ── 3. HISTÓRICO DE CÂMBIO ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cambio_historico (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  moeda_origem   CHAR(3) NOT NULL,
  moeda_destino  CHAR(3) NOT NULL,
  taxa           DECIMAL(14,6) NOT NULL,
  registrado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  registrado_por INT,
  FOREIGN KEY (moeda_origem)   REFERENCES moedas(codigo),
  FOREIGN KEY (moeda_destino)  REFERENCES moedas(codigo),
  FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
  INDEX idx_cambio_par (moeda_origem, moeda_destino, registrado_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. USUARIOS: loja_id + cargo ─────────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN loja_id INT NOT NULL DEFAULT 1 AFTER role,
  ADD COLUMN cargo   VARCHAR(50) DEFAULT 'consultor'
    COMMENT 'consultor, gerente, diretor, financeiro, operacional' AFTER loja_id,
  ADD CONSTRAINT fk_usuarios_loja FOREIGN KEY (loja_id) REFERENCES lojas(id);

-- ── 5. CLIENTES: loja_id + PF/PJ (pagante unificado) ─────────────
ALTER TABLE clientes
  ADD COLUMN loja_id       INT NOT NULL DEFAULT 1 AFTER id,
  ADD COLUMN tipo_pessoa   ENUM('PF','PJ') DEFAULT 'PF' AFTER loja_id,
  ADD COLUMN razao_social  VARCHAR(200) AFTER nome,
  ADD COLUMN cnpj          VARCHAR(20)  AFTER cpf,
  ADD COLUMN eh_pagante    TINYINT(1) DEFAULT 1
    COMMENT '1 = pode ser pagante em vendas',
  ADD COLUMN eh_passageiro TINYINT(1) DEFAULT 1
    COMMENT '1 = pode viajar',
  ADD CONSTRAINT fk_clientes_loja FOREIGN KEY (loja_id) REFERENCES lojas(id),
  ADD INDEX idx_clientes_busca (loja_id, nome, cpf, cnpj);

-- ── 6. FORNECEDORES: loja_id ──────────────────────────────────────
ALTER TABLE fornecedores
  ADD COLUMN loja_id INT NOT NULL DEFAULT 1 AFTER id,
  ADD CONSTRAINT fk_fornecedores_loja FOREIGN KEY (loja_id) REFERENCES lojas(id);

-- ── 7. RESERVAS LEGADO: marcar como arquivado ─────────────────────
-- Não vamos migrar, mas vamos travar novas inserções neste modelo.
-- A tabela continua existindo só para histórico.
ALTER TABLE reservas
  ADD COLUMN loja_id  INT DEFAULT 1 AFTER id,
  ADD COLUMN legado   TINYINT(1) DEFAULT 1
    COMMENT 'Tabela descontinuada em Sprint 3';

-- ── 8. AUDITORIA: adicionar loja_id para escopo por loja ─────────
ALTER TABLE auditoria
  ADD COLUMN loja_id INT DEFAULT 1 AFTER id,
  ADD INDEX idx_auditoria_tabela_registro (tabela, registro_id);

SET FOREIGN_KEY_CHECKS = 1;

-- ── 9. Atualiza usuários existentes para loja 1 + cargo ───────────
UPDATE usuarios SET loja_id = 1 WHERE loja_id IS NULL OR loja_id = 0;
UPDATE usuarios SET cargo   = 'diretor'    WHERE role = 'admin'      AND (cargo IS NULL OR cargo = '');
UPDATE usuarios SET cargo   = 'financeiro' WHERE role = 'financeiro' AND (cargo IS NULL OR cargo = '');
UPDATE usuarios SET cargo   = 'consultor'  WHERE role = 'agente'     AND (cargo IS NULL OR cargo = '');

-- ── 10. Limpa reservas de teste (começar limpo) ───────────────────
DELETE FROM auditoria  WHERE tabela = 'reservas';
DELETE FROM comissoes;
DELETE FROM lembretes;
DELETE FROM financeiro WHERE reserva_id IS NOT NULL;
DELETE FROM reservas;

-- ╔════════════════════════════════════════════════════════════════╗
-- ║  FASE 0 CONCLUÍDA                                              ║
-- ║  Próximo: migrate_sprint3_fase1.sql (vendas + itens + pax)     ║
-- ╚════════════════════════════════════════════════════════════════╝
