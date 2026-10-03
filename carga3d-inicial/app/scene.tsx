'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { footprint, requiredGap, type Truck, type Product, type Plan, type DistributionRules } from '@/lib/domain';
type Point=[number,number,number];
type Face={points:Point[];fill:string;id?:string;label?:string;depth:number};
export default function Scene({truck,products,plan,rules,gap=0,selected,onSelect}:{truck:Truck;products:Product[];plan:Plan;rules?:DistributionRules;gap?:number;selected:string|null;onSelect:(id:string)=>void}){
 const [yaw,setYaw]=useState(-0.58),[pitch,setPitch]=useState(.60),[zoom,setZoom]=useState(1);const drag=useRef<{x:number;y:number;yaw:number;pitch:number;id?:string}|null>(null);
 const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 const depth=([x,y,z]:Point)=>(-x*s+z*c)*cp+y*sp;
 const raw=([x,y,z]:Point)=>[(x-truck.length/2)*c+(z-truck.width/2)*s,((-(x-truck.length/2)*s+(z-truck.width/2)*c)*sp-(y-truck.height/2)*cp)];
 const corners:Point[]=[[0,0,0],[truck.length,0,0],[0,0,truck.width],[truck.length,0,truck.width],[0,truck.height,0],[truck.length,truck.height,0],[0,truck.height,truck.width],[truck.length,truck.height,truck.width]];
 const r=corners.map(raw),minX=Math.min(...r.map(p=>p[0])),maxX=Math.max(...r.map(p=>p[0])),minY=Math.min(...r.map(p=>p[1])),maxY=Math.max(...r.map(p=>p[1]));
 const scale=Math.min(760/(maxX-minX+130),350/(maxY-minY+80))*zoom;
 const project=(p:Point)=>{const q=raw(p);return [460+(q[0]-(maxX+minX)/2)*scale,245+(q[1]-(maxY+minY)/2)*scale];};
 const points=(ps:Point[])=>ps.map(p=>project(p).join(',')).join(' ');
 const faces:Face[]=[];
 function box(x:number,y:number,z:number,l:number,h:number,w:number,color:string,id?:string,label?:string){
  const v:Point[]=[[x,y,z],[x+l,y,z],[x+l,y,z+w],[x,y,z+w],[x,y+h,z],[x+l,y+h,z],[x+l,y+h,z+w],[x,y+h,z+w]];
  [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7]].forEach((indices,i)=>{const ps=indices.map(j=>v[j]);faces.push({points:ps,fill:color,id,label:i===4?label:undefined,depth:ps.reduce((s,p)=>s+depth(p),0)/4});});
 }
 box(-3,-10,-3,truck.length+6,10,truck.width+6,'#bac5cc');
 // The deck is below every pallet; paint it first to avoid spanning-face artifacts.
 const floorFaces=faces.splice(0);
 // A simplified cab and wheels anchor the load to the actual vehicle envelope.
 box(-102,-2,18,90,115,truck.width-36,'#364756');box(-90,113,25,67,43,truck.width-50,'#a5bfcb');
 for(const x of [-65,truck.length*.72,truck.length*.86])for(const z of [-8,truck.width-12])box(x,-42,z,35,40,20,'#28343e');
 plan.placed.forEach((a,index)=>{const p=products.find(p=>p.id===a.productId);if(!p)return;const {l,w}=footprint(p,a.rotated);
  box(a.x,0,a.z,l,p.baseHeight,w,'#b9976d',a.id);
  box(a.x,p.baseHeight,a.z,l,p.height-p.baseHeight,w,p.color,a.id,String(index+1).padStart(2,'0'));
 });
 faces.sort((a,b)=>a.depth-b.depth);
 const line=(a:Point,b:Point,key:string,style?:React.CSSProperties)=><line key={key} x1={project(a)[0]} y1={project(a)[1]} x2={project(b)[0]} y2={project(b)[1]} style={style} stroke="#8ba0af" strokeWidth="1"/>;
 const edges=[[0,1],[0,2],[1,3],[2,3],[4,5],[4,6],[5,7],[6,7],[0,4],[1,5],[2,6],[3,7]];
 return <div className="scene-shell">
  <div className="scene-top"><span className="scene-label"><i/> VISUALIZAÇÃO DA CARGA</span><span>Medidas em centímetros</span></div>
  <svg className="scene" viewBox="0 0 920 470" role="img" aria-label="Vista tridimensional do caminhão e dos paletes. Arraste para girar ou use os botões de vista." onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,yaw,pitch,id:(e.target as Element).closest('[data-pallet]')?.getAttribute('data-pallet')??undefined};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current){setYaw(drag.current.yaw+(e.clientX-drag.current.x)*.008);setPitch(Math.max(.15,Math.min(1.5,drag.current.pitch+(e.clientY-drag.current.y)*.006)));}}} onPointerUp={e=>{if(drag.current?.id&&Math.hypot(e.clientX-drag.current.x,e.clientY-drag.current.y)<5)onSelect(drag.current.id);drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
   <defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#d4dde1"/></pattern></defs>
   <rect width="920" height="470" fill="url(#dots)"/>
   <ellipse cx="470" cy="353" rx="320" ry="55" fill="#334155" opacity=".055"/>
   {floorFaces.map((f,i)=><polygon key={`floor-${i}`} points={points(f.points)} fill={f.fill} stroke="#9aaab5" strokeWidth=".6"/>)}
   {rules&&plan.placed.map(a=>{const p=products.find(p=>p.id===a.productId);if(!p?.fragile)return null;const {l,w}=footprint(p,a.rotated),g=requiredGap(p,undefined,gap,rules);return <polygon key={`zone-${a.id}`} points={points([[a.x-g,1,a.z-g],[a.x+l+g,1,a.z-g],[a.x+l+g,1,a.z+w+g],[a.x-g,1,a.z+w+g]])} fill="#f5b843" fillOpacity=".2" stroke="#a96b10" strokeDasharray="4 3" strokeWidth="1.3" aria-label={`Separação obrigatória de ${g} cm · ${p.name}`}/>;})}
   {faces.map((f,i)=><g key={i} data-pallet={f.id} style={{cursor:f.id?'pointer':'grab'}}><polygon points={points(f.points)} fill={f.fill} stroke={selected===f.id?'#172d40':'#ffffff'} strokeWidth={selected===f.id?2.5:.7} strokeOpacity={selected===f.id?1:.45}/><polygon points={points(f.points)} fill="#102735" opacity={i%3===0?.13:i%3===1?.03:0} pointerEvents="none"/>{f.label&&<text x={project(f.points.reduce((a,p)=>a.map((v,j)=>v+p[j]/4) as Point,[0,0,0] as Point))[0]} y={project(f.points.reduce((a,p)=>a.map((v,j)=>v+p[j]/4) as Point,[0,0,0] as Point))[1]} textAnchor="middle" fill="white" fontSize="14" fontWeight="700" pointerEvents="none">{f.label}</text>}</g>)}
   {edges.map(([a,b],i)=>line(corners[a],corners[b],`edge${i}`,{strokeDasharray:i<4?'0':'5 5',opacity:.6,pointerEvents:'none'}))}
   {rules&&plan.placed.map(a=>{const p=products.find(p=>p.id===a.productId);if(!p?.fragile)return null;const {l,w}=footprint(p,a.rotated),x=a.x+l/2;return <g key={`strap-${a.id}`} data-pallet={a.id}><polyline points={points([[x,0,a.z],[x,p.height+1,a.z],[x,p.height+1,a.z+w],[x,0,a.z+w]])} fill="none" stroke="#805100" strokeWidth="4" strokeLinejoin="round"/><polyline points={points([[x,0,a.z],[x,p.height+1,a.z],[x,p.height+1,a.z+w],[x,0,a.z+w]])} fill="none" stroke="#ffce58" strokeWidth="2" strokeDasharray="6 3" aria-label="Amarração com cinta obrigatória · desenho ilustrativo, fixação não dimensionada"/></g>;})}
   <text x="42" y="429" fontSize="13" fill="#677989">FRENTE / CABINE</text><text x="745" y="429" fontSize="13" fill="#677989">PORTA TRASEIRA</text>
  </svg>
  <div className="scene-bottom"><span>Arraste para girar · clique em um palete</span><div className="view-buttons"><Button variant="outline" onClick={()=>{setYaw(-.58);setPitch(.60);setZoom(1);}}>3D</Button><Button variant="outline" onClick={()=>{setYaw(0);setPitch(Math.PI/2);setZoom(1);}}>Superior</Button><Button variant="outline" onClick={()=>{setYaw(0);setPitch(.05);setZoom(1);}}>Lateral</Button><Button variant="outline" aria-label="Diminuir zoom" onClick={()=>setZoom(v=>Math.max(.6,v-.15))}>−</Button><Button variant="outline" aria-label="Aumentar zoom" onClick={()=>setZoom(v=>Math.min(1.6,v+.15))}>+</Button></div></div>
 </div>;
}

