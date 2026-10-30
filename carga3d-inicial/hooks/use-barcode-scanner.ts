'use client';

import { useEffect, useRef, useCallback } from 'react';
import { HidRawScanSchema, sanitizeRawBarcode } from '../lib/validation.ts';
import { computeIdempotencyKeyWindow } from '../lib/edge-security.ts';

export interface BarcodeScanResult {
  barcode: string;
  idempotencyKey: string;
  scannedAtIso: string;
  averageKeystrokeDeltaMs: number;
}

export type ScanRejectionReason = 'HUMAN_TYPING_SPEED' | 'INVALID_PAYLOAD' | 'TOO_SHORT';

export interface UseBarcodeScannerOptions {
  dispositivoId: string;
  maxInterKeyDelayMs?: number;
  minBarcodeLength?: number;
  dedupWindowMs?: number;
  enabled?: boolean;
  onScanSuccess: (result: BarcodeScanResult) => void;
  onScanRejected?: (reason: ScanRejectionReason, raw: string) => void;
}

export interface KeystrokeSample {
  key: string;
  timestampMs: number;
}

/**
 * Avaliador puro do algoritmo de distinção HID vs Digitação Humana (< 50ms entre teclas consecutivas).
 * Usado tanto pelo hook React quanto pela suíte de testes defensivos.
 */
export function evaluateHidKeystrokeSequence(
  samples: readonly KeystrokeSample[],
  maxInterKeyDelayMs = 50,
  minBarcodeLength = 4
):
  | { accepted: true; barcode: string; averageKeystrokeDeltaMs: number }
  | { accepted: false; reason: ScanRejectionReason; raw: string } {
  let buffer = '';
  const deltas: number[] = [];
  let lastTimestamp = 0;

  for (const sample of samples) {
    if (sample.key === 'Shift' || sample.key === 'CapsLock') {
      continue;
    }

    if (lastTimestamp > 0) {
      const delta = sample.timestampMs - lastTimestamp;
      if (delta <= 0 || delta >= maxInterKeyDelayMs) {
        return {
          accepted: false,
          reason: 'HUMAN_TYPING_SPEED',
          raw: buffer + (sample.key.length === 1 ? sample.key : ''),
        };
      }
      deltas.push(delta);
    }

    if (sample.key === 'Enter' || sample.key === 'Tab') {
      if (buffer.length < minBarcodeLength) {
        return { accepted: false, reason: 'TOO_SHORT', raw: buffer };
      }

      const isHardwareSpeed =
        deltas.length > 0 && deltas.every((d) => d > 0 && d < maxInterKeyDelayMs);
      if (!isHardwareSpeed) {
        return { accepted: false, reason: 'HUMAN_TYPING_SPEED', raw: buffer };
      }

      const cleaned = sanitizeRawBarcode(buffer);
      const parsed = HidRawScanSchema.safeParse(cleaned);
      if (!parsed.success) {
        return { accepted: false, reason: 'INVALID_PAYLOAD', raw: buffer };
      }

      const avg = deltas.reduce((acc, cur) => acc + cur, 0) / deltas.length;
      return {
        accepted: true,
        barcode: parsed.data,
        averageKeystrokeDeltaMs: Number(avg.toFixed(2)),
      };
    }

    if (sample.key.length === 1) {
      buffer += sample.key;
      lastTimestamp = sample.timestampMs;
    }
  }

  return { accepted: false, reason: 'TOO_SHORT', raw: buffer };
}

export function useBarcodeScanner({
  dispositivoId,
  maxInterKeyDelayMs = 50,
  minBarcodeLength = 4,
  dedupWindowMs = 3000,
  enabled = true,
  onScanSuccess,
  onScanRejected,
}: UseBarcodeScannerOptions): void {
  const bufferRef = useRef<string[]>([]);
  const lastKeyTimeRef = useRef<number>(0);
  const deltasRef = useRef<number[]>([]);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetBuffer = useCallback(() => {
    bufferRef.current = [];
    deltasRef.current = [];
    lastKeyTimeRef.current = 0;
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const now = performance.now();
      const lastTime = lastKeyTimeRef.current;

      if (event.key === 'Shift' || event.key === 'CapsLock') {
        return;
      }

      if (lastTime > 0 && now - lastTime >= maxInterKeyDelayMs) {
        const staleCandidate = bufferRef.current.join('');
        if (staleCandidate.length >= minBarcodeLength) {
          onScanRejected?.('HUMAN_TYPING_SPEED', staleCandidate);
        }
        resetBuffer();
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        const rawCandidate = bufferRef.current.join('');
        const recordedDeltas = [...deltasRef.current];
        resetBuffer();

        if (rawCandidate.length === 0) {
          return;
        }

        if (rawCandidate.length < minBarcodeLength) {
          onScanRejected?.('TOO_SHORT', rawCandidate);
          return;
        }

        const isHardwareSpeed =
          recordedDeltas.length > 0 &&
          recordedDeltas.every((delta) => delta > 0 && delta < maxInterKeyDelayMs);

        if (!isHardwareSpeed) {
          onScanRejected?.('HUMAN_TYPING_SPEED', rawCandidate);
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const cleaned = sanitizeRawBarcode(rawCandidate);
        const parsed = HidRawScanSchema.safeParse(cleaned);

        if (!parsed.success) {
          onScanRejected?.('INVALID_PAYLOAD', rawCandidate);
          return;
        }

        const avgDelta =
          recordedDeltas.reduce((acc, cur) => acc + cur, 0) / recordedDeltas.length;
        const scannedAtIso = new Date().toISOString();

        void computeIdempotencyKeyWindow(dispositivoId, parsed.data, dedupWindowMs).then(
          (idempotencyKey) => {
            onScanSuccess({
              barcode: parsed.data,
              idempotencyKey,
              scannedAtIso,
              averageKeystrokeDeltaMs: Number(avgDelta.toFixed(2)),
            });
          }
        );
        return;
      }

      if (event.key.length === 1) {
        if (lastTime > 0) {
          deltasRef.current.push(now - lastTime);
        }
        lastKeyTimeRef.current = now;
        bufferRef.current.push(event.key);

        if (resetTimerRef.current !== null) {
          clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
          const orphan = bufferRef.current.join('');
          if (orphan.length >= minBarcodeLength) {
            onScanRejected?.('HUMAN_TYPING_SPEED', orphan);
          }
          resetBuffer();
        }, maxInterKeyDelayMs);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      resetBuffer();
    };
  }, [
    dispositivoId,
    maxInterKeyDelayMs,
    minBarcodeLength,
    dedupWindowMs,
    enabled,
    onScanSuccess,
    onScanRejected,
    resetBuffer,
  ]);
}

