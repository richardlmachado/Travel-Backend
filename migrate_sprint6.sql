-- ── Sprint 6: Financeiro Completo ────────────────────────────────
-- Adiciona suporte a estorno de parcelas
-- Aplicar com:
--   docker exec travelos-travelos-db-1 mysql -u travelos -pTravelOS@2025! travelos < migrate_sprint6.sql

-- Campos de estorno em pagamento_parcelas
ALTER TABLE pagamento_parcelas
  ADD COLUMN estornado       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN estornado_em    DATETIME     DEFAULT NULL,
  ADD COLUMN estornado_por   INT          DEFAULT NULL,
  ADD COLUMN motivo_estorno  VARCHAR(255) DEFAULT NULL;

-- Índice para queries de aging/fluxo (data_vencimento + pago + loja_id via pagamentos)
ALTER TABLE pagamento_parcelas
  ADD INDEX idx_pp_venc_pago (data_vencimento, pago);
