'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PosicaoAtualPalletDTO } from '../lib/db/projections.ts';

export interface Pallet3DNode {
  id: string;
  label: string;
  sku: string;
  zone: PosicaoAtualPalletDTO['tipoZona'];
  position: readonly [number, number, number];
  updatedAt: number;
}

/**
 * Hook de estado derivado para consumo estrito pelo componente 3D (app/scene.tsx).
 * Mantém app/scene.tsx 100% desacoplado de sockets brutos, SQL ou payloads de scanner.
 */
export function usePalletPositions(pollIntervalMs = 2500) {
  const [nodes, setNodes] = useState<readonly Pallet3DNode[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshot = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/pallets/snapshot', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal,
      });

      if (!response.ok) {
        throw new Error(`Falha ao sincronizar estado derivado: HTTP ${response.status}`);
      }

      const data = (await response.json()) as { items: PosicaoAtualPalletDTO[] };
      const mapped: Pallet3DNode[] = data.items.map((item) => ({
        id: item.palletId,
        label: item.etiquetaBarcode,
        sku: item.skuCodigo,
        zone: item.tipoZona,
        position: [item.coordenadaX, item.coordenadaY, item.coordenadaZ] as const,
        updatedAt: Date.parse(item.ultimoTimestampUtc),
      }));

      setNodes(mapped);
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSnapshot(controller.signal);

    const timer = setInterval(() => {
      void fetchSnapshot(controller.signal);
    }, pollIntervalMs);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [fetchSnapshot, pollIntervalMs]);

  return { nodes, isLoading, error, refresh: () => void fetchSnapshot() };
}

