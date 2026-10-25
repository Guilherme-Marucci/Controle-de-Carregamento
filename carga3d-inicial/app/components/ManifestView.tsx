'use client';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  type Truck,
  type Product,
  type Line,
  type Plan,
  type DistributionRules,
  generateManifest,
  totalWeight,
  area
} from '@/lib/domain';

interface ManifestViewProps {
  truck: Truck | undefined;
  products: Product[];
  lines: Line[];
  plan: Plan | null;
  rules: DistributionRules;
  onBackToPlanner?: () => void;
}

export default function ManifestView({
  truck,
  products,
  lines,
  plan,
  rules,
  onBackToPlanner
}: ManifestViewProps) {
  const [driverName, setDriverName] = useState('Motorista Padrão');
  const [licensePlate, setLicensePlate] = useState('BRA-2026');

  const manifestSteps = useMemo(() => {
    if (!truck || !plan || !plan.placed.length) return [];
    return generateManifest(truck, products, lines, plan, rules);
  }, [truck, products, lines, plan, rules]);

  const weight = plan ? totalWeight(plan, products) : 0;
  const occupiedArea = (truck && plan) ? (area(plan, products) / (truck.length * truck.width)) * 100 : 0;

  function handlePrint() {
    window.print();
  }

  function handleExportCSV() {
    if (!manifestSteps.length) return;
    const headers = [
      'Ordem Entrada (Carregamento)',
      'Ordem Saida (Entrega)',
      'ID Palete',
      'Produto',
      'Categoria',
      'Peso (kg)',
      'Peso Acumulado (kg)',
      'X Cabine (cm)',
      'Z Lateral (cm)',
      'Destino',
      'Parada',
      'Frágil',
      'Exige Amarração'
    ];

    const rows = manifestSteps.map((s) => [
      s.loadOrder,
      s.unloadOrder,
      s.palletId,
      `"${s.product.name.replace(/"/g, '""')}"`,
      `"${s.product.category.replace(/"/g, '""')}"`,
      s.product.weight,
      s.cumulativeWeight,
      s.positionX.toFixed(1),
      s.positionZ.toFixed(1),
      `"${s.destination.replace(/"/g, '""')}"`,
      s.deliveryOrder,
      s.fragile ? 'SIM' : 'NÃO',
      s.requiresStrap ? 'SIM (CINTA)' : 'PADRÃO'
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `romaneio_carga_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (!truck || !plan || !plan.placed.length) {
    return (
      <div className="panel empty p-12 text-center bg-white rounded-xl border border-slate-200">
        <svg className="w-16 h-16 text-slate-300 mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        <h3 className="text-lg font-bold text-slate-800">Nenhum plano de carga ativo</h3>
        <p className="text-sm text-slate-500 max-w-md mx-auto mt-2">
          Gere uma distribuição no simulador 3D para gerar o Romaneio de Carga e a Ordem de Expedição.
        </p>
        {onBackToPlanner && (
          <Button onClick={onBackToPlanner} className="mt-6 bg-[#dc672d] hover:bg-[#c95922] text-white">
            Ir para Planejamento 3D
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controles do topo - invisíveis na impressão */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm print:hidden">
        <div className="flex items-center gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-500 block">Motorista Responsável</label>
            <input
              type="text"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              className="text-sm font-medium border border-slate-300 rounded px-2.5 py-1 focus:ring-1 focus:ring-[#dc672d]"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block">Placa do Veículo</label>
            <input
              type="text"
              value={licensePlate}
              onChange={(e) => setLicensePlate(e.target.value)}
              className="text-sm font-medium border border-slate-300 rounded px-2.5 py-1 focus:ring-1 focus:ring-[#dc672d]"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleExportCSV} className="gap-2 text-slate-700">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Exportar CSV
          </Button>
          <Button onClick={handlePrint} className="gap-2 bg-[#dc672d] hover:bg-[#c95922] text-white shadow-sm">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Imprimir Romaneio (A4)
          </Button>
        </div>
      </div>

      {/* Documento Imprimível de Romaneio */}
      <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm print:shadow-none print:border-none print:p-0">
        {/* Cabeçalho do Romaneio */}
        <div className="border-b-2 border-slate-800 pb-5 mb-6">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-xs uppercase tracking-widest font-bold text-orange-600">
                Logística & Distribuição de Cargas
              </div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
                ROMANEIO DE EXPEDIÇÃO & ORDEM DE CARREGAMENTO
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                Documento emitido em {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-slate-800">CARGA3D INDUSTRIAL</div>
              <div className="text-xs text-slate-500">Módulo de Otimização e Segurança</div>
              <div className="mt-2 inline-block border border-slate-300 rounded px-3 py-1 font-mono text-xs font-bold text-slate-800">
                DOC: {licensePlate.replace(/[^a-zA-Z0-9]/g, '')}-{Date.now().toString().slice(-6)}
              </div>
            </div>
          </div>

          {/* Cards de Especificações do Veículo e Operação */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 bg-slate-50 p-4 rounded-lg border border-slate-200 text-xs">
            <div>
              <span className="text-slate-500 block">Veículo / Carroceria:</span>
              <strong className="text-slate-900 text-sm">{truck.name}</strong>
              <div className="text-[11px] text-slate-600 mt-0.5">
                {(truck.length / 100).toFixed(2)}m × {(truck.width / 100).toFixed(2)}m × {(truck.height / 100).toFixed(2)}m útil
              </div>
            </div>
            <div>
              <span className="text-slate-500 block">Motorista / Placa:</span>
              <strong className="text-slate-900 text-sm">{driverName}</strong>
              <div className="text-[11px] text-slate-600 mt-0.5">Placa: {licensePlate}</div>
            </div>
            <div>
              <span className="text-slate-500 block">Carga Total Planejada:</span>
              <strong className="text-slate-900 text-sm">{manifestSteps.length} paletes</strong>
              <div className="text-[11px] text-slate-600 mt-0.5">
                {weight.toLocaleString('pt-BR')} kg ({((weight / truck.capacity) * 100).toFixed(1)}% capacidade)
              </div>
            </div>
            <div>
              <span className="text-slate-500 block">Regra Operacional:</span>
              <strong className="text-slate-900 text-sm">
                {rules.sameDestination ? 'Destino Único' : 'Múltiplas Paradas'}
              </strong>
              <div className="text-[11px] text-slate-600 mt-0.5">
                Ocupação: {occupiedArea.toFixed(1)}% do piso
              </div>
            </div>
          </div>
        </div>

        {/* Alerta Operacional / Segurança */}
        <div className="mb-6 p-3 bg-amber-50 border-l-4 border-amber-500 rounded text-xs text-amber-900 flex items-start gap-2">
          <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <div>
            <strong>INSTRUÇÃO DE CARREGAMENTO FÍSICO:</strong> Carregue os paletes estritamente na <strong>Ordem de Entrada (1º ao último)</strong>. Os paletes de número 1 ficam ao fundo da carroceria (próximos à cabine). Paletes identificados como <strong>Frágeis exigem amarração com cinta homologada</strong> antes de fechar o compartimento.
          </div>
        </div>

        {/* Tabela de Carregamento Passo a Passo */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 uppercase tracking-wider text-[11px] border-y border-slate-300">
                <th className="py-2.5 px-3 font-bold text-center w-12">Seq. Entr.</th>
                <th className="py-2.5 px-3 font-bold text-center w-12">Seq. Saída</th>
                <th className="py-2.5 px-3 font-bold">Identificação Palete</th>
                <th className="py-2.5 px-3 font-bold">Produto / Categoria</th>
                <th className="py-2.5 px-3 font-bold text-center">Posição (X / Z)</th>
                <th className="py-2.5 px-3 font-bold text-right">Peso Un.</th>
                <th className="py-2.5 px-3 font-bold text-right">Peso Acum.</th>
                <th className="py-2.5 px-3 font-bold">Destino / Parada</th>
                <th className="py-2.5 px-3 font-bold text-center">Proteção</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {manifestSteps.map((step) => (
                <tr
                  key={step.palletId}
                  className={`hover:bg-slate-50 transition-colors ${
                    step.fragile ? 'bg-amber-50/40' : ''
                  }`}
                >
                  <td className="py-2.5 px-3 font-bold text-center text-slate-900">
                    <span className="inline-block bg-slate-800 text-white rounded-full w-6 h-6 leading-6 text-[11px]">
                      {step.loadOrder}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-semibold text-center text-slate-500">
                    #{step.unloadOrder}
                  </td>
                  <td className="py-2.5 px-3 font-mono font-medium text-slate-800">
                    {step.palletId}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded shrink-0 shadow-sm"
                        style={{ background: step.product.color }}
                      />
                      <div>
                        <div className="font-semibold text-slate-900">{step.product.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {step.product.length} × {step.product.width} × {step.product.height} cm
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center font-mono text-slate-600">
                    X: {step.positionX.toFixed(0)}cm / Z: {step.positionZ.toFixed(0)}cm
                    {step.rotated && <span className="text-[10px] text-orange-600 font-bold block">(Girado 90°)</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right font-medium text-slate-800">
                    {step.product.weight.toLocaleString('pt-BR')} kg
                  </td>
                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                    {step.cumulativeWeight.toLocaleString('pt-BR')} kg
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="font-medium text-slate-800">{step.destination}</span>
                    <span className="text-[10px] text-slate-500 block">Parada #{step.deliveryOrder}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {step.fragile ? (
                      <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 px-2 py-0.5 rounded text-[10px] font-bold">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        Frágil + Cinta
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[11px]">Padrão</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Assinaturas / Checklist de Saída */}
        <div className="mt-12 pt-8 border-t border-slate-300 grid grid-cols-2 gap-12 text-center text-xs">
          <div>
            <div className="border-b border-slate-400 pb-1 mb-2"></div>
            <div className="font-bold text-slate-800">Assinatura do Conferente / Expedição</div>
            <div className="text-slate-500 text-[11px]">Carga conferida, pesada e amarrada</div>
          </div>
          <div>
            <div className="border-b border-slate-400 pb-1 mb-2"></div>
            <div className="font-bold text-slate-800">Assinatura do Motorista Transportador</div>
            <div className="text-slate-500 text-[11px]">{driverName} ({licensePlate})</div>
          </div>
        </div>
      </div>
    </div>
  );
}
