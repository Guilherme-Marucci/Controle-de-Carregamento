import { sql, type SQL } from 'drizzle-orm';
import type { ZonaTipo, EventoTipo } from './schema.ts';

export interface PosicaoAtualPalletDTO {
  palletId: string;
  etiquetaBarcode: string;
  skuCodigo: string;
  quantidadeUnidades: number;
  localId: string;
  codigoEndereco: string;
  tipoZona: ZonaTipo;
  coordenadaX: number;
  coordenadaY: number;
  coordenadaZ: number;
  ultimoEvento: EventoTipo;
  ultimoTimestampUtc: string;
}

export interface AnalyticalSqlExecutor {
  execute(query: SQL): Promise<[unknown[], unknown]>;
}

/**
 * DDL da View Analítica compatível com MySQL 8.0+ e conectores DirectQuery/Import do PowerBI.
 * Deriva o estado atual de cada pallet a partir do último evento (ordenado por created_at DESC, id DESC)
 * sem jamais executar UPDATE em registros existentes.
 */
export const SQL_CREATE_VIEW_ESTADO_ATUAL_PALLETS = `
CREATE OR REPLACE ALGORITHM = MERGE VIEW vw_estado_atual_pallets AS
WITH ranked_events AS (
  SELECT
    m.id AS evento_id,
    m.pallet_id,
    m.local_id,
    m.tipo_evento,
    m.created_at,
    m.operador_id,
    m.dispositivo_id,
    ROW_NUMBER() OVER (
      PARTITION BY m.pallet_id
      ORDER BY m.created_at DESC, m.id DESC
    ) AS rn
  FROM movimentacoes m
)
SELECT
  p.id AS pallet_id,
  p.etiqueta_barcode,
  s.codigo AS sku_codigo,
  p.quantidade_unidades,
  l.id AS local_id,
  l.codigo_endereco,
  l.tipo_zona,
  l.coordenada_x,
  l.coordenada_y,
  l.coordenada_z,
  re.tipo_evento AS ultimo_evento,
  re.created_at AS ultimo_timestamp_utc,
  re.operador_id,
  re.dispositivo_id
FROM ranked_events re
INNER JOIN pallets p ON p.id = re.pallet_id
INNER JOIN skus s ON s.id = p.sku_id
INNER JOIN locais l ON l.id = re.local_id
WHERE re.rn = 1
  AND re.tipo_evento <> 'SAIDA';
`;

/**
 * Consulta analítica de projeção do estado atual para alimentar a UI 3D e APIs internas.
 */
export async function obterPosicoesAtuaisPallets(
  db: AnalyticalSqlExecutor
): Promise<PosicaoAtualPalletDTO[]> {
  const query = sql`
    WITH ranked_events AS (
      SELECT
        m.pallet_id,
        m.local_id,
        m.tipo_evento,
        m.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY m.pallet_id
          ORDER BY m.created_at DESC, m.id DESC
        ) AS rn
      FROM movimentacoes m
    )
    SELECT
      p.id AS palletId,
      p.etiqueta_barcode AS etiquetaBarcode,
      s.codigo AS skuCodigo,
      p.quantidade_unidades AS quantidadeUnidades,
      l.id AS localId,
      l.codigo_endereco AS codigoEndereco,
      l.tipo_zona AS tipoZona,
      l.coordenada_x AS coordenadaX,
      l.coordenada_y AS coordenadaY,
      l.coordenada_z AS coordenadaZ,
      re.tipo_evento AS ultimoEvento,
      DATE_FORMAT(re.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS ultimoTimestampUtc
    FROM ranked_events re
    INNER JOIN pallets p ON p.id = re.pallet_id
    INNER JOIN skus s ON s.id = p.sku_id
    INNER JOIN locais l ON l.id = re.local_id
    WHERE re.rn = 1
      AND re.tipo_evento <> 'SAIDA'
  `;

  const [rows] = await db.execute(query);
  return rows as PosicaoAtualPalletDTO[];
}

