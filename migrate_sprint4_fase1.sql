-- ─────────────────────────────────────────────────────────────
-- Sprint 4 – Fase 1: Lembretes de Check-in & Auditoria Vendas
-- ─────────────────────────────────────────────────────────────

-- Lembretes vinculados ao novo sistema de vendas
CREATE TABLE IF NOT EXISTS venda_lembretes (
  id                   INT            NOT NULL AUTO_INCREMENT,
  loja_id              INT            NOT NULL,
  venda_id             INT            NOT NULL,
  tipo                 ENUM('checkin_48h','manual','personalizado') NOT NULL DEFAULT 'checkin_48h',
  canal                ENUM('email','whatsapp','sistema')          NOT NULL DEFAULT 'email',
  status               ENUM('agendado','enviado','falhou','cancelado') NOT NULL DEFAULT 'agendado',
  agendado_para        DATETIME       NOT NULL,
  enviado_em           DATETIME       NULL,
  destinatario_email   VARCHAR(255)   NULL,
  destinatario_nome    VARCHAR(255)   NULL,
  assunto              VARCHAR(255)   NULL,
  mensagem             TEXT           NULL,
  disparado_por        ENUM('automatico','manual') NOT NULL DEFAULT 'automatico',
  tentativas           TINYINT        NOT NULL DEFAULT 0,
  erro                 TEXT           NULL,
  criado_por           INT            NULL,
  criado_em            DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_vl_loja     (loja_id),
  INDEX idx_vl_venda    (venda_id),
  INDEX idx_vl_status   (status),
  INDEX idx_vl_agendado (agendado_para, status),
  CONSTRAINT fk_vl_venda FOREIGN KEY (venda_id)  REFERENCES vendas(id) ON DELETE CASCADE,
  CONSTRAINT fk_vl_loja  FOREIGN KEY (loja_id)   REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Garantir que auditoria tem loja_id (pode já existir — IF NOT EXISTS é seguro)
ALTER TABLE auditoria
  ADD COLUMN IF NOT EXISTS loja_id INT NULL AFTER id;

-- Índice de busca de auditoria por venda
CREATE INDEX IF NOT EXISTS idx_audit_tabela_reg
  ON auditoria (tabela, registro_id);
