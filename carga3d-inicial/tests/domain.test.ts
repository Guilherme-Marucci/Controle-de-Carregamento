import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planCargo,
  validatePlan,
  calculateAxleDistribution,
  generateManifest,
  PRESET_TRUCKS,
  PRESET_PRODUCTS,
  DEFAULT_RULES,
  type Line
} from '../lib/domain.ts';
import { truckSchema, productSchema, workspaceSchema } from '../lib/validation.ts';

test('PRESET_TRUCKS devem atender estritamente ao schema de caminhões', () => {
  assert.equal(PRESET_TRUCKS.length >= 4, true, 'Deve conter ao menos 4 caminhões');
  for (const truck of PRESET_TRUCKS) {
    const validated = truckSchema.safeParse(truck);
    assert.equal(validated.success, true, `Caminhão ${truck.name} falhou na validação`);
    assert.equal(truck.doorWidth <= truck.width, true);
    assert.equal(truck.doorHeight <= truck.height, true);
  }
});

test('PRESET_PRODUCTS devem atender estritamente ao schema de produtos e paletes', () => {
  assert.equal(PRESET_PRODUCTS.length >= 5, true, 'Deve conter ao menos 5 tipos de paletes');
  for (const prod of PRESET_PRODUCTS) {
    const validated = productSchema.safeParse(prod);
    assert.equal(validated.success, true, `Produto ${prod.name} falhou na validação`);
    assert.equal(prod.height >= prod.baseHeight, true);
  }
});

test('Motor de cálculo planCargo acomoda paletes respeitando folgas e regras', () => {
  const truck = PRESET_TRUCKS[1]; // Toco (650x245cm, 6500kg)
  const prods = PRESET_PRODUCTS;
  const lines: Line[] = [
    { productId: prods[0].id, quantity: 4 }, // PBR Carga Seca
    { productId: prods[1].id, quantity: 2 }, // PBR Bebidas
    { productId: prods[3].id, quantity: 2 }  // Frágil Vidros
  ];

  const plan = planCargo(truck, prods, lines, 2, DEFAULT_RULES);
  assert.equal(plan.placed.length, 8, 'Todos os 8 paletes devem ser posicionados no Toco');
  assert.equal(plan.unplaced.length, 0, 'Nenhum palete deve ficar de fora');

  const errors = validatePlan(truck, prods, plan, 2, DEFAULT_RULES, lines);
  assert.equal(errors.length, 0, `Plano gerou erros de validação: ${errors.join('; ')}`);
});

test('Simulador de balança e Centro de Gravidade (calculateAxleDistribution)', () => {
  const truck = PRESET_TRUCKS[1];
  const prods = PRESET_PRODUCTS;
  const lines: Line[] = [
    { productId: prods[0].id, quantity: 4 },
    { productId: prods[1].id, quantity: 2 }
  ];

  const plan = planCargo(truck, prods, lines, 2, DEFAULT_RULES);
  const axle = calculateAxleDistribution(truck, prods, plan);

  assert.equal(axle.totalWeight > 0, true, 'Peso total deve ser maior que zero');
  assert.equal(axle.frontAxlePercent + axle.rearAxlePercent, 100, 'Soma das porcentagens deve ser 100%');
  assert.equal(axle.frontAxleWeight + axle.rearAxleWeight, axle.totalWeight, 'Soma dos pesos deve bater com total');
  assert.equal(axle.centerOfGravityX > 0, true, 'Centro de gravidade X deve ser positivo');
  assert.equal(axle.centerOfGravityX < truck.length, true, 'CG deve estar dentro do comprimento do baú');
  assert.match(axle.lateralStatus, /equilibrado|atencao|desbalanceado/);
});

test('Geração de Romaneio de Expedição e Ordem de Carregamento (generateManifest)', () => {
  const truck = PRESET_TRUCKS[1];
  const prods = PRESET_PRODUCTS;
  const lines: Line[] = [
    { productId: prods[0].id, quantity: 3, destination: 'Filial Sul', deliveryOrder: 1 },
    { productId: prods[3].id, quantity: 1, destination: 'Matriz', deliveryOrder: 2 }
  ];

  const plan = planCargo(truck, prods, lines, 2, { sameDestination: false, lightEnd: 'cab', fragileClearance: 10 });
  const manifest = generateManifest(truck, prods, lines, plan, { sameDestination: false, lightEnd: 'cab', fragileClearance: 10 });

  assert.equal(manifest.length, 4, 'Manifesto deve conter 4 itens');
  assert.equal(manifest[0].loadOrder, 1, 'Primeiro item deve ter loadOrder 1');
  assert.equal(manifest[manifest.length - 1].loadOrder, 4, 'Último item deve ter loadOrder 4');
  
  // O item que entra primeiro (mais perto da cabine, menor X) é o último a sair
  assert.equal(manifest[0].unloadOrder, 4);
  assert.equal(manifest[manifest.length - 1].unloadOrder, 1);

  // Palete frágil deve ter requiresStrap = true
  const fragileStep = manifest.find(s => s.fragile);
  assert.ok(fragileStep, 'Deve haver um palete frágil no romaneio');
  assert.equal(fragileStep.requiresStrap, true, 'Palete frágil deve exigir cinta de amarração');
});
