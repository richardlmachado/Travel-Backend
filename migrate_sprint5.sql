-- ================================================================
-- Sprint 5 — Gestao de Usuarios & Configuracoes
-- ================================================================

-- 1. Campo telefone em usuarios (para contato e perfil)
ALTER TABLE usuarios
  ADD COLUMN telefone VARCHAR(30) NULL AFTER cargo;

-- 2. Tabela de configuracoes do sistema (key-value por loja)
CREATE TABLE IF NOT EXISTS configuracoes (
  id         INT NOT NULL AUTO_INCREMENT,
  loja_id    INT NOT NULL,
  chave      VARCHAR(100) NOT NULL,
  valor      TEXT NULL,
  tipo       ENUM('text','number','boolean','json','password') NOT NULL DEFAULT 'text',
  grupo      VARCHAR(50) NOT NULL DEFAULT 'geral',
  descricao  VARCHAR(255) NULL,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_config_loja_chave (loja_id, chave),
  CONSTRAINT fk_config_loja FOREIGN KEY (loja_id) REFERENCES lojas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Configuracoes padrao para loja 1
INSERT INTO configuracoes (loja_id, chave, valor, tipo, grupo, descricao) VALUES
  (1, 'smtp_host',    NULL, 'text',     'email', 'Servidor SMTP'),
  (1, 'smtp_port',    '587', 'number',  'email', 'Porta SMTP'),
  (1, 'smtp_user',    NULL, 'text',     'email', 'Usuario SMTP'),
  (1, 'smtp_pass',    NULL, 'password', 'email', 'Senha SMTP'),
  (1, 'smtp_from',    NULL, 'text',     'email', 'Email remetente'),
  (1, 'smtp_secure',  'false', 'boolean', 'email', 'Usar TLS/SSL'),
  (1, 'timezone',     'America/Sao_Paulo', 'text', 'geral', 'Fuso horario'),
  (1, 'formato_data', 'DD/MM/YYYY', 'text', 'geral', 'Formato de data'),
  (1, 'moeda_padrao', 'BRL', 'text', 'geral', 'Moeda padrao do sistema')
ON DUPLICATE KEY UPDATE chave = chave;

-- 4. Campos extras na loja (logo, site)
-- MySQL 8.0 nao suporta IF NOT EXISTS em ALTER TABLE ADD COLUMN
-- Executar manualmente se colunas nao existirem:
-- ALTER TABLE lojas ADD COLUMN logo_url VARCHAR(500) NULL AFTER email, ADD COLUMN site VARCHAR(200) NULL AFTER logo_url;
