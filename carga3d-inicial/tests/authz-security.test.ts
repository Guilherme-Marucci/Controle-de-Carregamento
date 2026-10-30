import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import {
  AUTHZ_SESSION_COOKIE_NAME,
  signCollectorM2MToken,
  signCompactSessionCookie,
  verifyCompactSessionCookie,
} from '../lib/auth-session.ts';
import {
  authzEdgeMiddleware,
  AuthzError,
  canAccessClientModule,
  requireResourceAccess,
  type AuthzD1Database,
  type AuthzD1PreparedStatement,
  type D1ExecResult,
} from '../lib/authz/guards.ts';
import {
  approveUserAccount,
  getEffectiveUserCapabilities,
  grantPagePermission,
  registerPendingUserAccount,
  revokePagePermission,
  updateUserRole,
  updateUserStatus,
} from '../lib/authz/governance-service.ts';
import { buildBootstrapSuperAdminSql } from '../scripts/bootstrap-superadmin.ts';
import { handleScanIngest, type ScanRouteEnv } from '../app/api/scans/route.ts';
import { computeIdempotencyKeyWindow, resetEdgeSecurityCachesForTests } from '../lib/edge-security.ts';
import { generateUlid } from '../lib/ulid.ts';

const TEST_SESSION_SECRET = 'test-edge-compact-session-hmac-secret-2026';
const APP_ORIGIN = 'https://carga3d.internal';

/**
 * Adaptador real Cloudflare D1 sobre SQLite nativo (node:sqlite) com suporte transacional a db.batch(),
 * aplicando integralmente a migração DDL real drizzle/0001_authz_rbac_pbac.sql (índices, FKs e triggers).
 */
function createInMemoryD1FromMigration(): { db: AuthzD1Database; rawSqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  const migrationPath = path.resolve(process.cwd(), 'drizzle/0001_authz_rbac_pbac.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
  sqlite.exec(migrationSql);

  class BoundStmt implements AuthzD1PreparedStatement {
    private readonly query: string;
    private readonly params: SQLInputValue[];

    constructor(query: string, params: SQLInputValue[] = []) {
      this.query = query;
      this.params = params;
    }

    bind(...values: unknown[]): AuthzD1PreparedStatement {
      return new BoundStmt(this.query, values as SQLInputValue[]);
    }

    async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
      const stmt = sqlite.prepare(this.query);
      const row = stmt.get(...this.params) as Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    }

    async all<T = Record<string, unknown>>(): Promise<D1ExecResult<T>> {
      const stmt = sqlite.prepare(this.query);
      const rows = stmt.all(...this.params) as T[];
      return { results: rows, success: true, meta: { changes: 0 } };
    }

    async run(): Promise<D1ExecResult> {
      const stmt = sqlite.prepare(this.query);
      const res = stmt.run(...this.params);
      return {
        results: [],
        success: true,
        meta: {
          changes: Number(res.changes),
          last_row_id: Number(res.lastInsertRowid),
        },
      };
    }

    executeSyncInTx(): D1ExecResult {
      const stmt = sqlite.prepare(this.query);
      const res = stmt.run(...this.params);
      return {
        results: [],
        success: true,
        meta: {
          changes: Number(res.changes),
          last_row_id: Number(res.lastInsertRowid),
        },
      };
    }
  }

  const d1: AuthzD1Database = {
    prepare(query: string): AuthzD1PreparedStatement {
      return new BoundStmt(query);
    },
    async batch<T = unknown>(statements: AuthzD1PreparedStatement[]): Promise<D1ExecResult<T>[]> {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out: D1ExecResult<T>[] = [];
        for (const st of statements) {
          const internal = st as unknown as BoundStmt;
          out.push(internal.executeSyncInTx() as D1ExecResult<T>);
        }
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
  };

  return { db: d1, rawSqlite: sqlite };
}

async function seedFixtureIdentities(rawSqlite: DatabaseSync, db: AuthzD1Database) {
  const bootSql = buildBootstrapSuperAdminSql({
    userId: 'usr_super_01',
    email: 'super@carga3d.internal',
    displayName: 'Super Admin Raiz',
    passwordHash: 'pbkdf2_sha256$100000$c2FsdA$aGFzaA',
    tenantId: 'tenant_matriz',
    auditId: generateUlid(),
    requestId: 'req_boot_01',
    nowIso: '2026-10-29T00:00:00.000Z',
  });
  rawSqlite.exec(bootSql);

  const superSession = {
    uid: 'usr_super_01',
    ver: 1,
    jti: 'jti_sa_1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  // Cria um ADMIN ativo e um USER ativo (zero grants) via fluxo auditado de governança
  await registerPendingUserAccount(db, {
    id: 'usr_admin_01',
    email: 'admin@carga3d.internal',
    displayName: 'Admin Operacional',
    tenantId: 'tenant_matriz',
  });
  await approveUserAccount(db, superSession, 'usr_admin_01', {
    reason: 'Aprovação de gestor operacional',
  });
  const adminRoleRes = await updateUserRole(db, superSession, 'usr_admin_01', 'ADMIN', {
    reason: 'Promoção para ADMIN de operações',
  });

  await registerPendingUserAccount(db, {
    id: 'usr_user_01',
    email: 'operador1@carga3d.internal',
    displayName: 'Operador Zero Trust',
    tenantId: 'tenant_matriz',
  });
  const userApproveRes = await approveUserAccount(db, superSession, 'usr_user_01', {
    reason: 'Aprovação inicial sem ACLs',
  });

  return {
    superSession,
    adminAuthzVersion: adminRoleRes.newAuthzVersion,
    userAuthzVersion: userApproveRes.newAuthzVersion,
  };
}

function makeAuthedRequest(
  pathname: string,
  method: string,
  cookieToken?: string,
  origin: string | null = APP_ORIGIN
): Request {
  const headers = new Headers();
  if (cookieToken) {
    headers.set('Cookie', `${AUTHZ_SESSION_COOKIE_NAME}=${encodeURIComponent(cookieToken)}`);
  }
  if (origin !== null) {
    headers.set('Origin', origin);
  }
  return new Request(`${APP_ORIGIN}${pathname}`, { method, headers });
}

test('Cenário 1: Default Deny em USER autenticado sem grants (rotas Web, API e não registradas retornam 403)', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { userAuthzVersion } = await seedFixtureIdentities(rawSqlite, db);

  const userToken = await signCompactSessionCookie(
    { userId: 'usr_user_01', tokenAuthzVersion: userAuthzVersion },
    TEST_SESSION_SECRET
  );

  const webRes = await authzEdgeMiddleware(
    makeAuthedRequest('/planejamento', 'GET', userToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(webRes.allowed, false);
  assert.equal(webRes.response?.status, 403);

  const apiReadRes = await authzEdgeMiddleware(
    makeAuthedRequest('/api/workspace', 'GET', userToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(apiReadRes.allowed, false);
  assert.equal(apiReadRes.response?.status, 403);

  const apiWriteRes = await authzEdgeMiddleware(
    makeAuthedRequest('/api/workspace', 'PUT', userToken, APP_ORIGIN),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(apiWriteRes.allowed, false);
  assert.equal(apiWriteRes.response?.status, 403);

  const unregisteredRes = await authzEdgeMiddleware(
    makeAuthedRequest('/api/rota-inexistente', 'GET', userToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(unregisteredRes.allowed, false);
  assert.equal(unregisteredRes.response?.status, 403);
});

test('Cenário 2: USER com grant restrito recebe apenas as capabilities concedidas (PBAC + UX Defensiva)', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { superSession } = await seedFixtureIdentities(rawSqlite, db);

  // Concede apenas 'read' em 'op:romaneio'
  const grantRes = await grantPagePermission(
    db,
    superSession,
    { targetUserId: 'usr_user_01', pageKey: 'op:romaneio', action: 'read' },
    { reason: 'Conferente precisa visualizar romaneios' }
  );

  const userToken = await signCompactSessionCookie(
    { userId: 'usr_user_01', tokenAuthzVersion: grantRes.newAuthzVersion },
    TEST_SESSION_SECRET
  );

  // Leitura em /manifestos/:id permitida
  const allowedManifestRead = await authzEdgeMiddleware(
    makeAuthedRequest('/manifestos/rom_2026_99', 'GET', userToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(allowedManifestRead.allowed, true);
  if (allowedManifestRead.allowed && allowedManifestRead.channel === 'PROTECTED') {
    assert.equal(allowedManifestRead.params.id, 'rom_2026_99');
  }

  // Ação 'execute' no mesmo módulo op:romaneio continua negada (403)
  const deniedManifestExecute = await authzEdgeMiddleware(
    makeAuthedRequest('/api/manifestos/rom_2026_99/emitir', 'POST', userToken, APP_ORIGIN),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(deniedManifestExecute.allowed, false);
  assert.equal(deniedManifestExecute.response?.status, 403);

  // Outro módulo operacional (op:carga-3d) continua negado (403)
  const deniedOtherModule = await authzEdgeMiddleware(
    makeAuthedRequest('/planejamento', 'GET', userToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(deniedOtherModule.allowed, false);
  assert.equal(deniedOtherModule.response?.status, 403);

  // Verifica sincronia do avaliador visual de cliente (AccessBoundary)
  const caps = await getEffectiveUserCapabilities(db, {
    uid: 'usr_user_01',
    ver: grantRes.newAuthzVersion,
    jti: 'j1',
    iat: 1,
    exp: 9999999999,
  });
  const clientState = {
    userId: 'usr_user_01',
    role: caps.role,
    status: caps.status,
    authzVersion: caps.authzVersion,
    grants: caps.grants,
  };
  assert.equal(canAccessClientModule(clientState, 'op:romaneio', 'read'), true);
  assert.equal(canAccessClientModule(clientState, 'op:romaneio', 'execute'), false);
  assert.equal(canAccessClientModule(clientState, 'gov:usuarios', 'read'), false);
});

test('Cenário 3: ADMIN possui acesso total em OPERATIONS e recebe 403 estrito em GOVERNANCE', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { adminAuthzVersion } = await seedFixtureIdentities(rawSqlite, db);

  const adminToken = await signCompactSessionCookie(
    { userId: 'usr_admin_01', tokenAuthzVersion: adminAuthzVersion },
    TEST_SESSION_SECRET
  );

  // Operações liberadas (read, write, execute)
  for (const [pathUrl, method] of [
    ['/planejamento', 'GET'],
    ['/api/workspace', 'PUT'],
    ['/api/manifestos/rom_01/emitir', 'POST'],
  ] as const) {
    const res = await authzEdgeMiddleware(
      makeAuthedRequest(pathUrl, method, adminToken, APP_ORIGIN),
      { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
    );
    assert.equal(res.allowed, true, `ADMIN deveria acessar ${method} ${pathUrl}`);
  }

  // Governança estritamente bloqueada com 403
  for (const [govPath, method] of [
    ['/governanca/usuarios', 'GET'],
    ['/governanca/permissoes', 'GET'],
    ['/governanca/auditoria', 'GET'],
    ['/api/governance/users', 'GET'],
    ['/api/governance/permissions', 'POST'],
  ] as const) {
    const res = await authzEdgeMiddleware(
      makeAuthedRequest(govPath, method, adminToken, APP_ORIGIN),
      { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
    );
    assert.equal(res.allowed, false, `ADMIN jamais pode acessar ${govPath}`);
    assert.equal(res.response?.status, 403);
  }
});

test('Cenário 4: Bloqueio de escalada vertical/horizontal, CSRF Origin e proibição de ACL em GOVERNANCE', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { superSession, adminAuthzVersion, userAuthzVersion } = await seedFixtureIdentities(
    rawSqlite,
    db
  );

  const adminClaims = {
    uid: 'usr_admin_01',
    ver: adminAuthzVersion,
    jti: 'adm1',
    iat: 1,
    exp: 9999999999,
  };
  const userClaims = {
    uid: 'usr_user_01',
    ver: userAuthzVersion,
    jti: 'usr1',
    iat: 1,
    exp: 9999999999,
  };

  // Escalada vertical: ADMIN tentando promover a si mesmo para SUPER_ADMIN falha com 403
  await assert.rejects(
    () =>
      updateUserRole(db, adminClaims, 'usr_admin_01', 'SUPER_ADMIN', {
        reason: 'Tentativa maliciosa de auto-promoção',
      }),
    (err: unknown) => err instanceof AuthzError && err.status === 403
  );

  // Escalada vertical: USER tentando se autoconceder ACL falha com 403
  await assert.rejects(
    () =>
      grantPagePermission(
        db,
        userClaims,
        { targetUserId: 'usr_user_01', pageKey: 'op:carga-3d', action: 'write' },
        { reason: 'Auto-grant ilegítimo' }
      ),
    (err: unknown) => err instanceof AuthzError && err.status === 403
  );

  // Proibição estrutural: nem mesmo SUPER_ADMIN pode delegar página GOVERNANCE via ACL para USER
  await assert.rejects(
    () =>
      grantPagePermission(
        db,
        superSession,
        { targetUserId: 'usr_user_01', pageKey: 'gov:usuarios', action: 'read' },
        { reason: 'Tentativa inválida de delegar governança' }
      ),
    (err: unknown) =>
      err instanceof AuthzError &&
      err.status === 403 &&
      err.code === 'PRIVILEGE_ESCALATION_FORBIDDEN'
  );

  // Proteção CSRF no Edge: SUPER_ADMIN com Origin malicioso ou ausente em mutação recebe 403
  const superToken = await signCompactSessionCookie(
    { userId: 'usr_super_01', tokenAuthzVersion: 1 },
    TEST_SESSION_SECRET
  );
  const csrfCrossOriginRes = await authzEdgeMiddleware(
    makeAuthedRequest(
      '/api/governance/users/usr_user_01/role',
      'PATCH',
      superToken,
      'https://attacker.evil.example'
    ),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(csrfCrossOriginRes.allowed, false);
  assert.equal(csrfCrossOriginRes.response?.status, 403);

  const csrfMissingOriginRes = await authzEdgeMiddleware(
    makeAuthedRequest('/api/governance/users/usr_user_01/role', 'PATCH', superToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(csrfMissingOriginRes.allowed, false);
  assert.equal(csrfMissingOriginRes.response?.status, 403);
});

test('Cenário 5: Invalidação síncrona imediata após incremento de authz_version e rejeição de ACLs no cookie', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { superSession } = await seedFixtureIdentities(rawSqlite, db);

  const grantRes = await grantPagePermission(
    db,
    superSession,
    { targetUserId: 'usr_user_01', pageKey: 'op:balanca', action: 'read' },
    { reason: 'Acesso temporário à balança' }
  );

  const tokenBeforeRevoke = await signCompactSessionCookie(
    { userId: 'usr_user_01', tokenAuthzVersion: grantRes.newAuthzVersion },
    TEST_SESSION_SECRET
  );

  // Requisição funciona enquanto authz_version coincide
  const okBefore = await authzEdgeMiddleware(
    makeAuthedRequest('/balanca', 'GET', tokenBeforeRevoke, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(okBefore.allowed, true);

  // Revogação incrementa authz_version atomicamente em db.batch()
  await revokePagePermission(
    db,
    superSession,
    { targetUserId: 'usr_user_01', pageKey: 'op:balanca', action: 'read' },
    { reason: 'Fim do turno operacional' }
  );

  // O mesmo cookie é imediatamente rejeitado com 401 + limpeza do cookie
  const afterRevoke = await authzEdgeMiddleware(
    makeAuthedRequest('/balanca', 'GET', tokenBeforeRevoke, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(afterRevoke.allowed, false);
  assert.equal(afterRevoke.response?.status, 401);
  assert.match(afterRevoke.response?.headers.get('Set-Cookie') ?? '', /Max-Age=0/);

  // Cookie forjado contendo array de ACLs embutido é rejeitado por FORBIDDEN_CLAIMS_IN_COOKIE
  const encoder = new TextEncoder();
  const badPayload = btoa(
    JSON.stringify({
      uid: 'usr_user_01',
      ver: 1,
      jti: 'x',
      iat: 1,
      exp: 9999999999,
      permissions: ['op:balanca:read'],
    })
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(TEST_SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(badPayload))
  );
  const sigB64 = btoa(String.fromCharCode(...sig))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const verifyBadCookie = await verifyCompactSessionCookie(
    `v1.${badPayload}.${sigB64}`,
    TEST_SESSION_SECRET
  );
  assert.equal(verifyBadCookie.valid, false);
  assert.equal(verifyBadCookie.errorCode, 'FORBIDDEN_CLAIMS_IN_COOKIE');
});

test('Cenário 6: Rejeição atômica da suspensão, rebaixamento ou exclusão do último SUPER_ADMIN ativo e imutabilidade de audit_logs', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { superSession } = await seedFixtureIdentities(rawSqlite, db);

  // Tentativa de suspender o único SUPER_ADMIN falha com 409
  await assert.rejects(
    () =>
      updateUserStatus(db, superSession, 'usr_super_01', 'SUSPENDED', {
        reason: 'Tentativa acidental de auto-suspensão',
      }),
    (err: unknown) =>
      err instanceof AuthzError &&
      err.status === 409 &&
      err.code === 'LAST_SUPER_ADMIN_INVARIANT'
  );

  // Tentativa de rebaixar o único SUPER_ADMIN para ADMIN falha com 409
  await assert.rejects(
    () =>
      updateUserRole(db, superSession, 'usr_super_01', 'ADMIN', {
        reason: 'Tentativa acidental de rebaixamento',
      }),
    (err: unknown) =>
      err instanceof AuthzError &&
      err.status === 409 &&
      err.code === 'LAST_SUPER_ADMIN_INVARIANT'
  );

  // Tentativa de DELETE direto no SQLite é abortada pelo Trigger D1 de defesa em profundidade
  assert.throws(
    () => {
      rawSqlite.exec(`DELETE FROM users WHERE id = 'usr_super_01'`);
    },
    /LAST_SUPER_ADMIN_INVARIANT/
  );

  // Tentativa de UPDATE ou DELETE em audit_logs é abortada pelos Triggers de imutabilidade
  assert.throws(
    () => {
      rawSqlite.exec(`UPDATE audit_logs SET reason = 'adulterado'`);
    },
    /AUDIT_LOG_IMMUTABLE/
  );
  assert.throws(
    () => {
      rawSqlite.exec(`DELETE FROM audit_logs`);
    },
    /AUDIT_LOG_IMMUTABLE/
  );
});

test('Cenário 7: Resiliência a IDOR (posse/tenant) e Route Tampering (traversal, encoding e case)', async () => {
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  const { superSession } = await seedFixtureIdentities(rawSqlite, db);

  const grantRes = await grantPagePermission(
    db,
    superSession,
    { targetUserId: 'usr_user_01', pageKey: 'op:cargas', action: 'write' },
    { reason: 'Operador pode editar apenas suas próprias cargas' }
  );

  const userClaims = {
    uid: 'usr_user_01',
    ver: grantRes.newAuthzVersion,
    jti: 'j_idor',
    iat: 1,
    exp: 9999999999,
  };

  // Acesso ao próprio recurso no mesmo tenant: permitido
  const ownAccess = await requireResourceAccess(
    db,
    userClaims,
    {
      resourceType: 'load',
      resourceId: 'load_propria_01',
      ownerId: 'usr_user_01',
      tenantId: 'tenant_matriz',
    },
    { pageKey: 'op:cargas', requiredAction: 'write' }
  );
  assert.equal(ownAccess.id, 'usr_user_01');

  // IDOR horizontal: USER tentando alterar carga pertencente a usr_admin_01 -> 403
  await assert.rejects(
    () =>
      requireResourceAccess(
        db,
        userClaims,
        {
          resourceType: 'load',
          resourceId: 'load_alheia_99',
          ownerId: 'usr_admin_01',
          tenantId: 'tenant_matriz',
        },
        { pageKey: 'op:cargas', requiredAction: 'write' }
      ),
    (err: unknown) =>
      err instanceof AuthzError &&
      err.status === 403 &&
      err.code === 'IDOR_RESOURCE_FORBIDDEN'
  );

  // Isolamento multi-tenant: ADMIN tentando acessar recurso de outro tenant -> 403
  await assert.rejects(
    () =>
      requireResourceAccess(
        db,
        { uid: 'usr_admin_01', ver: 3, jti: 'adm_t', iat: 1, exp: 9999999999 },
        {
          resourceType: 'load',
          resourceId: 'load_filial_externa',
          ownerId: 'usr_outro',
          tenantId: 'tenant_filial_sul',
        },
        { pageKey: 'op:cargas', requiredAction: 'read', allowSameTenantAdmin: true }
      ),
    (err: unknown) =>
      err instanceof AuthzError &&
      err.status === 403 &&
      err.code === 'IDOR_RESOURCE_FORBIDDEN'
  );

  // Route Tampering: barras codificadas, path traversal, double slash e bypass de capitalização
  const userToken = await signCompactSessionCookie(
    { userId: 'usr_user_01', tokenAuthzVersion: grantRes.newAuthzVersion },
    TEST_SESSION_SECRET
  );

  for (const tamperedPath of [
    '/cargas/..%2fgovernanca%2fusuarios',
    '/api//workspace',
    '/manifestos/id%00malicioso',
    '/manifestos/id%5c..',
  ]) {
    const res = await authzEdgeMiddleware(
      new Request(`${APP_ORIGIN}${tamperedPath}`, {
        method: 'GET',
        headers: { Cookie: `${AUTHZ_SESSION_COOKIE_NAME}=${userToken}` },
      }),
      { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
    );
    assert.equal(res.allowed, false, `Deveria bloquear path adulterado: ${tamperedPath}`);
    assert.equal(res.response?.status, 400);
  }

  // Case tampering em rota de governança (/GOVERNANCA/USUARIOS) ainda cai na regra GOVERNANCE e nega com 403
  const caseTamperRes = await authzEdgeMiddleware(
    makeAuthedRequest('/GOVERNANCA/USUARIOS', 'GET', userToken, null),
    { DB: db, SESSION_SECRET: TEST_SESSION_SECRET }
  );
  assert.equal(caseTamperRes.allowed, false);
  assert.equal(caseTamperRes.response?.status, 403);
});

test('Cenário 8: Preservação estrita do fluxo M2M em POST /api/scans (isolado de sessão humana)', async () => {
  resetEdgeSecurityCachesForTests();
  const { db, rawSqlite } = createInMemoryD1FromMigration();
  await seedFixtureIdentities(rawSqlite, db);

  const superCookie = await signCompactSessionCookie(
    { userId: 'usr_super_01', tokenAuthzVersion: 1 },
    TEST_SESSION_SECRET
  );

  const m2mSecret = 'm2m-collector-secret-isolated-2026';
  const dispositivoId = 'ZEBRA-MC9300-DOCA1';
  const barcode = 'SSCC-5544332211';
  const idempotencyKey = await computeIdempotencyKeyWindow(dispositivoId, barcode, 3000);
  const queued: unknown[] = [];

  const scanEnv: ScanRouteEnv = {
    M2M_JWT_SECRET: m2mSecret,
    WMS_SCANS_QUEUE: {
      async send(msg) {
        queued.push(msg);
      },
    },
  };

  const scanBody = JSON.stringify({
    barcode,
    palletId: generateUlid(),
    localId: generateUlid(),
    tipoEvento: 'ENTRADA',
    operadorId: 'usr_operador_01',
    dispositivoId,
    scannedAtIso: new Date().toISOString(),
    idempotencyKey,
  });

  // 1. O middleware humano passa POST /api/scans em M2M_BYPASS mesmo SEM cookie humano e SEM Origin navegador
  const reqWithoutHumanSession = new Request(`${APP_ORIGIN}/api/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: scanBody,
  });
  const mwPass = await authzEdgeMiddleware(reqWithoutHumanSession, {
    DB: db,
    SESSION_SECRET: TEST_SESSION_SECRET,
  });
  assert.equal(mwPass.allowed, true);
  if (mwPass.allowed) {
    assert.equal(mwPass.channel, 'M2M_BYPASS');
  }

  // 2. Um cookie humano de SUPER_ADMIN NÃO substitui o Service Token M2M em POST /api/scans (retorna 401)
  const humanAttemptOnM2M = await handleScanIngest(
    new Request(`${APP_ORIGIN}/api/scans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `${AUTHZ_SESSION_COOKIE_NAME}=${superCookie}`,
      },
      body: scanBody,
    }),
    scanEnv
  );
  assert.equal(humanAttemptOnM2M.status, 401);
  assert.equal(queued.length, 0);

  // 3. Com JWT M2M válido (scopes: ['scanner:ingest']), POST /api/scans retorna 202 Accepted normalmente
  const nowSec = Math.floor(Date.now() / 1000);
  const collectorJwt = await signCollectorM2MToken(
    {
      sub: dispositivoId,
      scopes: ['scanner:ingest'],
      iat: nowSec,
      exp: nowSec + 300,
      iss: 'wms-edge',
    },
    m2mSecret
  );

  const validM2MRes = await handleScanIngest(
    new Request(`${APP_ORIGIN}/api/scans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${collectorJwt}`,
      },
      body: scanBody,
    }),
    scanEnv
  );
  assert.equal(validM2MRes.status, 202);
  assert.equal(queued.length, 1);
});
