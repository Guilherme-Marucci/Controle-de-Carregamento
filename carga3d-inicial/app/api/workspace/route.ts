import { getChatGPTUser } from '../../chatgpt-auth';
import { database } from '@/db/store';
import { workspaceSchema, loadSchema } from '@/lib/validation';
import { validatePlan } from '@/lib/domain';
export async function GET(){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Entre para acessar seus cadastros.'},{status:401});
  try{const row=await database().prepare('SELECT data, revision FROM workspaces WHERE owner = ?').bind(user.userId).first<{data:string;revision:number}>();return Response.json(row?{data:JSON.parse(row.data),revision:row.revision}:{data:null,revision:0});}catch(e){console.error('workspace read',e);return Response.json({error:'Não foi possível carregar os cadastros. Tente novamente.'},{status:503});}
}
export async function PUT(request:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Entre para salvar seus cadastros.'},{status:401});
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Origem inválida.'},{status:403});
  let body;
  try{const raw=await request.text();if(raw.length>2000000)return Response.json({error:'Limite de dados excedido.'},{status:413});body=JSON.parse(raw);}catch{return Response.json({error:'Dados inválidos.'},{status:400});}
  const parsed=workspaceSchema.safeParse(body?.data);if(!parsed.success||!Number.isInteger(body?.revision)||body.revision<0)return Response.json({error:'Confira os campos e os limites dos cadastros.'},{status:400});
  const data=parsed.data;const revision=body.revision;
  for(const group of [data.trucks,data.products,data.loads])if(new Set(group.map(i=>i.id)).size!==group.length)return Response.json({error:'Identificadores repetidos.'},{status:400});
  let previousLoads: typeof data.loads=[];
  if(data.loads.some(load=>!load.rules)){
    try{const previous=await database().prepare('SELECT data FROM workspaces WHERE owner = ?').bind(user.userId).first<{data:string}>();previousLoads=previous?JSON.parse(previous.data).loads:[];}catch(e){console.error('legacy load read',e);return Response.json({error:'Não foi possível conferir o histórico. Tente novamente.'},{status:503});}
  }
  for(const load of data.loads){
    if(!load.rules){const original=previousLoads.find(item=>item.id===load.id);if(!original||original.rules||JSON.stringify(load)!==JSON.stringify(loadSchema.parse(original)))return Response.json({error:'Cargas novas ou alteradas precisam das regras de separação e distribuição. Recalcule o plano.'},{status:400});}
    const errors=validatePlan(load.truck,load.products,load.plan,load.gap,load.rules,load.lines);if(errors.length)return Response.json({error:errors.join(' ')},{status:400});
    const expected=load.lines.flatMap(l=>Array.from({length:l.quantity},(_,i)=>`${l.productId}-${i+1}`));const actual=[...load.plan.placed,...load.plan.unplaced];
    if(expected.length>250||new Set(expected).size!==expected.length||new Set(actual.map(a=>a.id)).size!==actual.length||expected.length!==actual.length||actual.some(a=>!expected.includes(a.id)||!load.products.some(p=>p.id===a.productId)||!load.lines.some(l=>l.productId===a.productId&&Array.from({length:l.quantity},(_,i)=>`${l.productId}-${i+1}`).includes(a.id))))return Response.json({error:'O plano não corresponde aos paletes solicitados.'},{status:400});
  }
  try{const result=await database().prepare('INSERT INTO workspaces (owner,data,revision) VALUES (?,?,1) ON CONFLICT(owner) DO UPDATE SET data=excluded.data, revision=workspaces.revision+1 WHERE workspaces.revision=?').bind(user.userId,JSON.stringify(data),revision).run();
    if(!result.meta.changes)return Response.json({error:'Os dados mudaram em outra janela. Recarregue antes de salvar.'},{status:409});return Response.json({revision:revision+1});
  }catch(e){console.error('workspace write',e);return Response.json({error:'Não foi possível salvar. Seus dados continuam na tela.'},{status:503});}
}
