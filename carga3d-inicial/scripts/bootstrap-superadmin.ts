import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPasswordWebCrypto } from '../lib/auth-session.ts';
import { SYSTEM_PAGES_CATALOG } from '../lib/authz/route-registry.ts';
import { generateUlid } from '../lib/ulid.ts';

function sqlEscapeLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function readRequiredEnv(name: string): string {
  const val = process.env[name]?.trim();
  if (!val) {
    throw new Error(
      `[Bootstrap Abortado] Variável de ambiente obrigatória ausente: ${name}. ` +
        `Nunca codifique credenciais diretamente no código.`
    );
  }
  return val;
}

export function buildBootstrapSuperAdminSql(params: {
  userId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  tenantId: string;
  auditId: string;
  requestId: string;
  nowIso: string;
}): string {
  const pageValues = SYSTEM_PAGES_CATALOG.map(
    (p) =>
      `(${sqlEscapeLiteral(p.pageKey)}, ${sqlEscapeLiteral(p.name)}, ${sqlEscapeLiteral(
        p.category
      )}, ${sqlEscapeLiteral(p.routeTemplate)}, ${sqlEscapeLiteral(params.nowIso)})`
  ).join(',\n  ');

  const afterStateJson = JSON.stringify({
    email: params.email,
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    tenantId: params.tenantId,
  });

  return [
    'PRAGMA foreign_keys = ON;',
    `INSERT OR IGNORE INTO system_pages (page_key, name, category, route_template, created_at) VALUES\n  ${pageValues};`,
    `INSERT INTO users (
      id, email, display_name, full_name, password_hash,
      role, status, authz_version, tenant_id, created_at, updated_at
    ) VALUES (
      ${sqlEscapeLiteral(params.userId)},
      ${sqlEscapeLiteral(params.email)},
      ${sqlEscapeLiteral(params.displayName)},
      ${sqlEscapeLiteral(params.displayName)},
      ${sqlEscapeLiteral(params.passwordHash)},
      'SUPER_ADMIN',
      'ACTIVE',
      1,
      ${sqlEscapeLiteral(params.tenantId)},
      ${sqlEscapeLiteral(params.nowIso)},
      ${sqlEscapeLiteral(params.nowIso)}
    )
    ON CONFLICT(email) DO UPDATE SET
      display_name = excluded.display_name,
      password_hash = excluded.password_hash,
      role = 'SUPER_ADMIN',
      status = 'ACTIVE',
      authz_version = users.authz_version + 1,
      updated_at = excluded.updated_at;`,
    `INSERT INTO audit_logs (
      id, actor_id, target_user_id, action, before_state, after_state,
      reason, ip_address, request_id, created_at
    ) VALUES (
      ${sqlEscapeLiteral(params.auditId)},
      'SYSTEM_BOOTSTRAP',
      (SELECT id FROM users WHERE email = ${sqlEscapeLiteral(params.email)} LIMIT 1),
      'BOOTSTRAP_SUPERADMIN_UPSERT',
      NULL,
      ${sqlEscapeLiteral(afterStateJson)},
      'Provisionamento determinístico via scripts/bootstrap-superadmin.ts',
      '127.0.0.1',
      ${sqlEscapeLiteral(params.requestId)},
      ${sqlEscapeLiteral(params.nowIso)}
    );`,
  ].join('\n\n');
}

async function main(): Promise<void> {
  const email = readRequiredEnv('BOOTSTRAP_SUPERADMIN_EMAIL').toLowerCase();
  const displayName = readRequiredEnv('BOOTSTRAP_SUPERADMIN_NAME');
  const rawPassword = readRequiredEnv('BOOTSTRAP_SUPERADMIN_PASSWORD');
  const tenantId = process.env.BOOTSTRAP_TENANT_ID?.trim() || 'default';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('BOOTSTRAP_SUPERADMIN_EMAIL possui formato inválido.');
  }
  if (rawPassword.length < 12) {
    throw new Error('BOOTSTRAP_SUPERADMIN_PASSWORD deve possuir no mínimo 12 caracteres.');
  }

  const isRemote = process.argv.includes('--remote');
  const d1DatabaseBinding = process.env.D1_BINDING_NAME?.trim() || 'DB';
  const configFile =
    process.env.WRANGLER_CONFIG?.trim() ||
    (isRemote ? 'dist/server/wrangler.json' : 'wrangler.local.jsonc');

  const passwordHash = await hashPasswordWebCrypto(rawPassword);
  const nowIso = new Date().toISOString();
  const sqlContent = buildBootstrapSuperAdminSql({
    userId: `usr_sa_${generateUlid()}`,
    email,
    displayName,
    passwordHash,
    tenantId,
    auditId: generateUlid(),
    requestId: `boot_${generateUlid()}`,
    nowIso,
  });

  const tempSqlPath = path.join(os.tmpdir(), `c3d-bootstrap-sa-${Date.now()}.sql`);
  fs.writeFileSync(tempSqlPath, sqlContent, { encoding: 'utf-8', mode: 0o600 });

  try {
    const wranglerCli = fileURLToPath(
      new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)
    );
    const wranglerArgs = [
      wranglerCli,
      'd1',
      'execute',
      d1DatabaseBinding,
      isRemote ? '--remote' : '--local',
      '--config',
      configFile,
      ...(isRemote ? [] : ['--persist-to', '.wrangler/state']),
      '--file',
      tempSqlPath,
    ];

    const execResult = spawnSync(process.execPath, wranglerArgs, { stdio: 'inherit' });
    if (execResult.error) {
      throw execResult.error;
    }
    if (execResult.status !== 0) {
      throw new Error(`Wrangler encerrou com status ${execResult.status}.`);
    }

    console.log(`[OK] SUPER_ADMIN '${email}' provisionado e auditado com sucesso.`);
  } finally {
    if (fs.existsSync(tempSqlPath)) {
      fs.unlinkSync(tempSqlPath);
    }
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

