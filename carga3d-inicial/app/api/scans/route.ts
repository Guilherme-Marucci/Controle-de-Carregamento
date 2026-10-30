import { ScanIngestRequestSchema, type QueuedScanMessage } from '../../../lib/validation.ts';
import { verifyCollectorM2MToken, type CollectorAuthEnv } from '../../../lib/auth-session.ts';
import {
  enforceDeviceRateLimit,
  checkAndLockIdempotencyKey,
  type EdgeSecurityEnv,
} from '../../../lib/edge-security.ts';
import { generateUlid } from '../../../lib/ulid.ts';

export const runtime = 'edge';

export interface ScanProducerQueue {
  send(message: QueuedScanMessage, options?: { contentType?: 'json' }): Promise<void>;
}

export interface ScanRouteEnv extends CollectorAuthEnv, EdgeSecurityEnv {
  WMS_SCANS_QUEUE: ScanProducerQueue;
}

const fallbackLocalQueueBuffer: QueuedScanMessage[] = [];

function resolveDefaultRouteEnv(): ScanRouteEnv {
  return {
    M2M_JWT_SECRET:
      process.env.M2M_JWT_SECRET ?? 'dev-carga3d-local-m2m-scanner-secret-key',
    WMS_SCANS_QUEUE: {
      async send(msg: QueuedScanMessage) {
        fallbackLocalQueueBuffer.push(msg);
      },
    },
  };
}

/**
 * Handler central de ingestão de eventos de scanner no Edge (< 30ms).
 * Aceita env injetável para testes determinísticos ou resolve o binding do Worker em produção.
 */
export async function handleScanIngest(
  request: Request,
  env: ScanRouteEnv = resolveDefaultRouteEnv()
): Promise<Response> {
  const startedAt = performance.now();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json(
      { error: 'INVALID_JSON', message: 'Corpo da requisição malformado.' },
      { status: 400 }
    );
  }

  const parsed = ScanIngestRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      {
        error: 'VALIDATION_ERROR',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 422 }
    );
  }

  const payload = parsed.data;

  // 1. Rate Limiting por Dispositivo Coletor
  const rateLimit = await enforceDeviceRateLimit(env, payload.dispositivoId);
  if (!rateLimit.allowed) {
    return Response.json(
      {
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Limite de leituras por segundo excedido para este coletor.',
      },
      {
        status: 429,
        headers: { 'Retry-After': '5' },
      }
    );
  }

  // 2. Autenticação M2M de Baixo Custo com escopo estrito 'scanner:ingest'
  const auth = await verifyCollectorM2MToken(request, env, payload.dispositivoId);
  if (!auth.authenticated) {
    const status =
      auth.errorCode === 'INSUFFICIENT_SCOPE' || auth.errorCode === 'DEVICE_MISMATCH'
        ? 403
        : 401;
    return Response.json({ error: auth.errorCode ?? 'UNAUTHORIZED' }, { status });
  }

  // 3. Deduplicação em Cache Rápido / KV (Idempotency Key de 3s)
  const dedup = await checkAndLockIdempotencyKey(
    env,
    payload.dispositivoId,
    payload.barcode,
    payload.idempotencyKey
  );

  if (dedup.isDuplicate) {
    const elapsedDuplicateMs = Number((performance.now() - startedAt).toFixed(2));
    return Response.json(
      {
        status: 'DEDUPLICATED',
        idempotencyKey: dedup.canonicalKey,
        latencyMs: elapsedDuplicateMs,
      },
      { status: 202 }
    );
  }

  // 4. Enfileiramento Assíncrono na Cloudflare Queue
  const eventoId = generateUlid();
  const queueMessage: QueuedScanMessage = {
    ...payload,
    idempotencyKey: dedup.canonicalKey,
    eventoId,
    enqueuedAtIso: new Date().toISOString(),
  };

  await env.WMS_SCANS_QUEUE.send(queueMessage, { contentType: 'json' });

  const latencyMs = Number((performance.now() - startedAt).toFixed(2));

  return Response.json(
    {
      status: 'ACCEPTED',
      eventoId,
      idempotencyKey: dedup.canonicalKey,
      latencyMs,
    },
    {
      status: 202,
      headers: {
        'X-Edge-Latency-Ms': String(latencyMs),
        'X-Idempotency-Key': dedup.canonicalKey,
      },
    }
  );
}

export async function POST(request: Request): Promise<Response> {
  return handleScanIngest(request);
}
