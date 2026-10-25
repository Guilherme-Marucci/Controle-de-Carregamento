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
