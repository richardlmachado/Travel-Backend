-- ================================================================
-- Sprint 5.1 — Sistema RBAC de Permissões por Usuário
-- ================================================================

-- 1. Tabela de permissões por usuário (modulo + acao)
CREATE TABLE IF NOT EXISTS usuario_permissoes (
  id          INT NOT NULL AUTO_INCREMENT,
  usuario_id  INT NOT NULL,
  modulo      VARCHAR(50) NOT NULL,
  acao        VARCHAR(20) NOT NULL,
  permitido   TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_perm (usuario_id, modulo, acao),
  CONSTRAINT fk_perm_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Seed: permissões padrão para usuários existentes
-- Módulos: dashboard, vendas, clientes, fornecedores, financeiro, comissoes, lembretes, usuarios, configuracoes
-- Ações: ver, criar, editar, excluir

-- Admin (user id=1) — tudo liberado
INSERT INTO usuario_permissoes (usuario_id, modulo, acao) VALUES
  (1,'dashboard','ver'),
  (1,'vendas','ver'),(1,'vendas','criar'),(1,'vendas','editar'),(1,'vendas','excluir'),
  (1,'clientes','ver'),(1,'clientes','criar'),(1,'clientes','editar'),(1,'clientes','excluir'),
  (1,'fornecedores','ver'),(1,'fornecedores','criar'),(1,'fornecedores','editar'),(1,'fornecedores','excluir'),
  (1,'financeiro','ver'),(1,'financeiro','criar'),(1,'financeiro','editar'),(1,'financeiro','excluir'),
  (1,'comissoes','ver'),(1,'comissoes','criar'),(1,'comissoes','editar'),(1,'comissoes','excluir'),
  (1,'lembretes','ver'),(1,'lembretes','criar'),(1,'lembretes','editar'),(1,'lembretes','excluir'),
  (1,'usuarios','ver'),(1,'usuarios','criar'),(1,'usuarios','editar'),(1,'usuarios','excluir'),
  (1,'configuracoes','ver'),(1,'configuracoes','editar')
ON DUPLICATE KEY UPDATE permitido = 1;

-- Agente (user id=2) — acesso limitado
INSERT INTO usuario_permissoes (usuario_id, modulo, acao) VALUES
  (2,'dashboard','ver'),
  (2,'vendas','ver'),(2,'vendas','criar'),(2,'vendas','editar'),
  (2,'clientes','ver'),(2,'clientes','criar'),(2,'clientes','editar'),
  (2,'fornecedores','ver'),
  (2,'financeiro','ver'),
  (2,'comissoes','ver'),
  (2,'lembretes','ver')
ON DUPLICATE KEY UPDATE permitido = 1;
