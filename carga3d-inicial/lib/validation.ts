import { z } from 'zod';
import { EVENTO_TIPOS } from './db/schema.ts';
const id=z.string().min(1).max(80);const name=z.string().trim().min(1).max(100);const size=z.number().finite().positive().max(2000);
export const truckSchema=z.object({id,name,length:size,width:size,height:size,doorWidth:size,doorHeight:size,capacity:z.number().finite().positive().max(30000)}).refine(t=>t.doorWidth<=t.width&&t.doorHeight<=t.height,'A abertura não pode ultrapassar o compartimento.');
export const productSchema=z.object({id,name,category:name,color:z.string().regex(/^#[0-9a-f]{6}$/i),length:size,width:size,baseHeight:size,height:size,weight:z.number().finite().positive().max(30000),rotate:z.boolean(),fragile:z.boolean()}).refine(p=>p.height>=p.baseHeight,'A altura total deve incluir a base.');
export const distributionRulesSchema=z.object({sameDestination:z.boolean(),lightEnd:z.enum(['cab','door']),fragileClearance:z.number().finite().positive().max(100)});
const lineSchema=z.object({productId:id,quantity:z.number().int().min(1).max(250),destination:z.string().trim().max(100).optional(),deliveryOrder:z.number().int().min(1).max(100).optional()});
const placement=z.object({id,productId:id,x:z.number().finite().min(0),z:z.number().finite().min(0),rotated:z.boolean()});
export const loadSchema=z.object({id,name,createdAt:z.string().datetime(),truck:truckSchema,products:z.array(productSchema).max(100),lines:z.array(lineSchema).max(100),gap:z.number().finite().min(0).max(50),rules:distributionRulesSchema.optional(),plan:z.object({placed:z.array(placement).max(250),unplaced:z.array(z.object({id,productId:id,reason:z.string().max(300)})).max(250)}),adjustments:z.array(z.string().max(500)).max(500)});
export const workspaceSchema=z.object({trucks:z.array(truckSchema).max(100),products:z.array(productSchema).max(100),loads:z.array(loadSchema).max(100)});

/**
 * Expressão regular estrita para códigos de barras logísticos (GS1-128 / SSCC / Code 128 / QR Estruturado).
 * Permite apenas caracteres alfanuméricos ASCII, hifens, dois-pontos e barras verticais/diagonais.
 * Bloqueia caracteres de controle, aspas, ponto-e-vírgula, tags HTML e sequências de escape.
 */
const SAFE_BARCODE_REGEX = /^[A-Z0-9\-:_/|.]{4,64}$/;
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;

export function sanitizeRawBarcode(raw: string): string {
  return raw
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .trim()
    .toUpperCase();
}

export const HidRawScanSchema = z
  .string()
  .transform(sanitizeRawBarcode)
  .pipe(
    z
      .string()
      .min(4, 'Código de barras curto demais.')
      .max(64, 'Código de barras excede o limite de 64 bytes.')
      .regex(
        SAFE_BARCODE_REGEX,
        'Código contém caracteres inválidos ou tentativa de injeção de comando.'
      )
  );

export const ScanIngestRequestSchema = z.object({
  barcode: HidRawScanSchema,
  palletId: z.string().regex(ULID_REGEX, 'palletId deve ser um ULID válido de 26 caracteres.'),
  localId: z.string().regex(ULID_REGEX, 'localId deve ser um ULID válido de 26 caracteres.'),
  tipoEvento: z.enum(EVENTO_TIPOS),
  operadorId: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'operadorId inválido.'),
  dispositivoId: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_:-]+$/, 'dispositivoId inválido.'),
  scannedAtIso: z.string().datetime({ offset: true }),
  idempotencyKey: z
    .string()
    .regex(SHA256_HEX_REGEX, 'idempotencyKey deve ser um hash SHA-256 hexadecimal.'),
});

export type ScanIngestRequest = z.infer<typeof ScanIngestRequestSchema>;

export const QueuedScanMessageSchema = ScanIngestRequestSchema.extend({
  eventoId: z.string().regex(ULID_REGEX),
  enqueuedAtIso: z.string().datetime({ offset: true }),
});

export type QueuedScanMessage = z.infer<typeof QueuedScanMessageSchema>;

