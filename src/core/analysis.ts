import type { CollisionEvent, ComparisonReport, MachineConfig, MotionSegment, ParseResult, Point4 } from '../types';
const distance=(a:Point4,b:Point4)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z,a.w-b.w);
const pointBox=(p:Point4,o:Point4,x:number,y:number,z:number,r=0)=>Math.abs(p.x-o.x)<=x/2+r&&Math.abs(p.y-o.y)<=y/2+r&&p.z>=o.z-r&&p.z<=o.z+z+r;

export function analyzeCollisions(result:ParseResult,m:MachineConfig):CollisionEvent[]{
  const events:CollisionEvent[]=[];
  for(const s of result.segments){
    for(const axis of ['x','y','z','w'] as const)if(s.machineEnd[axis]<m.limits[axis][0]||s.machineEnd[axis]>m.limits[axis][1])events.push({line:s.line,type:'overtravel',severity:'error',message:`機械 ${axis.toUpperCase()}=${s.machineEnd[axis].toFixed(3)} 超出行程 ${m.limits[axis].join('～')}`});
    const t=m.tools.find(x=>x.number===s.tool);if(s.tool&&!t)events.push({line:s.line,type:'undefined-tool',severity:'warning',message:`T${s.tool} 尚未定義刀具尺寸`});
    const radius=(t?.diameter??10)/2;
    if(s.kind==='rapid'&&pointBox(s.machineEnd,m.stock.origin,m.stock.x,m.stock.y,m.stock.z,radius))events.push({line:s.line,type:'rapid-stock',severity:'error',message:'快速移動進入毛胚範圍'});
    for(const f of m.fixtures)if(pointBox(s.machineEnd,f.origin,f.x,f.y,f.z,radius))events.push({line:s.line,type:'tool-fixture',severity:'error',message:`刀具可能碰撞夾具「${f.id}」`});
  }
  return events.filter((e,i,a)=>a.findIndex(x=>x.line===e.line&&x.type===e.type&&x.message===e.message)===i);
}

export function comparePrograms(a:ParseResult,b:ParseResult):ComparisonReport{
  const max=Math.max(a.blocks.length,b.blocks.length);let lineChanges=0;for(let i=0;i<max;i++)if(a.blocks[i]?.normalized!==b.blocks[i]?.normalized)lineChanges++;
  const ds:number[]=[];for(const s of a.segments){if(!b.segments.length)continue;ds.push(Math.min(...b.segments.map(t=>distance(s.end,t.end))));}
  return {lineChanges,maxDeviation:ds.length?Math.max(...ds):0,meanDeviation:ds.length?ds.reduce((x,y)=>x+y,0)/ds.length:0,timeDelta:b.totals.estimatedSeconds-a.totals.estimatedSeconds};
}
