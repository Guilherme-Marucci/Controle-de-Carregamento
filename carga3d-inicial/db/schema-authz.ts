import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'USER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const PAGE_CATEGORIES = ['OPERATIONS', 'GOVERNANCE'] as const;
export type PageCategory = (typeof PAGE_CATEGORIES)[number];

export const AUTHZ_ACTIONS = ['read', 'write', 'execute'] as const;
export type AuthzAction = (typeof AUTHZ_ACTIONS)[number];

/**
 * Identidades humanas gerenciadas pelo modelo híbrido RBAC + PBAC.
 * - USER nasce em PENDING_APPROVAL e sem permissões implícitas (Default Deny).
 * - authz_version é incrementado atomicamente em toda mutação de papel, status ou ACL.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    fullName: text('full_name'),
    passwordHash: text('password_hash'),
    role: text('role', { enum: USER_ROLES }).notNull().default('USER'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('PENDING_APPROVAL'),
    authzVersion: integer('authz_version').notNull().default(1),
    tenantId: text('tenant_id').notNull().default('default'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => ({
    emailUq: uniqueIndex('users_email_uq').on(table.email),
    roleStatusIdx: index('users_role_status_idx').on(table.role, table.status),
    tenantIdx: index('users_tenant_id_idx').on(table.tenantId),
  })
);

/**
 * Catálogo imutável de módulos/páginas protegidas do sistema.
 */
export const systemPages = sqliteTable(
  'system_pages',
  {
    pageKey: text('page_key').primaryKey(),
    name: text('name').notNull(),
    category: text('category', { enum: PAGE_CATEGORIES }).notNull(),
    routeTemplate: text('route_template').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    categoryIdx: index('system_pages_category_idx').on(table.category),
    routeTemplateUq: uniqueIndex('system_pages_route_template_uq').on(table.routeTemplate),
  })
);

/**
 * Concessões explícitas de acesso granular (ACL/PBAC) para contas com papel USER.
 */
export const userPagePermissions = sqliteTable(
  'user_page_permissions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade', onUpdate: 'restrict' }),
    pageKey: text('page_key')
      .notNull()
      .references(() => systemPages.pageKey, { onDelete: 'cascade', onUpdate: 'restrict' }),
    action: text('action', { enum: AUTHZ_ACTIONS }).notNull(),
    grantedBy: text('granted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    userPageActionUq: uniqueIndex('user_page_permissions_uq').on(
      table.userId,
      table.pageKey,
      table.action
    ),
    userPageLookupIdx: index('user_page_permissions_lookup_idx').on(
      table.userId,
      table.pageKey
    ),
  })
);

/**
 * Trilha de auditoria append-only imutável para governança e segurança defensiva.
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    targetUserId: text('target_user_id'),
    action: text('action').notNull(),
    beforeState: text('before_state'),
    afterState: text('after_state'),
    reason: text('reason').notNull(),
    ipAddress: text('ip_address'),
    requestId: text('request_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    actorCreatedIdx: index('audit_logs_actor_created_idx').on(table.actorId, table.createdAt),
    targetCreatedIdx: index('audit_logs_target_created_idx').on(
      table.targetUserId,
      table.createdAt
    ),
    requestIdIdx: index('audit_logs_request_id_idx').on(table.requestId),
  })
);

export const usersRelations = relations(users, ({ many }) => ({
  permissions: many(userPagePermissions),
}));

export const systemPagesRelations = relations(systemPages, ({ many }) => ({
  permissions: many(userPagePermissions),
}));

export const userPagePermissionsRelations = relations(userPagePermissions, ({ one }) => ({
  user: one(users, { fields: [userPagePermissions.userId], references: [users.id] }),
  page: one(systemPages, {
    fields: [userPagePermissions.pageKey],
    references: [systemPages.pageKey],
  }),
  granter: one(users, { fields: [userPagePermissions.grantedBy], references: [users.id] }),
}));

export type AuthzUserRecord = typeof users.$inferSelect;
export type NewAuthzUserRecord = typeof users.$inferInsert;
export type SystemPageRecord = typeof systemPages.$inferSelect;
export type UserPagePermissionRecord = typeof userPagePermissions.$inferSelect;
export type AuditLogRecord = typeof auditLogs.$inferSelect;
export type NewAuditLogRecord = typeof auditLogs.$inferInsert;

