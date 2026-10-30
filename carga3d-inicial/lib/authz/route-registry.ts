import type { AuthzAction, PageCategory } from '../../db/schema-authz.ts';

export const PAGE_KEYS = [
  'op:carga-3d',
  'op:romaneio',
  'op:balanca',
  'op:indicadores',
  'op:frota',
  'op:produtos',
  'op:cargas',
  'gov:usuarios',
  'gov:permissoes',
  'gov:auditoria',
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

export interface SystemPageCatalogItem {
  readonly pageKey: PageKey;
  readonly name: string;
  readonly category: PageCategory;
  readonly routeTemplate: string;
}

export const SYSTEM_PAGES_CATALOG: readonly SystemPageCatalogItem[] = [
  {
    pageKey: 'op:carga-3d',
    name: 'Planejamento e Cubagem 3D',
    category: 'OPERATIONS',
    routeTemplate: '/planejamento',
  },
  {
    pageKey: 'op:romaneio',
    name: 'Romaneio e Ordem de Expedição',
    category: 'OPERATIONS',
    routeTemplate: '/manifestos/:id',
  },
  {
    pageKey: 'op:balanca',
    name: 'Simulador de Balança e Eixos',
    category: 'OPERATIONS',
    routeTemplate: '/balanca',
  },
  {
    pageKey: 'op:indicadores',
    name: 'Painel de Indicadores Logísticos',
    category: 'OPERATIONS',
    routeTemplate: '/indicadores',
  },
  {
    pageKey: 'op:frota',
    name: 'Cadastro de Frota e Caminhões',
    category: 'OPERATIONS',
    routeTemplate: '/frota',
  },
  {
    pageKey: 'op:produtos',
    name: 'Catálogo de Produtos e Paletes',
    category: 'OPERATIONS',
    routeTemplate: '/produtos',
  },
  {
    pageKey: 'op:cargas',
    name: 'Gestão de Cargas e Workspace',
    category: 'OPERATIONS',
    routeTemplate: '/cargas/:id',
  },
  {
    pageKey: 'gov:usuarios',
    name: 'Governança de Contas e Papéis',
    category: 'GOVERNANCE',
    routeTemplate: '/governanca/usuarios',
  },
  {
    pageKey: 'gov:permissoes',
    name: 'Gestão de ACLs e Permissões Granulares',
    category: 'GOVERNANCE',
    routeTemplate: '/governanca/permissoes',
  },
  {
    pageKey: 'gov:auditoria',
    name: 'Trilha de Auditoria de Segurança',
    category: 'GOVERNANCE',
    routeTemplate: '/governanca/auditoria',
  },
] as const;

export const SYSTEM_PAGES_BY_KEY: ReadonlyMap<PageKey, SystemPageCatalogItem> = new Map(
  SYSTEM_PAGES_CATALOG.map((item) => [item.pageKey, item])
);

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RouteRegistryEntry =
  | {
      readonly channel: 'M2M_BYPASS';
      readonly methods: readonly HttpMethod[];
      readonly template: string;
    }
  | {
      readonly channel: 'PUBLIC_AUTH';
      readonly methods: readonly HttpMethod[];
      readonly template: string;
    }
  | {
      readonly channel: 'PROTECTED';
      readonly methods: readonly HttpMethod[];
      readonly template: string;
      readonly pageKey: PageKey;
      readonly category: PageCategory;
      readonly requiredAction: AuthzAction;
    };

/**
 * Registro centralizado e determinístico de todas as rotas Web e API.
 * Sem wildcards permissivos (*) ou expressões regulares arbitrárias.
 */
export const ROUTE_REGISTRY: readonly RouteRegistryEntry[] = [
  // Subsistema M2M de Scanners Físicos (estritamente isolado da sessão humana)
  {
    channel: 'M2M_BYPASS',
    methods: ['POST'],
    template: '/api/scans',
  },

  // Endpoints públicos de autenticação de sessão
  {
    channel: 'PUBLIC_AUTH',
    methods: ['GET', 'POST'],
    template: '/api/auth',
  },

  // Rotas Web Operacionais
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/planejamento',
    pageKey: 'op:carga-3d',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/manifestos/:id',
    pageKey: 'op:romaneio',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/balanca',
    pageKey: 'op:balanca',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/indicadores',
    pageKey: 'op:indicadores',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/frota',
    pageKey: 'op:frota',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/produtos',
    pageKey: 'op:produtos',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/cargas/:id',
    pageKey: 'op:cargas',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },

  // Rotas de API Operacionais
  {
    channel: 'PROTECTED',
    methods: ['GET'],
    template: '/api/workspace',
    pageKey: 'op:cargas',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['PUT'],
    template: '/api/workspace',
    pageKey: 'op:cargas',
    category: 'OPERATIONS',
    requiredAction: 'write',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET'],
    template: '/api/cargas/:id',
    pageKey: 'op:cargas',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['PUT', 'DELETE'],
    template: '/api/cargas/:id',
    pageKey: 'op:cargas',
    category: 'OPERATIONS',
    requiredAction: 'write',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET'],
    template: '/api/manifestos/:id',
    pageKey: 'op:romaneio',
    category: 'OPERATIONS',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['POST'],
    template: '/api/manifestos/:id/emitir',
    pageKey: 'op:romaneio',
    category: 'OPERATIONS',
    requiredAction: 'execute',
  },
  {
    channel: 'PROTECTED',
    methods: ['POST'],
    template: '/api/cubagem/calcular',
    pageKey: 'op:carga-3d',
    category: 'OPERATIONS',
    requiredAction: 'execute',
  },

  // Rotas Web de Governança
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/governanca/usuarios',
    pageKey: 'gov:usuarios',
    category: 'GOVERNANCE',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/governanca/permissoes',
    pageKey: 'gov:permissoes',
    category: 'GOVERNANCE',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET', 'HEAD'],
    template: '/governanca/auditoria',
    pageKey: 'gov:auditoria',
    category: 'GOVERNANCE',
    requiredAction: 'read',
  },

  // Rotas de API de Governança
  {
    channel: 'PROTECTED',
    methods: ['GET'],
    template: '/api/governance/users',
    pageKey: 'gov:usuarios',
    category: 'GOVERNANCE',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['POST'],
    template: '/api/governance/users/:id/approve',
    pageKey: 'gov:usuarios',
    category: 'GOVERNANCE',
    requiredAction: 'execute',
  },
  {
    channel: 'PROTECTED',
    methods: ['PATCH'],
    template: '/api/governance/users/:id/status',
    pageKey: 'gov:usuarios',
    category: 'GOVERNANCE',
    requiredAction: 'write',
  },
  {
    channel: 'PROTECTED',
    methods: ['PATCH'],
    template: '/api/governance/users/:id/role',
    pageKey: 'gov:usuarios',
    category: 'GOVERNANCE',
    requiredAction: 'write',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET'],
    template: '/api/governance/permissions/:userId',
    pageKey: 'gov:permissoes',
    category: 'GOVERNANCE',
    requiredAction: 'read',
  },
  {
    channel: 'PROTECTED',
    methods: ['POST', 'DELETE'],
    template: '/api/governance/permissions',
    pageKey: 'gov:permissoes',
    category: 'GOVERNANCE',
    requiredAction: 'write',
  },
  {
    channel: 'PROTECTED',
    methods: ['GET'],
    template: '/api/governance/audit-logs',
    pageKey: 'gov:auditoria',
    category: 'GOVERNANCE',
    requiredAction: 'read',
  },
] as const;

const SAFE_DYNAMIC_PARAM_REGEX = /^[a-zA-Z0-9_.:@-]{1,128}$/;

export type NormalizedPathResult =
  | { ok: true; normalizedPath: string; segments: readonly string[] }
  | {
      ok: false;
      reason:
        | 'EMPTY_OR_MISSING_LEADING_SLASH'
        | 'FORBIDDEN_CHARACTER_OR_ENCODING'
        | 'DOUBLE_SLASH_DETECTED'
        | 'DOT_SEGMENT_TRAVERSAL';
    };

/**
 * Normaliza caminhos de URL de forma estrita e determinística:
 * - Rejeita bytes nulos, barras invertidas (\), barras codificadas (%2f/%5c) e double-encoding (%25).
 * - Rejeita barras duplas (//) e segmentos de path traversal (. ou ..).
 * - Remove trailing slash (exceto raiz "/").
 */
export function normalizeRoutePath(rawPathname: string): NormalizedPathResult {
  if (!rawPathname || !rawPathname.startsWith('/')) {
    return { ok: false, reason: 'EMPTY_OR_MISSING_LEADING_SLASH' };
  }

  // Bloqueia caracteres de controle, barra invertida, barras codificadas e double-encoding
  if (
    /[\x00-\x1F\x7F\\]/.test(rawPathname) ||
    /%(?:00|2f|5c|25)/i.test(rawPathname)
  ) {
    return { ok: false, reason: 'FORBIDDEN_CHARACTER_OR_ENCODING' };
  }

  if (rawPathname.includes('//')) {
    return { ok: false, reason: 'DOUBLE_SLASH_DETECTED' };
  }

  let trimmed = rawPathname;
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    trimmed = trimmed.slice(0, -1);
  }

  if (trimmed === '/') {
    return { ok: true, normalizedPath: '/', segments: [] };
  }

  const rawSegments = trimmed.slice(1).split('/');
  const decodedSegments: string[] = [];

  for (const seg of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return { ok: false, reason: 'FORBIDDEN_CHARACTER_OR_ENCODING' };
    }

    if (
      decoded.length === 0 ||
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      /[\x00-\x1F\x7F]/.test(decoded)
    ) {
      return { ok: false, reason: 'DOT_SEGMENT_TRAVERSAL' };
    }

    decodedSegments.push(decoded);
  }

  return {
    ok: true,
    normalizedPath: `/${decodedSegments.join('/')}`,
    segments: decodedSegments,
  };
}

export type RouteResolutionResult =
  | {
      readonly status: 'TAMPERED_PATH';
      readonly reason: string;
    }
  | {
      readonly status: 'UNMATCHED_DEFAULT_DENY';
      readonly normalizedPath: string;
    }
  | {
      readonly status: 'MATCHED_M2M_BYPASS';
      readonly normalizedPath: string;
    }
  | {
      readonly status: 'MATCHED_PUBLIC_AUTH';
      readonly normalizedPath: string;
    }
  | {
      readonly status: 'MATCHED_PROTECTED';
      readonly normalizedPath: string;
      readonly pageKey: PageKey;
      readonly category: PageCategory;
      readonly requiredAction: AuthzAction;
      readonly params: Readonly<Record<string, string>>;
    };

/**
 * Resolve deterministicamente método HTTP + pathname para a política do Route Registry.
 * Segmentos estáticos são comparados de forma case-insensitive (normalizados para minúsculas)
 * para impedir bypass por capitalização (/Governanca/Usuarios vs /governanca/usuarios),
 * enquanto parâmetros dinâmicos (:id) preservam seu valor exato validado contra SAFE_DYNAMIC_PARAM_REGEX.
 */
export function resolveRoutePolicy(method: string, rawPathname: string): RouteResolutionResult {
  const norm = normalizeRoutePath(rawPathname);
  if (!norm.ok) {
    return { status: 'TAMPERED_PATH', reason: norm.reason };
  }

  const upperMethod = method.toUpperCase() as HttpMethod;

  for (const entry of ROUTE_REGISTRY) {
    if (!entry.methods.includes(upperMethod)) {
      continue;
    }

    const templateSegments =
      entry.template === '/' ? [] : entry.template.slice(1).split('/');

    if (templateSegments.length !== norm.segments.length) {
      continue;
    }

    const extractedParams: Record<string, string> = {};
    let matchedAll = true;

    for (let i = 0; i < templateSegments.length; i++) {
      const tplSeg = templateSegments[i]!;
      const actualSeg = norm.segments[i]!;

      if (tplSeg.startsWith(':')) {
        const paramName = tplSeg.slice(1);
        if (!SAFE_DYNAMIC_PARAM_REGEX.test(actualSeg)) {
          return {
            status: 'TAMPERED_PATH',
            reason: `INVALID_DYNAMIC_PARAM:${paramName}`,
          };
        }
        extractedParams[paramName] = actualSeg;
      } else if (tplSeg.toLowerCase() !== actualSeg.toLowerCase()) {
        matchedAll = false;
        break;
      }
    }

    if (!matchedAll) {
      continue;
    }

    if (entry.channel === 'M2M_BYPASS') {
      return {
        status: 'MATCHED_M2M_BYPASS',
        normalizedPath: norm.normalizedPath,
      };
    }

    if (entry.channel === 'PUBLIC_AUTH') {
      return {
        status: 'MATCHED_PUBLIC_AUTH',
        normalizedPath: norm.normalizedPath,
      };
    }

    return {
      status: 'MATCHED_PROTECTED',
      normalizedPath: norm.normalizedPath,
      pageKey: entry.pageKey,
      category: entry.category,
      requiredAction: entry.requiredAction,
      params: extractedParams,
    };
  }

  return {
    status: 'UNMATCHED_DEFAULT_DENY',
    normalizedPath: norm.normalizedPath,
  };
}

