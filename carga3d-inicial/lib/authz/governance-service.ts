import type { AuthzAction, UserRole, UserStatus } from '../../db/schema-authz.ts';
import type { CompactSessionClaims } from '../auth-session.ts';
import { generateUlid } from '../ulid.ts';
import {
  authorizePageAccess,
  AuthzError,
  enforceAdminInvariant,
  type AuthenticatedPrincipal,
  type AuthzD1Database,
} from './guards.ts';
import { SYSTEM_PAGES_BY_KEY, type PageKey } from './route-registry.ts';

export interface GovernanceAuditContext {
  readonly reason: string;
  readonly ipAddress?: string | null;
  readonly requestId?: string;
}

export interface MinimizedUserAuditSnapshot {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly authzVersion: number;
  readonly tenantId: string;
}

interface RawUserRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  authz_version: number;
  tenant_id: string;
}

function minimizeUserSnapshot(row: RawUserRow): MinimizedUserAuditSnapshot {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    authzVersion: row.authz_version,
    tenantId: row.tenant_id,
  };
}

function normalizeAuditReason(reason: string): string {
  const cleaned = reason.trim();
  if (cleaned.length < 4 || cleaned.length > 500) {
    throw new AuthzError(
      400,
      'PRIVILEGE_ESCALATION_FORBIDDEN',
      'Toda operação de governança exige justificativa auditável entre 4 e 500 caracteres.'
    );
  }
  return cleaned;
}

async function requireSuperAdminActor(
  db: AuthzD1Database,
  actorSession: CompactSessionClaims | null | undefined,
  pageKey: 'gov:usuarios' | 'gov:permissoes' | 'gov:auditoria',
  action: AuthzAction
): Promise<AuthenticatedPrincipal> {
  const actor = await authorizePageAccess(db, actorSession, pageKey, action);
  if (actor.role !== 'SUPER_ADMIN') {
    throw new AuthzError(
      403,
      'PRIVILEGE_ESCALATION_FORBIDDEN',
      'Apenas contas SUPER_ADMIN ativas podem executar operações de governança.'
    );
  }
  return actor;
}

/**
 * Registra uma nova conta em estado PENDING_APPROVAL com papel USER e zero permissões (Default Deny).
 */
export async function registerPendingUserAccount(
  db: AuthzD1Database,
  input: {
    id?: string;
    email: string;
    displayName: string;
    fullName?: string | null;
    passwordHash?: string | null;
    tenantId?: string;
    requestId?: string;
  }
): Promise<{ userId: string; status: 'PENDING_APPROVAL'; role: 'USER'; authzVersion: number }> {
  const nowIso = new Date().toISOString();
  const userId = input.id ?? `usr_${generateUlid()}`;
  const normalizedEmail = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const tenantId = input.tenantId ?? 'default';
  const auditId = generateUlid();
  const requestId = input.requestId ?? generateUlid();

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (
           id, email, display_name, full_name, password_hash,
           role, status, authz_version, tenant_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'USER', 'PENDING_APPROVAL', 1, ?, ?, ?)`
      )
      .bind(
        userId,
        normalizedEmail,
        displayName,
        input.fullName ?? null,
        input.passwordHash ?? null,
        tenantId,
        nowIso,
        nowIso
      ),
    db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_id, target_user_id, action, before_state, after_state,
           reason, ip_address, request_id, created_at
         ) VALUES (?, ?, ?, 'USER_REGISTERED_PENDING', NULL, ?, ?, NULL, ?, ?)`
      )
      .bind(
        auditId,
        userId,
        userId,
        JSON.stringify({
          id: userId,
          email: normalizedEmail,
          role: 'USER',
          status: 'PENDING_APPROVAL',
          authzVersion: 1,
          tenantId,
        }),
        'Auto-cadastro inicial aguardando aprovação de SUPER_ADMIN',
        requestId,
        nowIso
      ),
  ]);

  return { userId, status: 'PENDING_APPROVAL', role: 'USER', authzVersion: 1 };
}

/**
 * Aprova uma conta pendente (PENDING_APPROVAL -> ACTIVE) em db.batch() atômico:
 * atualiza status + incrementa authz_version + grava audit_logs.
 */
export async function approveUserAccount(
  db: AuthzD1Database,
  actorSession: CompactSessionClaims | null | undefined,
  targetUserId: string,
  context: GovernanceAuditContext
): Promise<{ targetUserId: string; status: UserStatus; newAuthzVersion: number }> {
  const actor = await requireSuperAdminActor(db, actorSession, 'gov:usuarios', 'execute');
  const reason = normalizeAuditReason(context.reason);

  const target = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users WHERE id = ? LIMIT 1`
    )
    .bind(targetUserId)
    .first<RawUserRow>();

  if (!target) {
    throw new AuthzError(400, 'USER_NOT_FOUND', 'Conta alvo não localizada.');
  }

  const nowIso = new Date().toISOString();
  const nextVersion = target.authz_version + 1;
  const beforeSnapshot = minimizeUserSnapshot(target);
  const afterSnapshot: MinimizedUserAuditSnapshot = {
    ...beforeSnapshot,
    status: 'ACTIVE',
    authzVersion: nextVersion,
  };

  await db.batch([
    db
      .prepare(
        `UPDATE users
         SET status = 'ACTIVE',
             authz_version = authz_version + 1,
             updated_at = ?
         WHERE id = ?`
      )
      .bind(nowIso, targetUserId),
    db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_id, target_user_id, action, before_state, after_state,
           reason, ip_address, request_id, created_at
         ) VALUES (?, ?, ?, 'USER_APPROVED', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateUlid(),
        actor.id,
        targetUserId,
        JSON.stringify(beforeSnapshot),
        JSON.stringify(afterSnapshot),
        reason,
        context.ipAddress ?? null,
        context.requestId ?? generateUlid(),
        nowIso
      ),
  ]);

  return { targetUserId, status: 'ACTIVE', newAuthzVersion: nextVersion };
}

/**
 * Suspende ou reativa uma conta de usuário em db.batch() atômico,
 * protegendo invariavelmente o último SUPER_ADMIN ativo.
 */
export async function updateUserStatus(
  db: AuthzD1Database,
  actorSession: CompactSessionClaims | null | undefined,
  targetUserId: string,
  nextStatus: Extract<UserStatus, 'ACTIVE' | 'SUSPENDED'>,
  context: GovernanceAuditContext
): Promise<{ targetUserId: string; status: UserStatus; newAuthzVersion: number }> {
  const actor = await requireSuperAdminActor(db, actorSession, 'gov:usuarios', 'write');
  const reason = normalizeAuditReason(context.reason);

  const current = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users WHERE id = ? LIMIT 1`
    )
    .bind(targetUserId)
    .first<RawUserRow>();

  if (!current) {
    throw new AuthzError(400, 'USER_NOT_FOUND', 'Conta alvo não localizada.');
  }

  await enforceAdminInvariant(db, targetUserId, current.role, nextStatus);

  const nowIso = new Date().toISOString();
  const nextVersion = current.authz_version + 1;
  const beforeSnapshot = minimizeUserSnapshot(current);
  const afterSnapshot: MinimizedUserAuditSnapshot = {
    ...beforeSnapshot,
    status: nextStatus,
    authzVersion: nextVersion,
  };

  const batchResults = await db.batch([
    db
      .prepare(
        `UPDATE users
         SET status = ?,
             authz_version = authz_version + 1,
             updated_at = ?
         WHERE id = ?
           AND (
             role <> 'SUPER_ADMIN'
             OR ? = 'ACTIVE'
             OR (SELECT COUNT(*) FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> ?) >= 1
           )`
      )
      .bind(nextStatus, nowIso, targetUserId, nextStatus, targetUserId),
    db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_id, target_user_id, action, before_state, after_state,
           reason, ip_address, request_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateUlid(),
        actor.id,
        targetUserId,
        nextStatus === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
        JSON.stringify(beforeSnapshot),
        JSON.stringify(afterSnapshot),
        reason,
        context.ipAddress ?? null,
        context.requestId ?? generateUlid(),
        nowIso
      ),
  ]);

  if (!batchResults[0] || batchResults[0].meta.changes === 0) {
    throw new AuthzError(
      409,
      'LAST_SUPER_ADMIN_INVARIANT',
      'Falha atômica ao alterar status: proteção do último SUPER_ADMIN ativo.'
    );
  }

  return { targetUserId, status: nextStatus, newAuthzVersion: nextVersion };
}

/**
 * Atualiza o papel (USER | ADMIN | SUPER_ADMIN) em db.batch() atômico,
 * incrementando authz_version e protegendo o último SUPER_ADMIN ativo.
 */
export async function updateUserRole(
  db: AuthzD1Database,
  actorSession: CompactSessionClaims | null | undefined,
  targetUserId: string,
  nextRole: UserRole,
  context: GovernanceAuditContext
): Promise<{ targetUserId: string; role: UserRole; newAuthzVersion: number }> {
  const actor = await requireSuperAdminActor(db, actorSession, 'gov:usuarios', 'write');
  const reason = normalizeAuditReason(context.reason);

  const current = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users WHERE id = ? LIMIT 1`
    )
    .bind(targetUserId)
    .first<RawUserRow>();

  if (!current) {
    throw new AuthzError(400, 'USER_NOT_FOUND', 'Conta alvo não localizada.');
  }

  await enforceAdminInvariant(db, targetUserId, nextRole, current.status);

  const nowIso = new Date().toISOString();
  const nextVersion = current.authz_version + 1;
  const beforeSnapshot = minimizeUserSnapshot(current);
  const afterSnapshot: MinimizedUserAuditSnapshot = {
    ...beforeSnapshot,
    role: nextRole,
    authzVersion: nextVersion,
  };

  const batchResults = await db.batch([
    db
      .prepare(
        `UPDATE users
         SET role = ?,
             authz_version = authz_version + 1,
             updated_at = ?
         WHERE id = ?
           AND (
             role <> 'SUPER_ADMIN'
             OR status <> 'ACTIVE'
             OR ? = 'SUPER_ADMIN'
             OR (SELECT COUNT(*) FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> ?) >= 1
           )`
      )
      .bind(nextRole, nowIso, targetUserId, nextRole, targetUserId),
    db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_id, target_user_id, action, before_state, after_state,
           reason, ip_address, request_id, created_at
         ) VALUES (?, ?, ?, 'USER_ROLE_CHANGED', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateUlid(),
        actor.id,
        targetUserId,
        JSON.stringify(beforeSnapshot),
        JSON.stringify(afterSnapshot),
        reason,
        context.ipAddress ?? null,
        context.requestId ?? generateUlid(),
        nowIso
      ),
  ]);

  if (!batchResults[0] || batchResults[0].meta.changes === 0) {
    throw new AuthzError(
      409,
      'LAST_SUPER_ADMIN_INVARIANT',
      'Falha atômica ao alterar papel: proteção do último SUPER_ADMIN ativo.'
    );
  }

  return { targetUserId, role: nextRole, newAuthzVersion: nextVersion };
}

/**
 * Concede uma capability granular (read | write | execute) sobre um módulo OPERATIONS a um USER.
 * Concessão de páginas GOVERNANCE para não-SUPER_ADMIN é bloqueada na origem.
 */
export async function grantPagePermission(
  db: AuthzD1Database,
  actorSession: CompactSessionClaims | null | undefined,
  params: {
    targetUserId: string;
    pageKey: PageKey;
    action: AuthzAction;
  },
  context: GovernanceAuditContext
): Promise<{ permissionId: string; newAuthzVersion: number }> {
  const actor = await requireSuperAdminActor(db, actorSession, 'gov:permissoes', 'write');
  const reason = normalizeAuditReason(context.reason);

  const pageMeta = SYSTEM_PAGES_BY_KEY.get(params.pageKey);
  if (!pageMeta) {
    throw new AuthzError(400, 'UNKNOWN_PAGE_KEY', `Página inválida: ${params.pageKey}`);
  }

  if (pageMeta.category === 'GOVERNANCE') {
    throw new AuthzError(
      403,
      'PRIVILEGE_ESCALATION_FORBIDDEN',
      'Módulos da categoria GOVERNANCE são exclusivos de SUPER_ADMIN e não podem ser delegados via ACL.'
    );
  }

  const target = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users WHERE id = ? LIMIT 1`
    )
    .bind(params.targetUserId)
    .first<RawUserRow>();

  if (!target) {
    throw new AuthzError(400, 'USER_NOT_FOUND', 'Usuário alvo não localizado.');
  }

  const nowIso = new Date().toISOString();
  const permissionId = `perm_${generateUlid()}`;
  const nextVersion = target.authz_version + 1;

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO user_page_permissions (
           id, user_id, page_key, action, granted_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(permissionId, params.targetUserId, params.pageKey, params.action, actor.id, nowIso),
    db
      .prepare(
        `UPDATE users
         SET authz_version = authz_version + 1,
             updated_at = ?
         WHERE id = ?`
      )
      .bind(nowIso, params.targetUserId),
    db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_id, target_user_id, action, before_state, after_state,
           reason, ip_address, request_id, created_at
         ) VALUES (?, ?, ?, 'ACL_PERMISSION_GRANTED', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateUlid(),
        actor.id,
        params.targetUserId,
        JSON.stringify({ authzVersion: target.authz_version }),
        JSON.stringify({
          pageKey: params.pageKey,
          action: params.action,
          authzVersion: nextVersion,
        }),
        reason,
        context.ipAddress ?? null,
        context.requestId ?? generateUlid(),
        nowIso
      ),
  ]);

  return { permissionId, newAuthzVersion: nextVersion };
}

/**
 * Revoga uma capability granular de um usuário em db.batch() atômico,
 * incrementando authz_version para invalidar imediatamente sessões existentes.
 */
export async function revokePagePermission(
  db: AuthzD1Database,
  actorSession: CompactSessionClaims | null | undefined,
  params: {
    targetUserId: string;
    pageKey: PageKey;
    action: AuthzAction;
  },
  context: GovernanceAuditContext
): Promise<{ revoked: boolean; newAuthzVersion: number }> {
  const actor = await requireSuperAdminActor(db, actorSession, 'gov:permissoes', 'write');
  const reason = normalizeAuditReason(context.reason);

  const target = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users WHERE id = ? LIMIT 1`
    )
    .bind(params.targetUserId)
    .first<RawUserRow>();

  if (!target) {
    throw new AuthzError(400, 'USER_NOT_FOUND', 'Usuário alvo não localizado.');
  }

  const nowIso = new Date().toISOString();
  const nextVersion = target.authz_version + 1;

  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM user_page_permissions
         WHERE user_id = ? AND page_key = ? AND action = ?`
      )
      .bind(params.targetUserId, params.pageKey, params.action),
    db
      .prepare(
        `UPDATE users
         SET authz_version = authz_version + 1,
             updated_at = ?
         WHERE id = ?`
      )
      .bind(nowIso, params.targetUserId),
    db
      .prepare(
        `INSERT INTO audit_logs (
           id, actor_id, target_user_id, action, before_state, after_state,
           reason, ip_address, request_id, created_at
         ) VALUES (?, ?, ?, 'ACL_PERMISSION_REVOKED', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        generateUlid(),
        actor.id,
        params.targetUserId,
        JSON.stringify({
          pageKey: params.pageKey,
          action: params.action,
          authzVersion: target.authz_version,
        }),
        JSON.stringify({ revoked: true, authzVersion: nextVersion }),
        reason,
        context.ipAddress ?? null,
        context.requestId ?? generateUlid(),
        nowIso
      ),
  ]);

  const deletedChanges = results[0]?.meta.changes ?? 0;
  return { revoked: deletedChanges > 0, newAuthzVersion: nextVersion };
}

/**
 * Retorna o mapa efetivo de capabilities de um usuário autenticado para hidratação segura de UI.
 */
export async function getEffectiveUserCapabilities(
  db: AuthzD1Database,
  sessionClaims: CompactSessionClaims
): Promise<{
  role: UserRole;
  status: UserStatus;
  authzVersion: number;
  grants: Record<string, AuthzAction[]>;
}> {
  const userRow = await db
    .prepare(
      `SELECT id, role, status, authz_version FROM users WHERE id = ? LIMIT 1`
    )
    .bind(sessionClaims.uid)
    .first<{ id: string; role: UserRole; status: UserStatus; authz_version: number }>();

  if (!userRow || userRow.status !== 'ACTIVE' || sessionClaims.ver !== userRow.authz_version) {
    throw new AuthzError(401, 'SESSION_STALE_AUTHZ_VERSION', 'Sessão inválida ou expirada.');
  }

  const grants: Record<string, AuthzAction[]> = {};

  if (userRow.role === 'SUPER_ADMIN') {
    for (const [key] of SYSTEM_PAGES_BY_KEY) {
      grants[key] = ['read', 'write', 'execute'];
    }
    return {
      role: userRow.role,
      status: userRow.status,
      authzVersion: userRow.authz_version,
      grants,
    };
  }

  if (userRow.role === 'ADMIN') {
    for (const [key, item] of SYSTEM_PAGES_BY_KEY) {
      if (item.category === 'OPERATIONS') {
        grants[key] = ['read', 'write', 'execute'];
      }
    }
    return {
      role: userRow.role,
      status: userRow.status,
      authzVersion: userRow.authz_version,
      grants,
    };
  }

  const rows = await db
    .prepare(
      `SELECT page_key, action FROM user_page_permissions WHERE user_id = ?`
    )
    .bind(userRow.id)
    .all<{ page_key: string; action: AuthzAction }>();

  for (const row of rows.results) {
    const meta = SYSTEM_PAGES_BY_KEY.get(row.page_key as PageKey);
    if (meta && meta.category === 'OPERATIONS') {
      const list = grants[row.page_key] ?? [];
      if (!list.includes(row.action)) {
        list.push(row.action);
      }
      grants[row.page_key] = list;
    }
  }

  return {
    role: userRow.role,
    status: userRow.status,
    authzVersion: userRow.authz_version,
    grants,
  };
}

