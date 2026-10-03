'use client';
import {Input} from '@/components/ui/input';
import type {DistributionRules,Line,Product} from '@/lib/domain';
export default function DistributionControls({rules,lines,products,disabled,onRules,onLines}:{rules:DistributionRules;lines:Line[];products:Product[];disabled:boolean;onRules:(r:DistributionRules)=>void;onLines:(l:Line[])=>void}){
 return <section className="distribution-controls" aria-label="Regras de distribuição">
  <div className="divider"/><div className="section-label">03 / DISTRIBUIÇÃO</div>
  <label className="field">Todos vão para o mesmo destino?<select disabled={disabled} value={rules.sameDestination?'yes':'no'} onChange={e=>onRules({...rules,sameDestination:e.target.value==='yes'})}><option value="yes">Sim · organizar por peso</option><option value="no">Não · organizar por entrega</option></select></label>
  {rules.sameDestination?<label className="field">Colocar os mais leves<select disabled={disabled} value={rules.lightEnd} onChange={e=>onRules({...rules,lightEnd:e.target.value as 'cab'|'door'})}><option value="cab">Na frente · perto da cabine</option><option value="door">Atrás · perto da porta traseira</option></select></label>:<>
   <p className="modal-help">A entrega 1 fica mais perto da porta traseira. A última fica mais perto da cabine. Produtos da mesma parada devem usar o mesmo destino e número.</p>
   {lines.map(l=><fieldset className="delivery-fields" key={l.productId}><legend>{products.find(p=>p.id===l.productId)?.name}</legend><label className="field">Destino<Input disabled={disabled} maxLength={100} value={l.destination??''} placeholder="Ex.: Loja Centro" onChange={e=>onLines(lines.map(item=>item.productId===l.productId?{...item,destination:e.target.value}:item))}/></label><label className="field">Ordem de entrega<Input disabled={disabled} type="number" min={1} max={100} step={1} value={l.deliveryOrder??''} onChange={e=>onLines(lines.map(item=>item.productId===l.productId?{...item,deliveryOrder:e.target.value===''?undefined:Number(e.target.value)}:item))}/></label></fieldset>)}
  </>}
  <label className="field">Separação de frágeis (cm)<Input disabled={disabled} type="number" min={0.5} max={100} step={0.5} value={rules.fragileClearance} onChange={e=>onRules({...rules,fragileClearance:Number(e.target.value)})}/></label>
  <p className="modal-help">Faixa livre obrigatória ao redor de cada palete frágil. Aplica-se a maior distância entre esta separação e a folga geral. O valor inicial é ilustrativo.</p>
  <div className="notice warn">Frágeis: separação e amarração com cinta obrigatórias na execução. O desenho da cinta é indicativo; não dimensiona fixação nem garante proteção contra esmagamento.</div>
 </section>;
}
