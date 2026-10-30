import {
  mysqlTable,
  varchar,
  int,
  timestamp,
  mysqlEnum,
  uniqueIndex,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';

export const ZONA_TIPOS = ['DOCA', 'PULMAO', 'PICKING', 'EXPEDICAO', 'QUARENTENA'] as const;
export type ZonaTipo = (typeof ZONA_TIPOS)[number];

export const EVENTO_TIPOS = ['ENTRADA', 'SAIDA', 'TRANSITO', 'CONFERENCIA'] as const;
export type EventoTipo = (typeof EVENTO_TIPOS)[number];

/**
 * Tabela Cadastral: SKUs
 */
export const skus = mysqlTable(
  'skus',
  {
    id: varchar('id', { length: 26 }).primaryKey(), // ULID
    codigo: varchar('codigo', { length: 64 }).notNull(),
    descricao: varchar('descricao', { length: 255 }).notNull(),
    pesoBrutoGramas: int('peso_bruto_gramas').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow().notNull(),
  },
  (table) => ({
    codigoIdx: uniqueIndex('skus_codigo_uq').on(table.codigo),
  })
);

/**
 * Tabela Cadastral: Locais Físicos / Endereços Logísticos
 */
export const locais = mysqlTable(
  'locais',
  {
    id: varchar('id', { length: 26 }).primaryKey(), // ULID
    codigoEndereco: varchar('codigo_endereco', { length: 32 }).notNull(), // Ex: R01-P04-N02
    tipoZona: mysqlEnum('tipo_zona', ZONA_TIPOS).notNull(),
    capacidadeMaxPallets: int('capacidade_max_pallets').notNull(),
    coordenadaX: int('coordenada_x').notNull(),
    coordenadaY: int('coordenada_y').notNull(),
    coordenadaZ: int('coordenada_z').notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow().notNull(),
  },
  (table) => ({
    enderecoIdx: uniqueIndex('locais_codigo_endereco_uq').on(table.codigoEndereco),
    zonaIdx: index('locais_tipo_zona_idx').on(table.tipoZona),
  })
);

/**
 * Tabela Cadastral: Pallets (Entidade Identificadora - Sem coluna mutável de local_id!)
 */
export const pallets = mysqlTable(
  'pallets',
  {
    id: varchar('id', { length: 26 }).primaryKey(), // ULID
    etiquetaBarcode: varchar('etiqueta_barcode', { length: 64 }).notNull(), // SSCC / Código LPN
    skuId: varchar('sku_id', { length: 26 })
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    quantidadeUnidades: int('quantidade_unidades').notNull(),
    lote: varchar('lote', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 3 }).defaultNow().notNull(),
  },
  (table) => ({
    etiquetaIdx: uniqueIndex('pallets_etiqueta_barcode_uq').on(table.etiquetaBarcode),
    skuIdx: index('pallets_sku_id_idx').on(table.skuId),
  })
);

/**
 * Tabela Imutável (Append-Only Event Log): Movimentações
 * Nenhuma operação de UPDATE ou DELETE é permitida nesta tabela.
 */
export const movimentacoes = mysqlTable(
  'movimentacoes',
  {
    id: varchar('id', { length: 26 }).primaryKey(), // ULID lexicograficamente ordenável
    palletId: varchar('pallet_id', { length: 26 })
      .notNull()
      .references(() => pallets.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    localId: varchar('local_id', { length: 26 })
      .notNull()
      .references(() => locais.id, { onDelete: 'restrict', onUpdate: 'restrict' }),
    tipoEvento: mysqlEnum('tipo_evento', EVENTO_TIPOS).notNull(),
    createdAt: timestamp('created_at', { mode: 'date', fsp: 6 }).notNull(), // Precisão de microssegundos UTC
    operadorId: varchar('operador_id', { length: 64 }).notNull(),
    dispositivoId: varchar('dispositivo_id', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(), // SHA-256 Hex (64 chars)
  },
  (table) => ({
    idempotencyUq: uniqueIndex('movimentacoes_idempotency_key_uq').on(table.idempotencyKey),
    palletTimelineIdx: index('movimentacoes_pallet_timeline_idx').on(
      table.palletId,
      table.createdAt,
      table.id
    ),
    localTimelineIdx: index('movimentacoes_local_timeline_idx').on(
      table.localId,
      table.createdAt
    ),
    createdAtIdx: index('movimentacoes_created_at_idx').on(table.createdAt),
  })
);

export const palletsRelations = relations(pallets, ({ one, many }) => ({
  sku: one(skus, { fields: [pallets.skuId], references: [skus.id] }),
  movimentacoes: many(movimentacoes),
}));

export const movimentacoesRelations = relations(movimentacoes, ({ one }) => ({
  pallet: one(pallets, { fields: [movimentacoes.palletId], references: [pallets.id] }),
  local: one(locais, { fields: [movimentacoes.localId], references: [locais.id] }),
}));

export type NovoEventoMovimentacao = typeof movimentacoes.$inferInsert;
export type EventoMovimentacao = typeof movimentacoes.$inferSelect;

