import type { UserRole, UserStatus } from '../db/schema-authz.ts';

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  role?: string;
  systemRole?: UserRole;
  status?: UserStatus;
  authzVersion?: number;
};

export const COOKIE_SESSION_NAME = 'c3d_session';
export const AUTHZ_SESSION_COOKIE_NAME = 'c3d_sid';

export const PRESET_USERS: Array<ChatGPTUser & { description: string }> = [
  {
    userId: 'usr_gestor_frota',
    displayName: 'Carlos Gestor',
    fullName: 'Carlos Eduardo Silva',
    email: 'carlos.gestor@carga3d.local',
    role: 'Gestor de Frota & Logística',
    systemRole: 'ADMIN',
    status: 'ACTIVE',
    authzVersion: 1,
    description: 'Acesso total a caminhões, relatórios de frota e planejamento',
  },
  {
    userId: 'usr_operador_carga',
    displayName: 'Marcos Operador',
    fullName: 'Marcos Antônio Ribeiro',
    email: 'marcos.operador@carga3d.local',
    role: 'Operador de Carregamento',
    systemRole: 'USER',
    status: 'ACTIVE',
    authzVersion: 1,
    description: 'Planejamento 3D, controle de paletes e distribuição',
  },
  {
    userId: 'usr_conferente_expedicao',
    displayName: 'Juliana Conferente',
    fullName: 'Juliana Mendes Santos',
    email: 'juliana.conferente@carga3d.local',
    role: 'Conferente de Expedição',
    systemRole: 'USER',
    status: 'ACTIVE',
    authzVersion: 1,
    description: 'Validação de romaneio, ordem de descarga e amarração',
  },
];

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(base64);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    diff |= bufA[i]! ^ bufB[i]!;
  }
  return diff === 0;
}

/**
 * Faz o parsing seguro do cabeçalho Cookie de requisição HTTP
 */
export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const list: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    try {
      list[key] = decodeURIComponent(val);
    } catch {
      list[key] = val;
    }
  }
  return list;
}

/**
 * Serializa os dados básicos do operador usando estritamente Web APIs (sem Buffer do Node.js)
 * mantendo retrocompatibilidade com a interface legada.
 */
export function serializeSessionUser(user: ChatGPTUser): string {
  const utf8Bytes = new TextEncoder().encode(JSON.stringify(user));
  return `b64_${bytesToBase64(utf8Bytes)}`;
}

/**
 * Valida e decodifica o cookie de sessão legado usando Web APIs nativas, rejeitando payloads adulterados.
 */
export function parseSessionUser(sessionValue: string | undefined): ChatGPTUser | null {
  if (!sessionValue) return null;
  try {
    let rawJson = sessionValue;
    if (sessionValue.startsWith('ey') || sessionValue.startsWith('b64_')) {
      const b64 = sessionValue.replace(/^b64_/, '');
      rawJson = new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(b64));
    }
    const parsed: unknown = JSON.parse(rawJson);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'userId' in parsed &&
      'email' in parsed &&
      typeof parsed.userId === 'string' &&
      typeof parsed.email === 'string' &&
      parsed.userId.length > 0 &&
      parsed.email.includes('@')
    ) {
      const record = parsed as Record<string, unknown>;
      return {
        userId: parsed.userId,
        displayName:
          (typeof record.displayName === 'string' && record.displayName) ||
          (typeof record.fullName === 'string' && record.fullName) ||
          parsed.email,
        email: parsed.email,
        fullName: typeof record.fullName === 'string' ? record.fullName : null,
        role: typeof record.role === 'string' ? record.role : 'Operador de Carga',
      };
    }
  } catch {
    // Falha silenciosa e segura para payloads malformados
  }
  return null;
}

// ============================================================================
// SESSÃO COMPACTA ASSINADA (ZERO-TRUST / SEM ACLs NO COOKIE) + INVALIDAÇÃO SÍNCRONA
// ============================================================================

/**
 * O cookie armazena EXCLUSIVAMENTE o userId, tokenAuthzVersion e metadados temporais/jti.
 * É estritamente proibido armazenar arrays de permissões, ACLs ou roles no cookie.
 */
export interface CompactSessionClaims {
  uid: string;
  ver: number;
  jti: string;
  iat: number;
  exp: number;
}

export type SessionVerificationError =
  | 'MISSING_SESSION'
  | 'MALFORMED_SESSION'
  | 'INVALID_SIGNATURE'
  | 'FORBIDDEN_CLAIMS_IN_COOKIE'
  | 'SESSION_EXPIRED';

export interface CompactSessionVerifyResult {
  valid: boolean;
  claims?: CompactSessionClaims;
  errorCode?: SessionVerificationError;
}

function generateRandomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function signCompactSessionCookie(
  params: { userId: string; tokenAuthzVersion: number; ttlSeconds?: number; nowSeconds?: number },
  secret: string
): Promise<string> {
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET deve possuir ao menos 16 caracteres.');
  }
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 8 * 3600;
  const claims: CompactSessionClaims = {
    uid: params.userId,
    ver: params.tokenAuthzVersion,
    jti: generateRandomHex(12),
    iat: now,
    exp: now + ttl,
  };

  const encoder = new TextEncoder();
  const payloadB64 = uint8ArrayToBase64Url(encoder.encode(JSON.stringify(claims)));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuf = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(payloadB64));
  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signatureBuf));
  return `v1.${payloadB64}.${signatureB64}`;
}

export async function verifyCompactSessionCookie(
  cookieValue: string | undefined | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<CompactSessionVerifyResult> {
  if (!cookieValue) {
    return { valid: false, errorCode: 'MISSING_SESSION' };
  }

  // Limite rígido de tamanho (cookies com ACLs inchadas são rejeitados imediatamente)
  if (cookieValue.length > 512) {
    return { valid: false, errorCode: 'FORBIDDEN_CLAIMS_IN_COOKIE' };
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return { valid: false, errorCode: 'MALFORMED_SESSION' };
  }

  const [, payloadB64, signatureB64] = parts as [string, string, string];

  try {
    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64UrlToUint8Array(signatureB64);
    const signatureValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      sigBytes.buffer as ArrayBuffer,
      encoder.encode(payloadB64)
    );

    if (!signatureValid) {
      return { valid: false, errorCode: 'INVALID_SIGNATURE' };
    }

    const decodedText = new TextDecoder('utf-8', { fatal: true }).decode(
      base64UrlToUint8Array(payloadB64)
    );
    const rawObj = JSON.parse(decodedText) as Record<string, unknown>;

    // Proíbe explicitamente chaves de ACL/permissões/roles dentro do cookie
    const allowedKeys = new Set(['uid', 'ver', 'jti', 'iat', 'exp']);
    for (const k of Object.keys(rawObj)) {
      if (!allowedKeys.has(k)) {
        return { valid: false, errorCode: 'FORBIDDEN_CLAIMS_IN_COOKIE' };
      }
    }

    if (
      typeof rawObj.uid !== 'string' ||
      rawObj.uid.length === 0 ||
      typeof rawObj.ver !== 'number' ||
      !Number.isInteger(rawObj.ver) ||
      rawObj.ver < 1 ||
      typeof rawObj.jti !== 'string' ||
      typeof rawObj.iat !== 'number' ||
      typeof rawObj.exp !== 'number'
    ) {
      return { valid: false, errorCode: 'MALFORMED_SESSION' };
    }

    if (rawObj.exp <= nowSeconds) {
      return { valid: false, errorCode: 'SESSION_EXPIRED' };
    }

    return {
      valid: true,
      claims: {
        uid: rawObj.uid,
        ver: rawObj.ver,
        jti: rawObj.jti,
        iat: rawObj.iat,
        exp: rawObj.exp,
      },
    };
  } catch {
    return { valid: false, errorCode: 'MALFORMED_SESSION' };
  }
}

export function buildSecureSessionSetCookieHeader(
  signedToken: string,
  maxAgeSeconds = 8 * 3600
): string {
  return `${AUTHZ_SESSION_COOKIE_NAME}=${encodeURIComponent(signedToken)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function buildClearSessionCookieHeader(): string {
  return `${AUTHZ_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Validação estrita de Origin contra o host da aplicação para prevenir CSRF em mutações no Edge.
 */
export function verifyStrictOrigin(
  request: Request,
  expectedOriginOverride?: string
): { valid: boolean; reason?: 'MISSING_ORIGIN' | 'INVALID_ORIGIN_FORMAT' | 'ORIGIN_MISMATCH' } {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return { valid: true };
  }

  const originHeader = request.headers.get('Origin');
  if (!originHeader || originHeader === 'null') {
    return { valid: false, reason: 'MISSING_ORIGIN' };
  }

  let parsedOrigin: URL;
  let targetUrl: URL;
  try {
    parsedOrigin = new URL(originHeader);
    targetUrl = new URL(expectedOriginOverride ?? request.url);
  } catch {
    return { valid: false, reason: 'INVALID_ORIGIN_FORMAT' };
  }

  if (parsedOrigin.origin !== targetUrl.origin) {
    return { valid: false, reason: 'ORIGIN_MISMATCH' };
  }

  return { valid: true };
}

/**
 * Derivação de senha segura compatível com Edge Runtime via Web Crypto API (PBKDF2-SHA256).
 */
export async function hashPasswordWebCrypto(
  password: string,
  iterations = 100_000
): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  const saltB64 = uint8ArrayToBase64Url(salt);
  const hashB64 = uint8ArrayToBase64Url(new Uint8Array(derivedBits));
  return `pbkdf2_sha256$${iterations}$${saltB64}$${hashB64}`;
}

export async function verifyPasswordWebCrypto(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') {
    return false;
  }
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000) {
    return false;
  }
  const salt = base64UrlToUint8Array(parts[2]!);
  const expectedHashB64 = parts[3]!;

  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  const actualHashB64 = uint8ArrayToBase64Url(new Uint8Array(derivedBits));
  return timingSafeEqualString(actualHashB64, expectedHashB64);
}

// ============================================================================
// FLUXO M2M DE COLETORES / SCANNERS (PRESERVADO INTEGRALMENTE)
// ============================================================================

export type ScannerScope = 'scanner:ingest' | 'wms:read';

export interface CollectorTokenClaims {
  sub: string;
  operadorId?: string;
  scopes: ScannerScope[];
  iat: number;
  exp: number;
  iss: string;
}

export interface CollectorAuthEnv {
  M2M_JWT_SECRET: string;
  CF_ACCESS_SERVICE_TOKEN_ID?: string;
  CF_ACCESS_SERVICE_TOKEN_SECRET?: string;
}

export interface CollectorAuthResult {
  authenticated: boolean;
  dispositivoId?: string;
  claims?: CollectorTokenClaims;
  errorCode?:
    | 'MISSING_TOKEN'
    | 'INVALID_SIGNATURE'
    | 'TOKEN_EXPIRED'
    | 'INSUFFICIENT_SCOPE'
    | 'DEVICE_MISMATCH';
}

export async function signCollectorM2MToken(
  claims: CollectorTokenClaims,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const headerB64 = uint8ArrayToBase64Url(
    encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  );
  const payloadB64 = uint8ArrayToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(signingInput)
  );

  const signatureB64 = uint8ArrayToBase64Url(new Uint8Array(signatureBuffer));
  return `${signingInput}.${signatureB64}`;
}

export async function verifyCollectorM2MToken(
  request: Request,
  env: CollectorAuthEnv,
  expectedDispositivoId: string
): Promise<CollectorAuthResult> {
  if (env.CF_ACCESS_SERVICE_TOKEN_ID && env.CF_ACCESS_SERVICE_TOKEN_SECRET) {
    const clientId = request.headers.get('CF-Access-Client-Id');
    const clientSecret = request.headers.get('CF-Access-Client-Secret');
    if (
      !clientId ||
      !clientSecret ||
      !timingSafeEqualString(clientId, env.CF_ACCESS_SERVICE_TOKEN_ID) ||
      !timingSafeEqualString(clientSecret, env.CF_ACCESS_SERVICE_TOKEN_SECRET)
    ) {
      return { authenticated: false, errorCode: 'INVALID_SIGNATURE' };
    }
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, errorCode: 'MISSING_TOKEN' };
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { authenticated: false, errorCode: 'INVALID_SIGNATURE' };
  }

  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(env.M2M_JWT_SECRET);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const dataToVerify = encoder.encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlToUint8Array(signatureB64);

    const isValidSignature = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      signatureBytes.buffer as ArrayBuffer,
      dataToVerify
    );

    if (!isValidSignature) {
      return { authenticated: false, errorCode: 'INVALID_SIGNATURE' };
    }

    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadB64));
    const claims = JSON.parse(payloadJson) as CollectorTokenClaims;

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) {
      return { authenticated: false, errorCode: 'TOKEN_EXPIRED' };
    }

    if (!Array.isArray(claims.scopes) || !claims.scopes.includes('scanner:ingest')) {
      return { authenticated: false, errorCode: 'INSUFFICIENT_SCOPE' };
    }

    if (claims.sub !== expectedDispositivoId) {
      return { authenticated: false, errorCode: 'DEVICE_MISMATCH' };
    }

    return {
      authenticated: true,
      dispositivoId: claims.sub,
      claims,
    };
  } catch {
    return { authenticated: false, errorCode: 'INVALID_SIGNATURE' };
  }
}
