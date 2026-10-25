'use client';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  type Workspace,
  type SavedLoad,
  totalWeight,
  area
} from '@/lib/domain';

interface DashboardViewProps {
  data: Workspace;
  onOpenLoad: (load: SavedLoad) => void;
  onNewLoad: () => void;
  onNavigateTab: (tab: 'planner' | 'trucks' | 'products' | 'loads' | 'manifest' | 'axles') => void;
}

export default function DashboardView({
  data,
  onOpenLoad,
  onNewLoad,
  onNavigateTab
}: DashboardViewProps) {
  const stats = useMemo(() => {
    const totalLoads = data.loads.length;
    const totalTrucks = data.trucks.length;
    const totalProducts = data.products.length;

    let cumulativeWeight = 0;
    let cumulativePallets = 0;
    let cumulativeOccupancy = 0;

    data.loads.forEach((load) => {
      const w = totalWeight(load.plan, load.products);
      cumulativeWeight += w;
      cumulativePallets += load.plan.placed.length;
      if (load.truck.length > 0 && load.truck.width > 0) {
        const occ = (area(load.plan, load.products) / (load.truck.length * load.truck.width)) * 100;
        cumulativeOccupancy += occ;
      }
    });

    const avgWeight = totalLoads > 0 ? cumulativeWeight / totalLoads : 0;
    const avgPallets = totalLoads > 0 ? cumulativePallets / totalLoads : 0;
    const avgOccupancy = totalLoads > 0 ? cumulativeOccupancy / totalLoads : 0;

    return {
      totalLoads,
      totalTrucks,
      totalProducts,
      cumulativeWeight,
      cumulativePallets,
      avgWeight,
      avgPallets,
      avgOccupancy
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Cards de KPIs Principais */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Cargas Salvas no Histórico</div>
          <div className="text-3xl font-black text-slate-900 tracking-tight">
            {stats.totalLoads}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {stats.cumulativePallets} paletes totais planejados
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Ocupação Média do Baú</div>
          <div className="text-3xl font-black text-emerald-600 tracking-tight">
            {stats.avgOccupancy.toFixed(1)} <span className="text-base font-normal text-slate-500">%</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Aproveitamento da área útil dos veículos
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Peso Médio por Viagem</div>
          <div className="text-3xl font-black text-slate-900 tracking-tight">
            {stats.avgWeight.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}{' '}
            <span className="text-base font-normal text-slate-500">kg</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Média de {stats.avgPallets.toFixed(1)} paletes por carregamento
          </p>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs uppercase font-bold text-slate-500 mb-1">Frota & Catálogo Ativos</div>
          <div className="text-3xl font-black text-orange-600 tracking-tight">
            {stats.totalTrucks} <span className="text-sm font-normal text-slate-500">caminhões</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {stats.totalProducts} produtos cadastrados
          </p>
        </div>
      </div>

      {/* Seção Central: Ações Rápidas & Histórico Recente */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Painel de Ações Rápidas */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-base mb-2">Painel Operacional Rápido</h3>
            <p className="text-xs text-slate-500 mb-6">
              Acesse as ferramentas essenciais de carregamento e gestão logística.
            </p>

            <div className="space-y-3">
              <Button
                onClick={onNewLoad}
                className="w-full justify-start gap-3 bg-[#dc672d] hover:bg-[#c95922] text-white shadow-sm font-semibold"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Iniciar Novo Carregamento 3D
              </Button>

              <Button
                variant="outline"
                onClick={() => onNavigateTab('trucks')}
                className="w-full justify-start gap-3 text-slate-700 hover:bg-slate-50"
              >
                <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 5h12v12H2zM14 10h4l4 4v3h-8"/>
                  <circle cx="6" cy="18" r="2"/>
                  <circle cx="18" cy="18" r="2"/>
                </svg>
                Gerenciar Frota de Caminhões
              </Button>

              <Button
                variant="outline"
                onClick={() => onNavigateTab('products')}
                className="w-full justify-start gap-3 text-slate-700 hover:bg-slate-50"
              >
                <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m12 3 9 5v9l-9 5-9-5V8z"/>
                  <path d="m3 8 9 5 9-5M12 13v9M8 5l9 5"/>
                </svg>
                Cadastrar Paletes & Produtos
              </Button>

              <Button
                variant="outline"
                onClick={() => onNavigateTab('manifest')}
                className="w-full justify-start gap-3 text-slate-700 hover:bg-slate-50"
              >
                <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                Ver Romaneio de Expedição
              </Button>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-500">
            Dica: Utilize paletes padronizados PBR para garantir o melhor encaixe no baú.
          </div>
        </div>

        {/* Tabela de Cargas Recentes */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 pb-4 mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Últimos Planejamentos Realizados</h3>
              <p className="text-xs text-slate-500">Histórico de planos salvos no servidor local</p>
            </div>
            <Button
              variant="ghost"
              onClick={() => onNavigateTab('loads')}
              className="text-xs text-orange-600 hover:text-orange-700"
            >
              Ver todos →
            </Button>
          </div>

          {data.loads.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-sm">Nenhum planejamento salvo ainda.</p>
              <Button onClick={onNewLoad} variant="outline" className="mt-3 text-xs">
                Planejar Primeira Carga
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.loads.slice(0, 5).map((load) => {
                const w = totalWeight(load.plan, load.products);
                const occ =
                  load.truck.length > 0 && load.truck.width > 0
                    ? (area(load.plan, load.products) / (load.truck.length * load.truck.width)) * 100
                    : 0;

                return (
                  <div key={load.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 text-sm truncate">{load.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {load.truck.name} · {load.plan.placed.length} paletes · {w.toLocaleString('pt-BR')} kg ·{' '}
                        {occ.toFixed(0)}% ocupação
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenLoad(load)}
                        className="text-xs h-8 text-slate-700"
                      >
                        Abrir 3D
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
