'use client';
import { useMemo } from 'react';
import {
  type Truck,
  type Product,
  type Plan,
  calculateAxleDistribution
} from '@/lib/domain';

interface AxleWeightSimulatorProps {
  truck: Truck | undefined;
  products: Product[];
  plan: Plan | null;
}

export default function AxleWeightSimulator({
  truck,
  products,
  plan
}: AxleWeightSimulatorProps) {
  const axleData = useMemo(() => {
    if (!truck || !plan || !plan.placed.length) return null;
    return calculateAxleDistribution(truck, products, plan);
  }, [truck, products, plan]);

  if (!truck || !plan || !plan.placed.length || !axleData) {
    return (
      <div className="panel empty p-12 text-center bg-white rounded-xl border border-slate-200">
        <svg className="w-16 h-16 text-slate-300 mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="10"/>
          <path d="M16 12h-4V8"/>
          <path d="M12 16v-4"/>
        </svg>
        <h3 className="text-lg font-bold text-slate-800">Simulador de Eixo Indisponível</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
          Selecione um caminhão e gere a distribuição dos paletes para analisar a balança física e o Centro de Gravidade.
        </p>
      </div>
    );
  }

  const {
    totalWeight,
    centerOfGravityX,
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
  } = axleData;

  return (
    <div className="space-y-6">
      {/* Resumo Rápido com Status Geral */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Peso Total Transportado</div>
          <div className="text-2xl font-black text-slate-900 tracking-tight">
            {totalWeight.toLocaleString('pt-BR')} <span className="text-sm font-normal text-slate-500">kg</span>
          </div>
          <div className="mt-2 text-xs text-slate-600 flex justify-between">
            <span>Capacidade Máxima:</span>
            <strong>{truck.capacity.toLocaleString('pt-BR')} kg</strong>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2 mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                totalWeight > truck.capacity ? 'bg-red-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, (totalWeight / truck.capacity) * 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Distribuição Longitudinal (Eixos)</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-2.5 py-1 rounded text-xs font-bold uppercase ${
              longitudinalStatus === 'equilibrado'
                ? 'bg-emerald-100 text-emerald-800'
                : longitudinalStatus === 'sobrecarga_cabine'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
            }`}>
              {longitudinalStatus === 'equilibrado'
                ? 'Ótimo / Equilibrado'
                : longitudinalStatus === 'sobrecarga_cabine'
                ? 'Avançado na Cabine'
                : 'Sobrecarga Traseira'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Centro de Gravidade (CG) a <strong>{(centerOfGravityX / 100).toFixed(2)} m</strong> da frente ({cgPercentX.toFixed(1)}% do baú).
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Estabilidade Lateral (Esq vs Dir)</div>
          <div className="flex items-center gap-2">
            <span className={`inline-block px-2.5 py-1 rounded text-xs font-bold uppercase ${
              lateralStatus === 'equilibrado'
                ? 'bg-emerald-100 text-emerald-800'
                : lateralStatus === 'atencao'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-800'
            }`}>
              {lateralStatus === 'equilibrado'
                ? 'Simétrico / Seguro'
                : lateralStatus === 'atencao'
                ? 'Desvio Leve'
                : 'Desbalanceado'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Diferença lateral: <strong>{Math.abs(leftWeight - rightWeight).toLocaleString('pt-BR')} kg</strong> ({Math.abs(lateralBalancePercent).toFixed(1)}%).
          </p>
        </div>
      </div>

      {/* Esquema Visual da Balança do Caminhão */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-6">
          <div>
            <h3 className="font-bold text-slate-900 text-base">Esquema Físico de Carga nos Eixos</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Simulação estática baseada na posição geométrica e massa de cada palete.
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-slate-100 text-slate-700 rounded">
            Comprimento: {(truck.length / 100).toFixed(2)} m
          </span>
        </div>

        {/* Diagrama do Baú e Eixos */}
        <div className="relative py-8 px-6 bg-slate-50 rounded-xl border border-slate-200">
          {/* Caixa do Baú */}
          <div className="relative h-28 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 border-2 border-slate-700 rounded-md shadow-inner flex items-center justify-between px-4">
            {/* Cabine à esquerda */}
            <div className="absolute -left-12 top-0 bottom-0 w-12 bg-slate-800 rounded-l-md border-y-2 border-l-2 border-slate-900 flex flex-col items-center justify-center text-white text-[10px] font-bold">
              <span>CAB</span>
            </div>

            {/* Marcador do Centro de Gravidade */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-red-500 z-10 transition-all duration-300"
              style={{ left: `${Math.min(98, Math.max(2, cgPercentX))}%` }}
            >
              <div className="absolute -top-7 -translate-x-1/2 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">
                CG: {cgPercentX.toFixed(0)}%
              </div>
              <div className="absolute -bottom-2 -translate-x-1/2 w-4 h-4 bg-red-600 rounded-full border-2 border-white shadow"></div>
            </div>

            {/* Linha de centro */}
            <div className="w-full border-b border-dashed border-slate-300 pointer-events-none"></div>

            {/* Porta Traseira à direita */}
            <div className="absolute -right-4 top-0 bottom-0 w-4 bg-amber-500 rounded-r-md border-y-2 border-r-2 border-amber-600 flex items-center justify-center text-white text-[8px] font-bold">
              <span>P</span>
            </div>
          </div>

          {/* Eixos com Rodas Abaixo do Baú */}
          <div className="relative h-12 mt-2">
            {/* Eixo Dianteiro (aprox. 15% do baú) */}
            <div className="absolute left-[15%] -translate-x-1/2 flex flex-col items-center">
              <div className="w-5 h-7 bg-slate-900 rounded-sm shadow"></div>
              <span className="text-[10px] font-bold text-slate-700 mt-1">Eixo Dianteiro</span>
            </div>

            {/* Eixo Traseiro (aprox. 75% do baú) */}
            <div className="absolute left-[75%] -translate-x-1/2 flex flex-col items-center">
              <div className="flex gap-1">
                <div className="w-5 h-7 bg-slate-900 rounded-sm shadow"></div>
                <div className="w-5 h-7 bg-slate-900 rounded-sm shadow"></div>
              </div>
              <span className="text-[10px] font-bold text-slate-700 mt-1">Eixo Traseiro / Truco</span>
            </div>
          </div>
        </div>

        {/* Medidores de Carga Dianteira vs Traseira */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-slate-700">Carga no Eixo Dianteiro</span>
              <span className="text-sm font-black text-slate-900">
                {frontAxleWeight.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg ({frontAxlePercent.toFixed(1)}%)
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, frontAxlePercent)}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-500 mt-1.5 block">
              Faixa ideal recomendada: entre 35% e 48% do peso bruto da carga.
            </span>
          </div>

          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-slate-700">Carga no Eixo Traseiro (Truco)</span>
              <span className="text-sm font-black text-slate-900">
                {rearAxleWeight.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg ({rearAxlePercent.toFixed(1)}%)
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-amber-600 h-full rounded-full transition-all"
                style={{ width: `${Math.min(100, rearAxlePercent)}%` }}
              />
            </div>
            <span className="text-[11px] text-slate-500 mt-1.5 block">
              Faixa ideal recomendada: entre 52% e 65% do peso bruto da carga.
            </span>
          </div>
        </div>

        {/* Distribuição Transversal (Balanço Esquerda vs Direita) */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <h4 className="text-xs font-bold text-slate-700 uppercase mb-3">Balança Lateral (Vista Traseira)</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
              <span className="text-[11px] text-slate-500 block">Lado Esquerdo (Motorista)</span>
              <strong className="text-base text-slate-900 font-bold">
                {leftWeight.toLocaleString('pt-BR')} kg
              </strong>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {totalWeight > 0 ? ((leftWeight / totalWeight) * 100).toFixed(1) : 0}% da carga
              </div>
            </div>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded text-center">
              <span className="text-[11px] text-slate-500 block">Lado Direito (Passageiro)</span>
              <strong className="text-base text-slate-900 font-bold">
                {rightWeight.toLocaleString('pt-BR')} kg
              </strong>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {totalWeight > 0 ? ((rightWeight / totalWeight) * 100).toFixed(1) : 0}% da carga
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
