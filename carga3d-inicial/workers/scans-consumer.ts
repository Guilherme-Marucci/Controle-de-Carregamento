import type { NovoEventoMovimentacao } from '../lib/db/schema.ts';
import { QueuedScanMessageSchema, type QueuedScanMessage } from '../lib/validation.ts';

const MAX_RETRIES = 3;

export interface ConsumerMessage<T = unknown> {
  readonly id: string;
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export interface ConsumerBatch<T = unknown> {
  readonly queue: string;
  readonly messages: readonly ConsumerMessage<T>[];
}

export interface BatchMovementWriter {
  insertIgnoreBatch(rows: readonly NovoEventoMovimentacao[]): Promise<void>;
  close(): Promise<void>;
}

export interface ScansConsumerEnv {
  WMS_SCANS_DLQ: {
    send(body: unknown): Promise<void>;
  };
  createBatchWriter: () => Promise<BatchMovementWriter>;
}

export function calculateBackoffSeconds(attempts: number): number {
  return Math.min(30, Math.pow(2, attempts) * 2);
}

/**
 * Consumer Worker da Cloudflare Queue:
 * Agrupa múltiplos eventos em um único INSERT IGNORE em lote para evitar saturação de conexões MySQL
 * e encaminha mensagens corrompidas ou com falhas exauridas para a Dead Letter Queue (DLQ).
 */
export async function processScansQueueBatch(
  batch: ConsumerBatch<QueuedScanMessage>,
  env: ScansConsumerEnv
): Promise<{ insertedCount: number; dlqCount: number; retriedCount: number }> {
  const validMessages: ConsumerMessage<QueuedScanMessage>[] = [];
  const rowsToInsert: NovoEventoMovimentacao[] = [];
  let dlqCount = 0;
  let retriedCount = 0;

  for (const msg of batch.messages) {
    const validation = QueuedScanMessageSchema.safeParse(msg.body);
    if (!validation.success) {
      await env.WMS_SCANS_DLQ.send(msg.body);
      msg.ack();
      dlqCount += 1;
      continue;
    }

    const data = validation.data;
    validMessages.push(msg);
    rowsToInsert.push({
      id: data.eventoId,
      palletId: data.palletId,
      localId: data.localId,
      tipoEvento: data.tipoEvento,
      createdAt: new Date(data.scannedAtIso),
      operadorId: data.operadorId,
      dispositivoId: data.dispositivoId,
      idempotencyKey: data.idempotencyKey,
    });
  }

  if (rowsToInsert.length === 0) {
    return { insertedCount: 0, dlqCount, retriedCount };
  }

  let writer: BatchMovementWriter | null = null;
  try {
    writer = await env.createBatchWriter();
    await writer.insertIgnoreBatch(rowsToInsert);

    for (const msg of validMessages) {
      msg.ack();
    }
    return { insertedCount: rowsToInsert.length, dlqCount, retriedCount };
  } catch (error) {
    console.error('[WMS Queue Consumer] Falha ao persistir lote MySQL:', error);

    for (const msg of validMessages) {
      if (msg.attempts >= MAX_RETRIES) {
        await env.WMS_SCANS_DLQ.send(msg.body);
        msg.ack();
        dlqCount += 1;
      } else {
        msg.retry({ delaySeconds: calculateBackoffSeconds(msg.attempts) });
        retriedCount += 1;
      }
    }
    return { insertedCount: 0, dlqCount, retriedCount };
  } finally {
    if (writer) {
      await writer.close().catch(() => undefined);
    }
  }
}

