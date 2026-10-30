import type { QueuedScanMessage } from '@/lib/validation';

export interface CloudflareRateLimitResult {
  success: boolean;
}

export interface CloudflareRateLimiterBinding {
  limit(options: { key: string }): Promise<CloudflareRateLimitResult>;
}

export interface CloudflareEnv {
  WMS_SCANS_QUEUE: Queue<QueuedScanMessage>;
  WMS_SCANS_DLQ: Queue<QueuedScanMessage>;
  WMS_DEDUP_KV: KVNamespace;
  SCANNER_RATE_LIMITER?: CloudflareRateLimiterBinding;
  M2M_JWT_SECRET: string;
  CF_ACCESS_SERVICE_TOKEN_ID?: string;
  CF_ACCESS_SERVICE_TOKEN_SECRET?: string;
  DATABASE_URL?: string;
}

