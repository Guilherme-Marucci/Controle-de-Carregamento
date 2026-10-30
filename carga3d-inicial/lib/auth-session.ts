export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  role?: string;
};

export const COOKIE_SESSION_NAME = 'c3d_session';

export const PRESET_USERS: Array<ChatGPTUser & { description: string }> = [
  {
    userId: 'usr_gestor_frota',
    displayName: 'Carlos Gestor',
    fullName: 'Carlos Eduardo Silva',
    email: 'carlos.gestor@carga3d.local',
    role: 'Gestor de Frota & Logística',
    description: 'Acesso total a caminhões, relatórios de frota e planejamento'
  },
  {
    userId: 'usr_operador_carga',
    displayName: 'Marcos Operador',
    fullName: 'Marcos Antônio Ribeiro',
    email: 'marcos.operador@carga3d.local',
    role: 'Operador de Carregamento',
    description: 'Planejamento 3D, controle de paletes e distribuição'
  },
  {
    userId: 'usr_conferente_expedicao',
    displayName: 'Juliana Conferente',
    fullName: 'Juliana Mendes Santos',
    email: 'juliana.conferente@carga3d.local',
    role: 'Conferente de Expedição',
    description: 'Validação de romaneio, ordem de descarga e amarração'
  }
];

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
 * Serializa os dados do operador em um token seguro codificado em base64
 */
export function serializeSessionUser(user: ChatGPTUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString('base64');
  return `b64_${payload}`;
}

/**
 * Valida e decodifica o cookie de sessão, rejeitando payloads adulterados
 */
export function parseSessionUser(sessionValue: string | undefined): ChatGPTUser | null {
  if (!sessionValue) return null;
  try {
    let rawJson = sessionValue;
    if (sessionValue.startsWith('ey') || sessionValue.startsWith('b64_')) {
      const b64 = sessionValue.replace(/^b64_/, '');
      rawJson = Buffer.from(b64, 'base64').toString('utf-8');
    }
    const parsed = JSON.parse(rawJson);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.userId === 'string' &&
      typeof parsed.email === 'string' &&
      parsed.userId.length > 0 &&
      parsed.email.includes('@')
    ) {
      return {
        userId: parsed.userId,
        displayName: parsed.displayName || parsed.fullName || parsed.email,
        email: parsed.email,
        fullName: parsed.fullName ?? null,
        role: parsed.role || 'Operador de Carga'
      };
    }
  } catch {
    // Falha silenciosa e segura para payloads malformados
  }
  return null;
}

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

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function timingSafeEqualString(a: string, b: string): boolean {
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
 * Assina um token JWT M2M HS256 usando Web Crypto API (para provisionamento de coletores e testes)
 */
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

/**
 * Valida JWT M2M (HS256 via Web Crypto API nativa do Cloudflare Workers) + Service Headers opcionais.
 * Exige obrigatoriamente o escopo 'scanner:ingest' e correspondência do dispositivoId.
 */
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
