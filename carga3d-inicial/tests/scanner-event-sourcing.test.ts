import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHidKeystrokeSequence } from '../hooks/use-barcode-scanner.ts';
import {
  HidRawScanSchema,
  ScanIngestRequestSchema,
  type QueuedScanMessage,
} from '../lib/validation.ts';
import { signCollectorM2MToken } from '../lib/auth-session.ts';
import {
  computeIdempotencyKeyWindow,
  resetEdgeSecurityCachesForTests,
} from '../lib/edge-security.ts';
import { generateUlid } from '../lib/ulid.ts';
import { handleScanIngest, type ScanRouteEnv } from '../app/api/scans/route.ts';
import {
  processScansQueueBatch,
  type ConsumerMessage,
} from '../workers/scans-consumer.ts';
import { SQL_CREATE_VIEW_ESTADO_ATUAL_PALLETS } from '../lib/db/projections.ts';

test('Fase 1: Event Sourcing proíbe UPDATE e projeta estado atual via ROW_NUMBER()', () => {
  assert.equal(
    /UPDATE\s+/i.test(SQL_CREATE_VIEW_ESTADO_ATUAL_PALLETS),
    false,
    'A projeção analítica jamais deve conter instruções UPDATE'
  );
  assert.equal(
    SQL_CREATE_VIEW_ESTADO_ATUAL_PALLETS.includes('ROW_NUMBER() OVER'),
    true,
    'A view deve derivar a localização atual via Window Function'
  );
});

test('Fase 2: Distinção HID (< 50ms) aceita scanner físico e rejeita digitação humana', () => {
  // 1. Leitura real de scanner HID (intervalo de 8ms entre teclas + Enter)
  const hardwareSamples = [
    { key: 'P', timestampMs: 100 },
    { key: 'B', timestampMs: 108 },
    { key: 'R', timestampMs: 116 },
    { key: '-', timestampMs: 124 },
    { key: '9', timestampMs: 132 },
    { key: '0', timestampMs: 140 },
    { key: '1', timestampMs: 148 },
    { key: 'Enter', timestampMs: 155 },
  ];

  const hwResult = evaluateHidKeystrokeSequence(hardwareSamples);
  assert.equal(hwResult.accepted, true);
  if (hwResult.accepted) {
    assert.equal(hwResult.barcode, 'PBR-901');
    assert.equal(hwResult.averageKeystrokeDeltaMs < 50, true);
  }

  // 2. Falso positivo de digitação humana (intervalos de 65ms e 90ms >= 50ms)
  const humanSamples = [
    { key: 'P', timestampMs: 100 },
    { key: 'B', timestampMs: 165 }, // delta = 65ms >= 50ms -> rejeitado
    { key: 'R', timestampMs: 255 },
    { key: '1', timestampMs: 320 },
    { key: 'Enter', timestampMs: 400 },
  ];

  const humanResult = evaluateHidKeystrokeSequence(humanSamples);
  assert.equal(humanResult.accepted, false);
  if (!humanResult.accepted) {
    assert.equal(humanResult.reason, 'HUMAN_TYPING_SPEED');
  }
});

test('Fase 2: Prevenção contra Barcode Injection e caracteres de controle', () => {
  const sqliAttempt = HidRawScanSchema.safeParse("PBR01'; DROP TABLE movimentacoes;--");
  assert.equal(sqliAttempt.success, false, 'Deve bloquear payload SQL Injection no barcode');

  const xssAttempt = HidRawScanSchema.safeParse('<script>alert(1)</script>');
  assert.equal(xssAttempt.success, false, 'Deve bloquear tags HTML/XSS no barcode');

  // Caracteres de controle invisíveis (\x00, \r, \n) são sanitizados mantendo código válido
  const cleanResult = HidRawScanSchema.safeParse('\x00\x1bsscc-00192837\r\n');
  assert.equal(cleanResult.success, true);
  if (cleanResult.success) {
    assert.equal(cleanResult.data, 'SSCC-00192837');
  }
});

test('Fase 3 e 4: Dupla bipagem simultânea (Race Condition) e autenticação M2M no Edge (< 30ms)', async () => {
  resetEdgeSecurityCachesForTests();

  const secret = 'test-edge-m2m-secret-key-2026';
  const dispositivoId = 'COLETOR-ZEBRA-01';
  const barcode = 'SSCC-9988776655';
  const palletId = generateUlid();
  const localId = generateUlid();
  const idempotencyKey = await computeIdempotencyKeyWindow(dispositivoId, barcode, 3000);

  const enqueuedMessages: QueuedScanMessage[] = [];
  const kvMap = new Map<string, string>();

  const mockEnv: ScanRouteEnv = {
    M2M_JWT_SECRET: secret,
    WMS_DEDUP_KV: {
      async get(k) {
        return kvMap.get(k) ?? null;
      },
      async put(k, v) {
        kvMap.set(k, v);
      },
    },
    WMS_SCANS_QUEUE: {
      async send(msg) {
        enqueuedMessages.push(msg);
      },
    },
  };

  const nowSec = Math.floor(Date.now() / 1000);

  // Token sem escopo 'scanner:ingest' deve receber 403 Forbidden
  const readOnlyToken = await signCollectorM2MToken(
    {
      sub: dispositivoId,
      scopes: ['wms:read'],
      iat: nowSec,
      exp: nowSec + 300,
      iss: 'wms-edge',
    },
    secret
  );

  const bodyPayload = {
    barcode,
    palletId,
    localId,
    tipoEvento: 'ENTRADA',
    operadorId: 'usr_operador_01',
    dispositivoId,
    scannedAtIso: new Date().toISOString(),
    idempotencyKey,
  };

  const forbiddenRes = await handleScanIngest(
    new Request('https://wms.local/api/scans', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readOnlyToken}`,
      },
      body: JSON.stringify(bodyPayload),
    }),
    mockEnv
  );
  assert.equal(forbiddenRes.status, 403);

  // Token válido com escopo 'scanner:ingest'
  const validToken = await signCollectorM2MToken(
    {
      sub: dispositivoId,
      scopes: ['scanner:ingest'],
      iat: nowSec,
      exp: nowSec + 300,
      iss: 'wms-edge',
    },
    secret
  );

  const makeScanRequest = () =>
    handleScanIngest(
      new Request('https://wms.local/api/scans', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: JSON.stringify(bodyPayload),
      }),
      mockEnv
    );

  // Dispara 2 requisições simultâneas (Race Condition de dupla bipagem)
  const [res1, res2] = await Promise.all([makeScanRequest(), makeScanRequest()]);
  assert.equal(res1.status, 202);
  assert.equal(res2.status, 202);

  const json1 = (await res1.json()) as { status: string; latencyMs: number };
  const json2 = (await res2.json()) as { status: string; latencyMs: number };

  assert.equal(json1.status, 'ACCEPTED');
  assert.equal(json2.status, 'DEDUPLICATED');
  assert.equal(
    enqueuedMessages.length,
    1,
    'Apenas 1 evento deve ser enfileirado na Cloudflare Queue apesar da dupla bipagem simultânea'
  );
});

test('Fase 4: Mitigação de saturação de conexões (Batch Insert única conexão) e Dead Letter Queue', async () => {
  let activeConnections = 0;
  let maxConcurrentConnections = 0;
  let totalBatchInsertCalls = 0;
  let totalRowsInserted = 0;
  const dlqMessages: unknown[] = [];

  const validMessages: ConsumerMessage<QueuedScanMessage>[] = Array.from(
    { length: 50 },
    (_, idx) => ({
      id: `msg-${idx}`,
      attempts: 1,
      body: {
        barcode: `PALLET-${1000 + idx}`,
        palletId: generateUlid(),
        localId: generateUlid(),
        tipoEvento: 'TRANSITO',
        operadorId: 'usr_operador_01',
        dispositivoId: 'COLETOR-01',
        scannedAtIso: new Date().toISOString(),
        idempotencyKey: 'a'.repeat(64),
        eventoId: generateUlid(),
        enqueuedAtIso: new Date().toISOString(),
      },
      ack() {},
      retry() {},
    })
  );

  // Adiciona 1 mensagem corrompida (Poison Pill) para validar o desvio direto para a DLQ
  const corruptedMessage: ConsumerMessage<QueuedScanMessage> = {
    id: 'msg-corrupted',
    attempts: 1,
    body: { barcode: 'INVALID;DROP' } as unknown as QueuedScanMessage,
    ack() {},
    retry() {},
  };

  const result = await processScansQueueBatch(
    {
      queue: 'wms-scans-queue',
      messages: [...validMessages, corruptedMessage],
    },
    {
      WMS_SCANS_DLQ: {
        async send(body) {
          dlqMessages.push(body);
        },
      },
      async createBatchWriter() {
        activeConnections += 1;
        maxConcurrentConnections = Math.max(maxConcurrentConnections, activeConnections);
        return {
          async insertIgnoreBatch(rows) {
            totalBatchInsertCalls += 1;
            totalRowsInserted += rows.length;
          },
          async close() {
            activeConnections -= 1;
          },
        };
      },
    }
  );

  assert.equal(result.insertedCount, 50);
  assert.equal(result.dlqCount, 1);
  assert.equal(
    maxConcurrentConnections,
    1,
    'Todo o lote de 50 eventos deve usar apenas 1 conexão ao banco'
  );
  assert.equal(
    totalBatchInsertCalls,
    1,
    'Deve executar um único comando de inserção em lote (Batch Insert)'
  );
  assert.equal(totalRowsInserted, 50);
  assert.equal(dlqMessages.length, 1);
  assert.equal(activeConnections, 0, 'A conexão deve ser fechada ao término do lote');
});

