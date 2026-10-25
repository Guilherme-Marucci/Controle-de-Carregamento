export type Truck = { id: string; name: string; length: number; width: number; height: number; doorWidth: number; doorHeight: number; capacity: number };
export type Product = { id: string; name: string; category: string; color: string; length: number; width: number; baseHeight: number; height: number; weight: number; rotate: boolean; fragile: boolean };
export type Line = { productId: string; quantity: number; destination?: string; deliveryOrder?: number };
export type Placement = { id: string; productId: string; x: number; z: number; rotated: boolean };
export type Unplaced = { id: string; productId: string; reason: string };
export type Plan = { placed: Placement[]; unplaced: Unplaced[] };
export type SavedLoad = { id: string; name: string; createdAt: string; truck: Truck; products: Product[]; lines: Line[]; gap: number; rules?: DistributionRules; plan: Plan; adjustments: string[] };
export type Workspace = { trucks: Truck[]; products: Product[]; loads: SavedLoad[] };
export const initialWorkspace: Workspace = { trucks: [], products: [], loads: [] };
export type DistributionRules = { sameDestination: boolean; lightEnd: 'cab' | 'door'; fragileClearance: number };
// Configurable starting clearance, not an engineering specification.
export const DEFAULT_RULES: DistributionRules = { sameDestination: true, lightEnd: 'cab', fragileClearance: 10 };
export function footprint(p: Product, rotated: boolean) { return { l: rotated ? p.width : p.length, w: rotated ? p.length : p.width }; }
const EPS = 1e-6;
export function requiredGap(a: Product, b: Product | undefined, gap: number, rules?: DistributionRules) {
  return rules && (a.fragile || b?.fragile) ? Math.max(gap, rules.fragileClearance) : gap;
}
export function validateRules(rules: DistributionRules, lines: Line[]): string[] {
  const errors: string[] = [];
  if (typeof rules.sameDestination !== 'boolean' || !['cab', 'door'].includes(rules.lightEnd)) errors.push('Escolha a regra de distribuição.');
  if (!Number.isFinite(rules.fragileClearance) || rules.fragileClearance <= 0 || rules.fragileClearance > 100) errors.push('A separação de frágeis deve ser maior que zero e de até 100 cm.');
  if (!rules.sameDestination) {
    const ranks = new Map<number, string>(), destinations = new Map<string, number>();
    for (const line of lines) {
      const destination = line.destination?.trim().toLocaleLowerCase('pt-BR');
      const rank = line.deliveryOrder;
      if (!destination || !Number.isInteger(rank) || rank! < 1 || rank! > 100) { errors.push('Informe destino e ordem de entrega (1 a 100) para cada produto da carga.'); continue; }
      if ((ranks.has(rank!) && ranks.get(rank!) !== destination) || (destinations.has(destination) && destinations.get(destination) !== rank)) errors.push('Use a mesma ordem para o mesmo destino e uma ordem diferente para cada parada.');
      ranks.set(rank!, destination); destinations.set(destination, rank!);
    }
  }
  return [...new Set(errors)];
}
// Lower ranks occupy bands nearer the cab; different ranks cannot overlap longitudinally.
function rankOf(p: Product, lines: Line[], rules: DistributionRules) {
  return rules.sameDestination ? (rules.lightEnd === 'cab' ? p.weight : -p.weight) : -(lines.find(l => l.productId === p.id)?.deliveryOrder ?? 0);
}
function separated(a: Placement, p: Product, b: Placement, q: Product, gap: number) {
  const af = footprint(p, a.rotated), bf = footprint(q, b.rotated);
  return a.x + af.l + gap <= b.x + EPS || b.x + bf.l + gap <= a.x + EPS || a.z + af.w + gap <= b.z + EPS || b.z + bf.w + gap <= a.z + EPS;
}
function ordered(a: Placement, p: Product, b: Placement, q: Product, gap: number, rules: DistributionRules, lines: Line[]) {
  const ra = rankOf(p, lines, rules), rb = rankOf(q, lines, rules);
  if (ra === rb) return true;
  if (ra < rb) return a.x + footprint(p, a.rotated).l + gap <= b.x + EPS;
  return b.x + footprint(q, b.rotated).l + gap <= a.x + EPS;
}
export function validatePlan(truck: Truck, products: Product[], plan: Plan, gap: number, rules?: DistributionRules, lines: Line[] = []): string[] {
  const errors: string[] = rules ? validateRules(rules, lines) : [];
  if (rules && !rules.sameDestination && plan.placed.some(a => !lines.some(l => l.productId === a.productId))) errors.push('Faltam destinos para os paletes alocados.');
  let weight = 0; const ids = new Set<string>();
  for (let i = 0; i < plan.placed.length; i++) {
    const a = plan.placed[i], p = products.find(p => p.id === a.productId);
    if (ids.has(a.id)) errors.push('Identificador de palete repetido.'); ids.add(a.id);
    if (!p) { errors.push('Produto não cadastrado.'); continue; }
    const { l, w } = footprint(p, a.rotated), margin = requiredGap(p, undefined, gap, rules); weight += p.weight;
    if (!Number.isFinite(a.x) || !Number.isFinite(a.z) || a.x < margin - EPS || a.z < margin - EPS || a.x + l > truck.length - margin + EPS || a.z + w > truck.width - margin + EPS) errors.push(`${a.id}: fora do piso útil ou da faixa de separação das paredes.`);
    if (a.rotated && !p.rotate) errors.push(`${a.id}: rotação não permitida.`);
    if (p.height > truck.height || p.height > truck.doorHeight || w > truck.doorWidth) errors.push(`${a.id}: altura ou abertura incompatível.`);
    for (let j = 0; j < i; j++) {
      const b = plan.placed[j], q = products.find(p => p.id === b.productId); if (!q) continue;
      const clearance = requiredGap(p, q, gap, rules);
      if (!separated(a, p, b, q, clearance)) errors.push(`${a.id}: colisão ou separação insuficiente com ${b.id}${rules && (p.fragile || q.fragile) ? ' (proteção de frágeis)' : ''}.`);
      if (rules && !ordered(a, p, b, q, clearance, rules, lines)) errors.push(rules.sameDestination ? `${a.id}: preserve os mais leves ${rules.lightEnd === 'cab' ? 'perto da cabine' : 'perto da porta traseira'}.` : `${a.id}: a posição bloqueia a ordem de entrega pela porta traseira.`);
    }
  }
  if (weight > truck.capacity + EPS) errors.push('Capacidade de peso excedida.');
  return [...new Set(errors)];
}
export function planCargo(truck: Truck, products: Product[], lines: Line[], gap: number, rules: DistributionRules = DEFAULT_RULES): Plan {
  if (!Number.isFinite(gap) || gap < 0 || gap > 50 || lines.some(l => !Number.isInteger(l.quantity) || l.quantity < 1) || lines.reduce((s, l) => s + l.quantity, 0) > 250) throw new Error('Informe até 250 paletes e folga entre 0 e 50 cm.');
  if (new Set(lines.map(l => l.productId)).size !== lines.length) throw new Error('Agrupe as quantidades do mesmo produto.');
  const ruleErrors = validateRules(rules, lines); if (ruleErrors.length) throw new Error(ruleErrors.join(' '));
  const items = lines.flatMap(line => { const p = products.find(p => p.id === line.productId); if (!p) throw new Error('Produto não cadastrado.'); return Array.from({ length: line.quantity }, (_, i) => ({ id: `${p.id}-${i + 1}`, p })); });
  const candidates: Plan[] = [];
  // Strategy changes may only reorder units within the same weight/delivery band.
  for (const strategy of [0, 1, 2]) {
    const order = [...items].sort((a, b) => rankOf(a.p, lines, rules) - rankOf(b.p, lines, rules) || (strategy === 1 ? b.p.length * b.p.width - a.p.length * a.p.width : strategy === 2 ? a.p.weight - b.p.weight : 0));
    const plan: Plan = { placed: [], unplaced: [] }; let weight = 0;
    for (const { p, id } of order) {
      const margin = requiredGap(p, undefined, gap, rules);
      const rotations = p.rotate ? [false, true] : [false];
      const viable = rotations.filter(r => { const f = footprint(p, r); return p.height <= truck.height && p.height <= truck.doorHeight && f.w <= truck.doorWidth && f.l + 2 * margin <= truck.length && f.w + 2 * margin <= truck.width; });
      if (!viable.length) { plan.unplaced.push({ id, productId: p.id, reason: 'Dimensões, abertura ou separação obrigatória incompatíveis.' }); continue; }
      if (weight + p.weight > truck.capacity) { plan.unplaced.push({ id, productId: p.id, reason: 'Limite de peso atingido neste arranjo.' }); continue; }
      const xs = [margin], zs = [margin];
      for (const a of plan.placed) { const q = products.find(p => p.id === a.productId)!; const f = footprint(q, a.rotated), clearance = requiredGap(p, q, gap, rules); xs.push(a.x + f.l + clearance); zs.push(a.z + f.w + clearance); }
      let found: Placement | undefined;
      outer: for (const x of [...new Set(xs)].sort((a, b) => a - b)) for (const z of [...new Set(zs)].sort((a, b) => a - b)) for (const rotated of viable) {
        const a = { id, productId: p.id, x, z, rotated }, f = footprint(p, rotated);
        if (x + f.l > truck.length - margin + EPS || z + f.w > truck.width - margin + EPS) continue;
        if (plan.placed.some(b => { const q = products.find(p => p.id === b.productId)!; const clearance = requiredGap(p, q, gap, rules); return !separated(a, p, b, q, clearance) || !ordered(a, p, b, q, clearance, rules, lines); })) continue;
        found = a; break outer;
      }
      if (found) { plan.placed.push(found); weight += p.weight; } else plan.unplaced.push({ id, productId: p.id, reason: 'Encaixe não encontrado respeitando separação e prioridade. Reveja quantidades ou use outro veículo.' });
    }
    candidates.push(plan);
  }
  candidates.sort((a, b) => b.placed.length - a.placed.length || area(b, products) - area(a, products));
  const best = candidates[0], errors = validatePlan(truck, products, best, gap, rules, lines); if (errors.length) throw new Error(errors.join(' ')); return best;
}
export function area(plan: Plan, products: Product[]) { return plan.placed.reduce((s, a) => { const p = products.find(p => p.id === a.productId)!; return s + p.length * p.width; }, 0); }
export function totalWeight(plan: Plan, products: Product[]) { return plan.placed.reduce((s, a) => s + (products.find(p => p.id === a.productId)?.weight ?? 0), 0); }

export type AxleDistribution = {
  totalWeight: number;
  centerOfGravityX: number; // Distância média da cabine em cm
  centerOfGravityZ: number; // Distância média da lateral esquerda em cm
  cgPercentX: number; // % do comprimento do baú (0% = colado na cabine, 100% = na porta)
  frontAxleWeight: number; // Estimativa de peso transferido ao eixo dianteiro (kg)
  rearAxleWeight: number; // Estimativa de peso transferido ao eixo traseiro (kg)
  frontAxlePercent: number; // % do peso no eixo dianteiro
  rearAxlePercent: number; // % do peso no eixo traseiro
  leftWeight: number; // Peso no lado esquerdo do baú (kg)
  rightWeight: number; // Peso no lado direito do baú (kg)
  lateralBalancePercent: number; // Variação lateral (-100% todo na esquerda, +100% todo na direita)
  lateralStatus: 'equilibrado' | 'atencao' | 'desbalanceado';
  longitudinalStatus: 'equilibrado' | 'sobrecarga_cabine' | 'sobrecarga_traseira';
};

/**
 * Calcula o Centro de Gravidade (CG) longitudinal e transversal da carga
 * e estima a distribuição de peso entre eixo dianteiro e eixo traseiro.
 */
export function calculateAxleDistribution(truck: Truck, products: Product[], plan: Plan): AxleDistribution {
  const weight = totalWeight(plan, products);
  if (weight <= 0 || !plan.placed.length || truck.length <= 0 || truck.width <= 0) {
    return {
      totalWeight: 0,
      centerOfGravityX: 0,
      centerOfGravityZ: 0,
      cgPercentX: 0,
      frontAxleWeight: 0,
      rearAxleWeight: 0,
      frontAxlePercent: 50,
      rearAxlePercent: 50,
      leftWeight: 0,
      rightWeight: 0,
      lateralBalancePercent: 0,
      lateralStatus: 'equilibrado',
      longitudinalStatus: 'equilibrado'
    };
  }

  let momentX = 0;
  let momentZ = 0;
  let leftWeight = 0;
  let rightWeight = 0;
  const midZ = truck.width / 2;

  for (const item of plan.placed) {
    const product = products.find(p => p.id === item.productId);
    if (!product) continue;
    const f = footprint(product, item.rotated);
    const itemCenterX = item.x + f.l / 2;
    const itemCenterZ = item.z + f.w / 2;
    const itemWeight = product.weight;

    momentX += itemWeight * itemCenterX;
    momentZ += itemWeight * itemCenterZ;

    if (itemCenterZ < midZ) {
      leftWeight += itemWeight;
    } else {
      rightWeight += itemWeight;
    }
  }

  const cgX = momentX / weight;
  const cgZ = momentZ / weight;
  const cgPercentX = (cgX / truck.length) * 100;

  // Em caminhões médios (toco / 3/4), o centro geométrico do entre-eixos normalmente
  // fica localizado entre 40% e 55% do comprimento do baú.
  // Modelagem por alavanca estática simples:
  const rearAxlePercent = Math.min(100, Math.max(0, (cgX / truck.length) * 100));
  const frontAxlePercent = 100 - rearAxlePercent;
  const frontAxleWeight = (weight * frontAxlePercent) / 100;
  const rearAxleWeight = (weight * rearAxlePercent) / 100;

  // Análise lateral
  const lateralDiff = Math.abs(leftWeight - rightWeight);
  const lateralRatio = weight > 0 ? (lateralDiff / weight) * 100 : 0;
  const lateralBalancePercent = weight > 0 ? ((rightWeight - leftWeight) / weight) * 100 : 0;

  let lateralStatus: AxleDistribution['lateralStatus'] = 'equilibrado';
  if (lateralRatio > 25) lateralStatus = 'desbalanceado';
  else if (lateralRatio > 12) lateralStatus = 'atencao';

  let longitudinalStatus: AxleDistribution['longitudinalStatus'] = 'equilibrado';
  if (cgPercentX < 28) longitudinalStatus = 'sobrecarga_cabine';
  else if (cgPercentX > 72) longitudinalStatus = 'sobrecarga_traseira';

  return {
    totalWeight: weight,
    centerOfGravityX: cgX,
    centerOfGravityZ: cgZ,
    cgPercentX,
    frontAxleWeight,
    rearAxleWeight,
    frontAxlePercent,
    rearAxlePercent,
    leftWeight,
    rightWeight,
    lateralBalancePercent,
    lateralStatus,
    longitudinalStatus
  };
}

export type ManifestStep = {
  palletId: string;
  loadOrder: number; // 1 = primeiro a entrar no caminhão
  unloadOrder: number; // 1 = primeiro a sair na entrega
  product: Product;
  positionX: number;
  positionZ: number;
  rotated: boolean;
  destination: string;
  deliveryOrder: number;
  fragile: boolean;
  requiresStrap: boolean;
  cumulativeWeight: number;
};

/**
 * Gera a ordem física de carregamento (LIFO / FIFO) e o romaneio completo de expedição.
 */
export function generateManifest(
  truck: Truck,
  products: Product[],
  lines: Line[],
  plan: Plan,
  rules: DistributionRules = DEFAULT_RULES
): ManifestStep[] {
  if (!plan.placed.length) return [];

  // Ordena para carregamento: paletes mais próximos da cabine (menor X) entram primeiro.
  // Em caso de empate de X, quem está na lateral esquerda entra primeiro.
  const sorted = [...plan.placed].sort((a, b) => a.x - b.x || a.z - b.z);

  let cumulativeWeight = 0;
  const steps: ManifestStep[] = sorted.map((placement, index) => {
    const product = products.find(p => p.id === placement.productId)!;
    const line = lines.find(l => l.productId === placement.productId);
    cumulativeWeight += product.weight;

    return {
      palletId: placement.id,
      loadOrder: index + 1,
      unloadOrder: sorted.length - index,
      product,
      positionX: placement.x,
      positionZ: placement.z,
      rotated: placement.rotated,
      destination: line?.destination || (rules.sameDestination ? 'Destino Principal' : 'Geral'),
      deliveryOrder: line?.deliveryOrder || 1,
      fragile: product.fragile,
      requiresStrap: product.fragile,
      cumulativeWeight
    };
  });

  return steps;
}

/**
 * Predefinições de Veículos Padrão de Carga Rodoviária no Brasil (ABNT / CONTRAN)
 */
export const PRESET_TRUCKS: Truck[] = [
  {
    id: 'preset-truck-vuc',
    name: 'Caminhão 3/4 (VUC Baú Urbano)',
    length: 450,
    width: 220,
    height: 220,
    doorWidth: 210,
    doorHeight: 210,
    capacity: 3500
  },
  {
    id: 'preset-truck-toco',
    name: 'Caminhão Toco (Médio Semipesado)',
    length: 650,
    width: 245,
    height: 250,
    doorWidth: 240,
    doorHeight: 240,
    capacity: 6500
  },
  {
    id: 'preset-truck-truck-6x2',
    name: 'Caminhão Truck (6x2 Baú Grande)',
    length: 850,
    width: 250,
    height: 260,
    doorWidth: 245,
    doorHeight: 250,
    capacity: 14000
  },
  {
    id: 'preset-truck-carreta',
    name: 'Carreta Baú Rodoviária (Semirreboque)',
    length: 1460,
    width: 250,
    height: 270,
    doorWidth: 245,
    doorHeight: 260,
    capacity: 25000
  }
];

/**
 * Predefinições de Paletes Padronizados (PBR ABRAS e Euro)
 */
export const PRESET_PRODUCTS: Product[] = [
  {
    id: 'preset-prod-pbr-industrial',
    name: 'Palete PBR Carga Seca / Industrial',
    category: 'Manufaturados',
    color: '#2563eb',
    length: 120,
    width: 100,
    baseHeight: 15,
    height: 145,
    weight: 680,
    rotate: true,
    fragile: false
  },
  {
    id: 'preset-prod-pbr-bebidas',
    name: 'Palete PBR Bebidas / Alimentos Pesados',
    category: 'Alimentos e Bebidas',
    color: '#0891b2',
    length: 120,
    width: 100,
    baseHeight: 15,
    height: 150,
    weight: 950,
    rotate: true,
    fragile: false
  },
  {
    id: 'preset-prod-euro-farma',
    name: 'Palete Euro (EPAL) Farmacêutico',
    category: 'Saúde e Higiene',
    color: '#059669',
    length: 120,
    width: 80,
    baseHeight: 14,
    height: 130,
    weight: 420,
    rotate: true,
    fragile: false
  },
  {
    id: 'preset-prod-fragil-vidros',
    name: 'Palete Carga Frágil (Vidros / Cerâmica)',
    category: 'Frágil / Delicado',
    color: '#dc2626',
    length: 120,
    width: 100,
    baseHeight: 15,
    height: 120,
    weight: 380,
    rotate: false,
    fragile: true
  },
  {
    id: 'preset-prod-eletro',
    name: 'Palete Eletrodomésticos / Eletrônicos',
    category: 'Linha Branca / Tech',
    color: '#7c3aed',
    length: 120,
    width: 100,
    baseHeight: 15,
    height: 175,
    weight: 320,
    rotate: true,
    fragile: true
  }
];

