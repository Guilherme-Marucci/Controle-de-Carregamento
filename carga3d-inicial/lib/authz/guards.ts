import type { AuthzAction, PageCategory, UserRole, UserStatus } from '../../db/schema-authz.ts';
import {
  AUTHZ_SESSION_COOKIE_NAME,
  buildClearSessionCookieHeader,
  parseCookies,
  verifyCompactSessionCookie,
  verifyStrictOrigin,
  type CompactSessionClaims,
} from '../auth-session.ts';
import {
  resolveRoutePolicy,
  SYSTEM_PAGES_BY_KEY,
  type PageKey,
} from './route-registry.ts';

export interface D1RunMeta {
  changes: number;
  last_row_id?: number;
}

export interface D1ExecResult<T = unknown> {
  results: T[];
  success: boolean;
  meta: D1RunMeta;
}

export interface AuthzD1PreparedStatement {
  bind(...values: unknown[]): AuthzD1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ExecResult<T>>;
  run(): Promise<D1ExecResult>;
}

export interface AuthzD1Database {
  prepare(query: string): AuthzD1PreparedStatement;
  batch<T = unknown>(statements: AuthzD1PreparedStatement[]): Promise<D1ExecResult<T>[]>;
}

export type AuthzErrorCode =
  | 'UNAUTHENTICATED'
  | 'USER_NOT_FOUND'
  | 'SESSION_STALE_AUTHZ_VERSION'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'UNKNOWN_PAGE_KEY'
  | 'GOVERNANCE_FORBIDDEN_FOR_ADMIN'
  | 'GOVERNANCE_FORBIDDEN_FOR_USER'
  | 'DEFAULT_DENY_NO_GRANT'
  | 'DEFAULT_DENY_UNREGISTERED_ROUTE'
  | 'ROUTE_TAMPERING_DETECTED'
  | 'CSRF_ORIGIN_REJECTED'
  | 'IDOR_RESOURCE_FORBIDDEN'
  | 'PRIVILEGE_ESCALATION_FORBIDDEN'
  | 'LAST_SUPER_ADMIN_INVARIANT';

export class AuthzError extends Error {
  public readonly status: 400 | 401 | 403 | 409;
  public readonly code: AuthzErrorCode;

  constructor(status: 400 | 401 | 403 | 409, code: AuthzErrorCode, message: string) {
    super(message);
    this.name = 'AuthzError';
    this.status = status;
    this.code = code;
  }
}

export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly authzVersion: number;
  readonly tenantId: string;
}

interface DbUserRow {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  authz_version: number;
  tenant_id: string;
}

interface DbSystemPageRow {
  page_key: string;
  category: PageCategory;
}

/**
 * Valida sincronamente a sessão contra o banco D1 (status ACTIVE + authz_version atual)
 * e aplica o modelo híbrido RBAC + PBAC Default Deny sobre (pageKey, requiredAction).
 */
export async function authorizePageAccess(
  db: AuthzD1Database,
  sessionClaims: CompactSessionClaims | null | undefined,
  pageKey: string,
  requiredAction: AuthzAction
): Promise<AuthenticatedPrincipal> {
  if (!sessionClaims || !sessionClaims.uid) {
    throw new AuthzError(401, 'UNAUTHENTICATED', 'Sessão ausente ou inválida.');
  }

  const userRow = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users
       WHERE id = ?
       LIMIT 1`
    )
    .bind(sessionClaims.uid)
    .first<DbUserRow>();

  if (!userRow) {
    throw new AuthzError(401, 'USER_NOT_FOUND', 'Conta de usuário inexistente.');
  }

  // 1. Invalidação síncrona imediata se o status não for ACTIVE
  if (userRow.status !== 'ACTIVE') {
    throw new AuthzError(
      403,
      'ACCOUNT_NOT_ACTIVE',
      `Acesso bloqueado: conta com status ${userRow.status}.`
    );
  }

  // 2. Invalidação síncrona imediata se authz_version do banco superou o do cookie
  if (sessionClaims.ver < userRow.authz_version || sessionClaims.ver !== userRow.authz_version) {
    throw new AuthzError(
      401,
      'SESSION_STALE_AUTHZ_VERSION',
      'Permissões ou papel da conta foram alterados. Faça login novamente.'
    );
  }

  // 3. Resolução determinística do módulo no catálogo estático + confirmação no banco
  const catalogPage = SYSTEM_PAGES_BY_KEY.get(pageKey as PageKey);
  if (!catalogPage) {
    throw new AuthzError(
      403,
      'UNKNOWN_PAGE_KEY',
      `Módulo não registrado (${pageKey}): bloqueado por Default Deny.`
    );
  }

  const dbPage = await db
    .prepare(`SELECT page_key, category FROM system_pages WHERE page_key = ? LIMIT 1`)
    .bind(pageKey)
    .first<DbSystemPageRow>();

  const effectiveCategory: PageCategory = dbPage ? dbPage.category : catalogPage.category;
  if (effectiveCategory !== catalogPage.category) {
    throw new AuthzError(
      403,
      'UNKNOWN_PAGE_KEY',
      'Divergência de categoria de segurança detectada no módulo.'
    );
  }

  const principal: AuthenticatedPrincipal = {
    id: userRow.id,
    email: userRow.email,
    displayName: userRow.display_name,
    role: userRow.role,
    status: userRow.status,
    authzVersion: userRow.authz_version,
    tenantId: userRow.tenant_id,
  };

  // 4. Avaliação da Matriz de Papéis (RBAC + PBAC)
  if (principal.role === 'SUPER_ADMIN') {
    return principal;
  }

  if (principal.role === 'ADMIN') {
    if (effectiveCategory === 'GOVERNANCE') {
      throw new AuthzError(
        403,
        'GOVERNANCE_FORBIDDEN_FOR_ADMIN',
        'Papel ADMIN não possui acesso a módulos de Governança.'
      );
    }
    return principal;
  }

  // Papel USER: Zero-Trust Default Deny (nunca acessa GOVERNANCE; exige ACL explícita para OPERATIONS)
  if (effectiveCategory === 'GOVERNANCE') {
    throw new AuthzError(
      403,
      'GOVERNANCE_FORBIDDEN_FOR_USER',
      'Papel USER é estritamente proibido em módulos de Governança.'
    );
  }

  const grantRow = await db
    .prepare(
      `SELECT id
       FROM user_page_permissions
       WHERE user_id = ? AND page_key = ? AND action = ?
       LIMIT 1`
    )
    .bind(principal.id, pageKey, requiredAction)
    .first<{ id: string }>();

  if (!grantRow) {
    throw new AuthzError(
      403,
      'DEFAULT_DENY_NO_GRANT',
      `Permissão '${requiredAction}' não concedida para '${pageKey}'.`
    );
  }

  return principal;
}

export interface ClientAuthzState {
  readonly userId: string | null;
  readonly role: UserRole | null;
  readonly status: UserStatus | null;
  readonly authzVersion: number;
  readonly grants: Readonly<Record<string, readonly AuthzAction[]>>;
}

/**
 * Avaliador puro de permissão visual no cliente (UX Defensiva - Default Deny).
 * Reutilizado por components/authz/AccessBoundary.tsx.
 */
export function canAccessClientModule(
  state: ClientAuthzState,
  pageKey: PageKey,
  action: AuthzAction = 'read'
): boolean {
  if (!state.userId || !state.role || state.status !== 'ACTIVE') {
    return false;
  }

  const pageMeta = SYSTEM_PAGES_BY_KEY.get(pageKey);
  if (!pageMeta) {
    return false;
  }

  if (state.role === 'SUPER_ADMIN') {
    return true;
  }

  if (state.role === 'ADMIN') {
    return pageMeta.category === 'OPERATIONS';
  }

  if (pageMeta.category === 'GOVERNANCE') {
    return false;
  }

  const grantedActions = state.grants[pageKey];
  return Array.isArray(grantedActions) && grantedActions.includes(action);
}

export interface ProtectedResourceDescriptor {
  readonly resourceType: string;
  readonly resourceId: string;
  readonly ownerId: string;
  readonly tenantId: string;
}

export interface ResourceAccessPolicy {
  readonly pageKey: PageKey;
  readonly requiredAction: AuthzAction;
  readonly allowSameTenantAdmin?: boolean;
}

/**
 * Guard de autorização no nível do dado (Anti-IDOR & Isolamento de Tenant/Posse).
 * Libera o módulo via authorizePageAccess e valida posse/tenant do registro alvo.
 */
export async function requireResourceAccess(
  db: AuthzD1Database,
  sessionClaims: CompactSessionClaims | null | undefined,
  resource: ProtectedResourceDescriptor,
  policy: ResourceAccessPolicy
): Promise<AuthenticatedPrincipal> {
  const principal = await authorizePageAccess(
    db,
    sessionClaims,
    policy.pageKey,
    policy.requiredAction
  );

  if (principal.role === 'SUPER_ADMIN') {
    return principal;
  }

  if (principal.tenantId !== resource.tenantId) {
    throw new AuthzError(
      403,
      'IDOR_RESOURCE_FORBIDDEN',
      `Acesso cruzado entre tenants negado para ${resource.resourceType}:${resource.resourceId}.`
    );
  }

  if (principal.role === 'ADMIN' && policy.allowSameTenantAdmin === true) {
    return principal;
  }

  if (principal.id !== resource.ownerId) {
    throw new AuthzError(
      403,
      'IDOR_RESOURCE_FORBIDDEN',
      `Violação de posse (IDOR) bloqueada em ${resource.resourceType}:${resource.resourceId}.`
    );
  }

  return principal;
}

/**
 * Garante o invariante de sobrevivência administrativa:
 * O último SUPER_ADMIN com status ACTIVE jamais pode ser suspenso, rebaixado ou removido.
 */
export async function enforceAdminInvariant(
  db: AuthzD1Database,
  targetUserId: string,
  nextRole: UserRole,
  nextStatus: UserStatus
): Promise<DbUserRow> {
  const target = await db
    .prepare(
      `SELECT id, email, display_name, role, status, authz_version, tenant_id
       FROM users
       WHERE id = ?
       LIMIT 1`
    )
    .bind(targetUserId)
    .first<DbUserRow>();

  if (!target) {
    throw new AuthzError(400, 'USER_NOT_FOUND', 'Usuário alvo não encontrado.');
  }

  const isLosingActiveSuperAdmin =
    target.role === 'SUPER_ADMIN' &&
    target.status === 'ACTIVE' &&
    (nextRole !== 'SUPER_ADMIN' || nextStatus !== 'ACTIVE');

  if (isLosingActiveSuperAdmin) {
    const remaining = await db
      .prepare(
        `SELECT COUNT(*) AS total
         FROM users
         WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' AND id <> ?`
      )
      .bind(targetUserId)
      .first<{ total: number }>();

    const otherActiveCount = Number(remaining?.total ?? 0);
    if (otherActiveCount < 1) {
      throw new AuthzError(
        409,
        'LAST_SUPER_ADMIN_INVARIANT',
        'Operação abortada atomicamente: proibido rebaixar ou suspender o último SUPER_ADMIN ativo.'
      );
    }
  }

  return target;
}

export interface AuthzMiddlewareEnv {
  DB: AuthzD1Database;
  SESSION_SECRET: string;
}

export type AuthzMiddlewareOutcome =
  | {
      readonly allowed: true;
      readonly channel: 'M2M_BYPASS' | 'PUBLIC_AUTH';
      readonly response: null;
    }
  | {
      readonly allowed: true;
      readonly channel: 'PROTECTED';
      readonly principal: AuthenticatedPrincipal;
      readonly pageKey: PageKey;
      readonly requiredAction: AuthzAction;
      readonly params: Readonly<Record<string, string>>;
      readonly response: null;
    }
  | {
      readonly allowed: false;
      readonly response: Response;
    };

/**
 * Middleware de interceptação rápida no Edge para rotas Web e API:
 * - Preserva 100% o pipeline M2M em POST /api/scans sem interferência de sessão humana.
 * - Aplica proteção estrita de Origin contra CSRF em mutações HTTP.
 * - Aplica Default Deny para qualquer rota fora do Route Registry.
 * - Invalida sincronamente cookies com authz_version defasado.
 */
export async function authzEdgeMiddleware(
  request: Request,
  env: AuthzMiddlewareEnv
): Promise<AuthzMiddlewareOutcome> {
  const url = new URL(request.url);
  const resolution = resolveRoutePolicy(request.method, url.pathname);

  if (resolution.status === 'TAMPERED_PATH') {
    return {
      allowed: false,
      response: Response.json(
        { error: 'ROUTE_TAMPERING_DETECTED', reason: resolution.reason },
        { status: 400 }
      ),
    };
  }

  // Subsistema M2M (POST /api/scans) segue isolado para validação de Service Token/JWT scanner:ingest
  if (resolution.status === 'MATCHED_M2M_BYPASS') {
    return { allowed: true, channel: 'M2M_BYPASS', response: null };
  }

  if (resolution.status === 'MATCHED_PUBLIC_AUTH') {
    const originCheck = verifyStrictOrigin(request);
    if (!originCheck.valid) {
      return {
        allowed: false,
        response: Response.json(
          { error: 'CSRF_ORIGIN_REJECTED', reason: originCheck.reason },
          { status: 403 }
        ),
      };
    }
    return { allowed: true, channel: 'PUBLIC_AUTH', response: null };
  }

  if (resolution.status === 'UNMATCHED_DEFAULT_DENY') {
    return {
      allowed: false,
      response: Response.json(
        { error: 'DEFAULT_DENY_UNREGISTERED_ROUTE', path: resolution.normalizedPath },
        { status: 403 }
      ),
    };
  }

  // Em rotas protegidas mutáveis, exige Origin idêntico ao host da aplicação
  const originCheck = verifyStrictOrigin(request);
  if (!originCheck.valid) {
    return {
      allowed: false,
      response: Response.json(
        { error: 'CSRF_ORIGIN_REJECTED', reason: originCheck.reason },
        { status: 403 }
      ),
    };
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const rawToken = cookies[AUTHZ_SESSION_COOKIE_NAME];
  const verifiedCookie = await verifyCompactSessionCookie(rawToken, env.SESSION_SECRET);

  if (!verifiedCookie.valid || !verifiedCookie.claims) {
    const headers = new Headers();
    if (rawToken) {
      headers.append('Set-Cookie', buildClearSessionCookieHeader());
    }
    return {
      allowed: false,
      response: Response.json(
        { error: verifiedCookie.errorCode ?? 'UNAUTHENTICATED' },
        { status: 401, headers }
      ),
    };
  }

  try {
    const principal = await authorizePageAccess(
      env.DB,
      verifiedCookie.claims,
      resolution.pageKey,
      resolution.requiredAction
    );

    return {
      allowed: true,
      channel: 'PROTECTED',
      principal,
      pageKey: resolution.pageKey,
      requiredAction: resolution.requiredAction,
      params: resolution.params,
      response: null,
    };
  } catch (err) {
    if (err instanceof AuthzError) {
      const headers = new Headers();
      if (err.status === 401 || err.code === 'ACCOUNT_NOT_ACTIVE') {
        headers.append('Set-Cookie', buildClearSessionCookieHeader());
      }
      return {
        allowed: false,
        response: Response.json({ error: err.code, message: err.message }, { status: err.status, headers }),
      };
    }
    throw err;
  }
}
