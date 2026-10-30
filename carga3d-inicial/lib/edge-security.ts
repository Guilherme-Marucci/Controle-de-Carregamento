export interface DedupKvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface EdgeSecurityEnv {
  WMS_DEDUP_KV?: DedupKvStore;
  SCANNER_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

/**
 * Mapa em memória do Isolate V8 para absorver rajadas sub-milissegundo (Race Condition local)
 * antes mesmo do roundtrip para o Cloudflare KV.
 */
const isolateDedupCache = new Map<string, number>();
const isolateRateWindow = new Map<string, { count: number; resetAt: number }>();

export function resetEdgeSecurityCachesForTests(): void {
  isolateDedupCache.clear();
  isolateRateWindow.clear();
}

function pruneIsolateCache(now: number): void {
  if (isolateDedupCache.size > 5000) {
    for (const [key, expiresAt] of isolateDedupCache.entries()) {
      if (expiresAt <= now) {
        isolateDedupCache.delete(key);
      }
    }
  }
}

/**
 * Calcula SHA-256 sobre a tupla (dispositivoId + barcode + janela_tempo_3s)
 */
export async function computeIdempotencyKeyWindow(
  dispositivoId: string,
  barcode: string,
  windowMs = 3000,
  nowMs: number = Date.now()
): Promise<string> {
  const timeBucket = Math.floor(nowMs / windowMs);
  const rawMaterial = `${dispositivoId}:${barcode}:${timeBucket}`;
  const encoder = new TextEncoder();
  const digestBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(rawMaterial));
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Rate Limiting por Dispositivo Coletor (Ex: máx 30 leituras por janela de 10 segundos por coletor)
 */
export async function enforceDeviceRateLimit(
  env: EdgeSecurityEnv,
  dispositivoId: string,
  maxScansPer10s = 30
): Promise<{ allowed: boolean; remaining: number }> {
  if (env.SCANNER_RATE_LIMITER) {
    const { success } = await env.SCANNER_RATE_LIMITER.limit({
      key: `dev:${dispositivoId}`,
    });
    return { allowed: success, remaining: success ? 1 : 0 };
  }

  const now = Date.now();
  const windowMs = 10_000;
  const current = isolateRateWindow.get(dispositivoId);

  if (!current || current.resetAt <= now) {
    isolateRateWindow.set(dispositivoId, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxScansPer10s - 1 };
  }

  if (current.count >= maxScansPer10s) {
    return { allowed: false, remaining: 0 };
  }

  current.count += 1;
  return { allowed: true, remaining: maxScansPer10s - current.count };
}

/**
 * Deduplicação server-side da idempotency_key (calculada como SHA-256 de dispositivoId + barcode + janela_3s).
 * Combina verificação imediata em memória do Isolate com persistência no Cloudflare KV (TTL mín. 60s).
 */
export async function checkAndLockIdempotencyKey(
  env: EdgeSecurityEnv,
  dispositivoId: string,
  barcode: string,
  clientIdempotencyKey: string
): Promise<{ isDuplicate: boolean; canonicalKey: string }> {
  const now = Date.now();
  pruneIsolateCache(now);

  const serverKey = await computeIdempotencyKeyWindow(dispositivoId, barcode, 3000, now);
  const keysToCheck =
    clientIdempotencyKey === serverKey
      ? [serverKey]
      : [clientIdempotencyKey, serverKey];

  for (const key of keysToCheck) {
    const memExpiry = isolateDedupCache.get(key);
    if (memExpiry && memExpiry > now) {
      return { isDuplicate: true, canonicalKey: key };
    }
  }

  for (const key of keysToCheck) {
    isolateDedupCache.set(key, now + 3000);
  }

  if (env.WMS_DEDUP_KV) {
    const kvKey = `idemp:${clientIdempotencyKey}`;
    const existingInKv = await env.WMS_DEDUP_KV.get(kvKey);
    if (existingInKv !== null) {
      return { isDuplicate: true, canonicalKey: clientIdempotencyKey };
    }
    await env.WMS_DEDUP_KV.put(kvKey, String(now), { expirationTtl: 60 });
  }

  return { isDuplicate: false, canonicalKey: clientIdempotencyKey };
}

