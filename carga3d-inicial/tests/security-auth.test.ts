import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOKIE_SESSION_NAME,
  parseCookies,
  serializeSessionUser,
  parseSessionUser,
  PRESET_USERS,
  type ChatGPTUser
} from '../lib/auth-session.ts';
import { workspaceSchema } from '../lib/validation.ts';
import fs from 'node:fs';
import path from 'node:path';

test('Defensiva de Autenticação: parsing e serialização de sessão rejeita adulterações', () => {
  const validUser: ChatGPTUser = {
    userId: 'usr_teste_operador',
    displayName: 'Operador Teste',
    email: 'teste@operador.com.br',
    fullName: 'Operador Teste da Silva',
    role: 'Conferente'
  };

  const serialized = serializeSessionUser(validUser);
  assert.equal(serialized.startsWith('b64_'), true);

  const restored = parseSessionUser(serialized);
  assert.ok(restored);
  assert.equal(restored.userId, validUser.userId);
  assert.equal(restored.email, validUser.email);

  // Testa payload adulterado / inválido
  assert.equal(parseSessionUser('invalid_payload'), null);
  assert.equal(parseSessionUser('b64_bm90X2pzb24='), null); // string arbitrária não-JSON
  assert.equal(parseSessionUser('b64_e30='), null); // JSON vazio sem userId/email
  assert.equal(parseSessionUser(''), null);
});

test('Defensiva: PRESET_USERS contém operadores válidos e higienizados', () => {
  assert.equal(PRESET_USERS.length >= 3, true);
  for (const user of PRESET_USERS) {
    assert.match(user.userId, /^usr_[a-z0-9_]+$/);
    assert.match(user.email, /^[^@]+@[^@]+\.[^@]+$/);
    assert.ok(user.displayName.length >= 2);
  }
});

test('Defensiva contra SQL Injection: queries do workspace utilizam bind parametrizado', () => {
  const routeContent = fs.readFileSync(
    path.resolve(process.cwd(), 'app/api/workspace/route.ts'),
    'utf-8'
  );

  // Proíbe interpolação de strings em consultas SQL
  assert.equal(
    routeContent.includes('${user.userId}'),
    false,
    'Vulnerabilidade detectada: interpolação direta de user.userId no SQL!'
  );

  // Garante o uso de bind(?)
  assert.equal(
    routeContent.includes('.bind(user.userId'),
    true,
    'As consultas ao banco devem usar exclusivamente parâmetros vinculados via .bind()'
  );
});

test('Defensiva: validação do workspaceSchema bloqueia payloads corrompidos ou maliciosos', () => {
  // Payload com SQL injection em id e valores absurdos
  const maliciousTruck = {
    id: "truck' OR '1'='1",
    name: 'Caminhão Teste',
    length: 1000,
    width: 250,
    height: 250,
    doorWidth: 240,
    doorHeight: 240,
    capacity: 99999999 // Ultrapassa o máximo permitido de 30.000 kg
  };

  const validation = workspaceSchema.safeParse({
    trucks: [maliciousTruck],
    products: [],
    loads: []
  });

  assert.equal(validation.success, false, 'Schema deve rejeitar capacidades absurdas');
});

test('Defensiva de Segredos (Regra Zero): Varredura por chaves e tokens expostos', () => {
  const sensitiveFiles = ['.env-example', 'package.json', 'wrangler.local.jsonc'];
  for (const file of sensitiveFiles) {
    const fullPath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Verifica que não há tokens reais vazados
    assert.equal(/sk-[a-zA-Z0-9]{20,}/.test(content), false, `Token OpenAI detectado em ${file}`);
    assert.equal(/ghp_[a-zA-Z0-9]{20,}/.test(content), false, `Token GitHub detectado em ${file}`);
    assert.equal(/AKIA[0-9A-Z]{16}/.test(content), false, `Chave AWS detectada em ${file}`);
  }
});
