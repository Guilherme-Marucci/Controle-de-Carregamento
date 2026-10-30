-- ============================================================================
-- MIGRAÇÃO D1 (SQLite): Governança de Identidades, RBAC + PBAC Granular e Auditoria
-- Compatível com Cloudflare D1 (wrangler d1 execute)
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `email` text NOT NULL,
  `display_name` text NOT NULL,
  `full_name` text,
  `password_hash` text,
  `role` text NOT NULL DEFAULT 'USER' CHECK (`role` IN ('SUPER_ADMIN', 'ADMIN', 'USER')),
  `status` text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (`status` IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED')),
  `authz_version` integer NOT NULL DEFAULT 1 CHECK (`authz_version` >= 1),
  `tenant_id` text NOT NULL DEFAULT 'default',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `users_email_uq` ON `users` (`email`);
CREATE INDEX IF NOT EXISTS `users_role_status_idx` ON `users` (`role`, `status`);
CREATE INDEX IF NOT EXISTS `users_tenant_id_idx` ON `users` (`tenant_id`);

CREATE TABLE IF NOT EXISTS `system_pages` (
  `page_key` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL CHECK (`category` IN ('OPERATIONS', 'GOVERNANCE')),
  `route_template` text NOT NULL,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `system_pages_category_idx` ON `system_pages` (`category`);
CREATE UNIQUE INDEX IF NOT EXISTS `system_pages_route_template_uq` ON `system_pages` (`route_template`);

CREATE TABLE IF NOT EXISTS `user_page_permissions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `page_key` text NOT NULL,
  `action` text NOT NULL CHECK (`action` IN ('read', 'write', 'execute')),
  `granted_by` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (`page_key`) REFERENCES `system_pages`(`page_key`) ON UPDATE RESTRICT ON DELETE CASCADE,
  FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_page_permissions_uq`
  ON `user_page_permissions` (`user_id`, `page_key`, `action`);
CREATE INDEX IF NOT EXISTS `user_page_permissions_lookup_idx`
  ON `user_page_permissions` (`user_id`, `page_key`);

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_id` text NOT NULL,
  `target_user_id` text,
  `action` text NOT NULL,
  `before_state` text,
  `after_state` text,
  `reason` text NOT NULL,
  `ip_address` text,
  `request_id` text NOT NULL,
  `created_at` text NOT NULL
);

CREATE INDEX IF NOT EXISTS `audit_logs_actor_created_idx` ON `audit_logs` (`actor_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `audit_logs_target_created_idx` ON `audit_logs` (`target_user_id`, `created_at`);
CREATE INDEX IF NOT EXISTS `audit_logs_request_id_idx` ON `audit_logs` (`request_id`);

-- ============================================================================
-- TRIGGERS DEFENSIVOS NO ENGINE SQLITE/D1 (DEFENSE-IN-DEPTH)
-- 1. Imutabilidade estrita de audit_logs (Append-Only)
-- 2. Invariante atômico: proibido suspender, rebaixar ou excluir o último SUPER_ADMIN ativo
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS `trg_audit_logs_immutable_update`
BEFORE UPDATE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE: operacoes UPDATE sao proibidas em audit_logs');
END;

CREATE TRIGGER IF NOT EXISTS `trg_audit_logs_immutable_delete`
BEFORE DELETE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_LOG_IMMUTABLE: operacoes DELETE sao proibidas em audit_logs');
END;

CREATE TRIGGER IF NOT EXISTS `trg_protect_last_super_admin_update`
BEFORE UPDATE ON `users`
WHEN OLD.`role` = 'SUPER_ADMIN'
  AND OLD.`status` = 'ACTIVE'
  AND (NEW.`role` <> 'SUPER_ADMIN' OR NEW.`status` <> 'ACTIVE')
  AND (SELECT COUNT(*) FROM `users` WHERE `role` = 'SUPER_ADMIN' AND `status` = 'ACTIVE' AND `id` <> OLD.`id`) = 0
BEGIN
  SELECT RAISE(ABORT, 'LAST_SUPER_ADMIN_INVARIANT: proibido suspender ou rebaixar o ultimo SUPER_ADMIN ativo');
END;

CREATE TRIGGER IF NOT EXISTS `trg_protect_last_super_admin_delete`
BEFORE DELETE ON `users`
WHEN OLD.`role` = 'SUPER_ADMIN'
  AND OLD.`status` = 'ACTIVE'
  AND (SELECT COUNT(*) FROM `users` WHERE `role` = 'SUPER_ADMIN' AND `status` = 'ACTIVE' AND `id` <> OLD.`id`) = 0
BEGIN
  SELECT RAISE(ABORT, 'LAST_SUPER_ADMIN_INVARIANT: proibido excluir o ultimo SUPER_ADMIN ativo');
END;

-- ============================================================================
-- SEED IDEMPOTENTE DO CATÁLOGO DE PÁGINAS E MÓDULOS DO SISTEMA
-- ============================================================================

INSERT OR IGNORE INTO `system_pages` (`page_key`, `name`, `category`, `route_template`, `created_at`) VALUES
  ('op:carga-3d', 'Planejamento e Cubagem 3D', 'OPERATIONS', '/planejamento', '2026-01-01T00:00:00.000Z'),
  ('op:romaneio', 'Romaneio e Ordem de Expedição', 'OPERATIONS', '/manifestos/:id', '2026-01-01T00:00:00.000Z'),
  ('op:balanca', 'Simulador de Balança e Eixos', 'OPERATIONS', '/balanca', '2026-01-01T00:00:00.000Z'),
  ('op:indicadores', 'Painel de Indicadores Logísticos', 'OPERATIONS', '/indicadores', '2026-01-01T00:00:00.000Z'),
  ('op:frota', 'Cadastro de Frota e Caminhões', 'OPERATIONS', '/frota', '2026-01-01T00:00:00.000Z'),
  ('op:produtos', 'Catálogo de Produtos e Paletes', 'OPERATIONS', '/produtos', '2026-01-01T00:00:00.000Z'),
  ('op:cargas', 'Gestão de Cargas e Workspace', 'OPERATIONS', '/cargas/:id', '2026-01-01T00:00:00.000Z'),
  ('gov:usuarios', 'Governança de Contas e Papéis', 'GOVERNANCE', '/governanca/usuarios', '2026-01-01T00:00:00.000Z'),
  ('gov:permissoes', 'Gestão de ACLs e Permissões Granulares', 'GOVERNANCE', '/governanca/permissoes', '2026-01-01T00:00:00.000Z'),
  ('gov:auditoria', 'Trilha de Auditoria de Segurança', 'GOVERNANCE', '/governanca/auditoria', '2026-01-01T00:00:00.000Z');

