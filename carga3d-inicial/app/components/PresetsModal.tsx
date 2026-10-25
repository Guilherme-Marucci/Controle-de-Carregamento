'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  type Truck,
  type Product,
  PRESET_TRUCKS,
  PRESET_PRODUCTS
} from '@/lib/domain';

interface PresetsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportTrucks: (trucks: Truck[]) => void;
  onImportProducts: (products: Product[]) => void;
  onImportDemoScenario: () => void;
}

export default function PresetsModal({
  open,
  onOpenChange,
  onImportTrucks,
  onImportProducts,
  onImportDemoScenario
}: PresetsModalProps) {
  const [selectedTrucks, setSelectedTrucks] = useState<string[]>(
    PRESET_TRUCKS.map((t) => t.id)
  );
  const [selectedProducts, setSelectedProducts] = useState<string[]>(
    PRESET_PRODUCTS.map((p) => p.id)
  );

  function toggleTruck(id: string) {
    setSelectedTrucks((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function toggleProduct(id: string) {
    setSelectedProducts((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  function handleImportSelected() {
    const trucksToAdd = PRESET_TRUCKS.filter((t) => selectedTrucks.includes(t.id));
    const productsToAdd = PRESET_PRODUCTS.filter((p) => selectedProducts.includes(p.id));

    if (trucksToAdd.length > 0) onImportTrucks(trucksToAdd);
    if (productsToAdd.length > 0) onImportProducts(productsToAdd);

    onOpenChange(false);
  }

  function handleFullDemo() {
    onImportDemoScenario();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <DialogTitle className="text-xl font-bold flex items-center gap-2">
          <svg className="w-6 h-6 text-[#dc672d]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          Biblioteca de Veículos & Paletes Padrão (Brasil)
        </DialogTitle>

        <DialogDescription className="text-xs text-slate-500 mt-1">
          Adicione caminhões e paletes normatizados pela ABNT/CONTRAN ou carregue um cenário completo de demonstração para testar o sistema imediatamente.
        </DialogDescription>

        {/* Botão de Cenário Completo de Demonstração */}
        <div className="mt-4 p-4 bg-orange-50/70 border border-orange-200 rounded-lg flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-orange-950 text-sm">Cenário Completo de Demonstração</div>
            <div className="text-xs text-orange-800 mt-0.5">
              Carrega caminhão toco, múltiplos tipos de paletes, regras de separação e calcula a distribuição 3D automaticamente.
            </div>
          </div>
          <Button
            onClick={handleFullDemo}
            className="shrink-0 bg-[#dc672d] hover:bg-[#c95922] text-white text-xs font-semibold"
          >
            Carregar Demonstração Completa
          </Button>
        </div>

        {/* Seleção de Caminhões */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Caminhões Rodoviários ({selectedTrucks.length}/{PRESET_TRUCKS.length})
            </h4>
            <button
              onClick={() =>
                setSelectedTrucks(
                  selectedTrucks.length === PRESET_TRUCKS.length
                    ? []
                    : PRESET_TRUCKS.map((t) => t.id)
                )
              }
              className="text-xs text-orange-600 hover:underline"
            >
              {selectedTrucks.length === PRESET_TRUCKS.length ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PRESET_TRUCKS.map((truck) => {
              const selected = selectedTrucks.includes(truck.id);
              return (
                <div
                  key={truck.id}
                  onClick={() => toggleTruck(truck.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selected
                      ? 'border-orange-500 bg-orange-50/30 ring-1 ring-orange-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <strong className="text-xs text-slate-900 font-semibold">{truck.name}</strong>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {}}
                      className="rounded text-orange-600"
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {(truck.length / 100).toFixed(2)}m × {(truck.width / 100).toFixed(2)}m ×{' '}
                    {(truck.height / 100).toFixed(2)}m · {truck.capacity.toLocaleString('pt-BR')} kg
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Seleção de Paletes */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Paletes Padronizados ({selectedProducts.length}/{PRESET_PRODUCTS.length})
            </h4>
            <button
              onClick={() =>
                setSelectedProducts(
                  selectedProducts.length === PRESET_PRODUCTS.length
                    ? []
                    : PRESET_PRODUCTS.map((p) => p.id)
                )
              }
              className="text-xs text-orange-600 hover:underline"
            >
              {selectedProducts.length === PRESET_PRODUCTS.length ? 'Desmarcar todos' : 'Marcar todos'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PRESET_PRODUCTS.map((prod) => {
              const selected = selectedProducts.includes(prod.id);
              return (
                <div
                  key={prod.id}
                  onClick={() => toggleProduct(prod.id)}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    selected
                      ? 'border-orange-500 bg-orange-50/30 ring-1 ring-orange-500'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ background: prod.color }}
                      />
                      <strong className="text-xs text-slate-900 font-semibold">{prod.name}</strong>
                    </div>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {}}
                      className="rounded text-orange-600"
                    />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {prod.length}×{prod.width}×{prod.height}cm · {prod.weight}kg
                    {prod.fragile ? ' · Frágil' : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Botões do Rodapé */}
        <div className="mt-8 pt-4 border-t border-slate-200 flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleImportSelected}
            className="bg-[#dc672d] hover:bg-[#c95922] text-white"
            disabled={selectedTrucks.length === 0 && selectedProducts.length === 0}
          >
            Importar Selecionados ({selectedTrucks.length + selectedProducts.length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
