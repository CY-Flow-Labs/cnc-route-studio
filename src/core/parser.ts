import type { Diagnostic, MachineConfig, MotionKind, MotionSegment, ParseResult, Point4, ProgramSource, WorkOffsetCode } from '../types';

const zero=():Point4=>({x:0,y:0,z:0,w:0});
const dist=(a:Point4,b:Point4)=>Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z,b.w-a.w);
const arcDist=(a:Point4,b:Point4,c:Point4,plane:string,cw:boolean)=>{const axes=plane==='G18'?(['x','z','y'] as const):plane==='G19'?(['y','z','x'] as const):(['x','y','z'] as const),[u,v,linear]=axes,start=Math.atan2(a[v]-c[v],a[u]-c[u]),end=Math.atan2(b[v]-c[v],b[u]-c[u]);let sweep=end-start;if(cw){if(sweep>=0)sweep-=Math.PI*2;}else if(sweep<=0)sweep+=Math.PI*2;const radius=(Math.hypot(a[u]-c[u],a[v]-c[v])+Math.hypot(b[u]-c[u],b[v]-c[v]))/2,planar=Math.abs(sweep)*radius;return Math.hypot(planar,b[linear]-a[linear],b.w-a.w);};
const cutterGeometry=(start:Point4,end:Point4,center:Point4|undefined,kind:MotionKind,plane:MotionSegment['plane'],mode:0|41|42,radius:number)=>{
  if(!mode||radius===0)return {start:{...start},end:{...end},center:center?{...center}:undefined};
  const [u,v]=plane==='G18'?(['x','z'] as const):plane==='G19'?(['y','z'] as const):(['x','y'] as const),shift=(p:Point4,du:number,dv:number)=>({...p,[u]:p[u]+du,[v]:p[v]+dv});
  if(center&&(kind==='arc-cw'||kind==='arc-ccw')){const nominal=Math.hypot(start[u]-center[u],start[v]-center[v]);if(nominal<=1e-9)return {start:{...start},end:{...end},center:{...center}};const outside=(kind==='arc-cw')===(mode===41),toolRadius=Math.max(0,nominal+(outside?radius:-radius)),scale=toolRadius/nominal,arcPoint=(p:Point4)=>({...p,[u]:center[u]+(p[u]-center[u])*scale,[v]:center[v]+(p[v]-center[v])*scale});return {start:arcPoint(start),end:arcPoint(end),center:{...center}};}
  const du=end[u]-start[u],dv=end[v]-start[v],length=Math.hypot(du,dv);if(length<=1e-9)return {start:{...start},end:{...end},center:center?{...center}:undefined};const side=mode===41?1:-1,ou=-dv/length*radius*side,ov=du/length*radius*side;return {start:shift(start,ou,ov),end:shift(end,ou,ov),center:center?shift(center,ou,ov):undefined};
};
type CutterMeta={nominalStart:Point4;nominalEnd:Point4;nominalCenter?:Point4;mode:0|41|42;radius:number};
const planeAxes=(plane:MotionSegment['plane'])=>plane==='G18'?(['x','z'] as const):plane==='G19'?(['y','z'] as const):(['x','y'] as const);
const lineIntersection=(a0:Point4,a1:Point4,b0:Point4,b1:Point4,plane:MotionSegment['plane'])=>{const [u,v]=planeAxes(plane),adx=a1[u]-a0[u],ady=a1[v]-a0[v],bdx=b1[u]-b0[u],bdy=b1[v]-b0[v],den=adx*bdy-ady*bdx;if(Math.abs(den)<1e-9)return undefined;const t=((b0[u]-a0[u])*bdy-(b0[v]-a0[v])*bdx)/den;return {...a1,[u]:a0[u]+t*adx,[v]:a0[v]+t*ady};};
const radiusArcCenter=(start:Point4,end:Point4,signedRadius:number,plane:MotionSegment['plane'],cw:boolean)=>{const [u,v]=planeAxes(plane),du=end[u]-start[u],dv=end[v]-start[v],chord=Math.hypot(du,dv),programmedRadius=Math.abs(signedRadius),radius=Math.max(programmedRadius,chord/2);if(chord<1e-9||chord-programmedRadius*2>0.01)return undefined;const mu=(start[u]+end[u])/2,mv=(start[v]+end[v])/2,h=Math.sqrt(Math.max(0,radius*radius-chord*chord/4)),pu=-dv/chord,pv=du/chord,candidates=[{...start,[u]:mu+pu*h,[v]:mv+pv*h},{...start,[u]:mu-pu*h,[v]:mv-pv*h}],sweep=(center:Point4)=>{const a=Math.atan2(start[v]-center[v],start[u]-center[u]),b=Math.atan2(end[v]-center[v],end[u]-center[u]);let angle=b-a;if(cw){if(angle>=0)angle-=Math.PI*2;}else if(angle<=0)angle+=Math.PI*2;return Math.abs(angle);},wantLong=signedRadius<0;return candidates.find(center=>wantLong?sweep(center)>Math.PI+1e-9:sweep(center)<=Math.PI+1e-9)??candidates[0];};
const stripComments=(s:string)=>s.replace(/\([^)]*\)/g,'').replace(/;.*$/,'').trim().toUpperCase();

function evaluate(expr:string, vars:Map<number,number>):number|undefined {
  const replaced=expr.replace(/#(\d+)/g,(_,n)=>String(vars.get(Number(n))??NaN)).replace(/\[/g,'(').replace(/\]/g,')').replace(/--/g,'+').replace(/\+\-/g,'-');
  if(!/^[\d+\-*/().\sEeNa]+$/.test(replaced)) return undefined;
  try { const value=Function(`"use strict";return (${replaced})`)(); return Number.isFinite(value)?value:undefined; } catch { return undefined; }
}

function expandExpressions(line:string,vars:Map<number,number>):string {
  let out=line;
  for(let guard=0;guard<20&&(/\[[^\[\]]+\]/.test(out));guard++) out=out.replace(/\[([^\[\]]+)\]/g,(all,e)=>{const v=evaluate(e,vars);return v===undefined?all:String(v);});
  out=out.replace(/#(\d+)/g,(all,n)=>vars.has(Number(n))?String(vars.get(Number(n))):all);
  return out;
}

export function parseProgram(source:ProgramSource, rapidRate=8000, availableSubprograms:string[]=[], machine?:MachineConfig):ParseResult {
  const vars=new Map<number,number>(Object.entries(machine?.customVariables??{}).map(([n,v])=>[Number(n),Number(v)])), blocks:ParseResult['blocks']=[], segments:MotionSegment[]=[], diagnostics:Diagnostic[]=[], variableWrites:ParseResult['variableWrites']=[],macroCalls:ParseResult['macroCalls']=[];
  const toolGeometry={...(machine?.toolLengthOffsets??{})}, toolWear={...(machine?.toolWearOffsets??{})};
  const workOffsets=Object.fromEntries((['G54','G55','G56','G57','G58','G59'] as WorkOffsetCode[]).map(k=>[k,{...(machine?.workOffsets?.[k]??zero())}])) as MachineConfig['workOffsets'];
  Object.entries(toolGeometry).forEach(([n,v])=>vars.set((machine?.toolOffsetCount===400?(machine?.toolOffsetMemory==='B'?11000:10000):machine?.toolOffsetMemory==='B'?2200:2000)+Number(n),v));
  if(machine?.toolOffsetMemory==='B')Object.entries(toolWear).forEach(([n,v])=>vars.set((machine.toolOffsetCount===400?10000:2000)+Number(n),v));
  (Object.keys(workOffsets) as WorkOffsetCode[]).forEach((code,ci)=>(['x','y','z','w'] as const).forEach((axis,ai)=>vars.set(2501+ai*100+ci,workOffsets[code][axis])));
  const knownSubs=new Set(availableSubprograms.map(n=>String(Number(n)).padStart(4,'0')));
  const initialOffset=workOffsets.G54;
  // 模擬唯一固定基準是機械原點 0；未啟用刀長時相對起點 = 機械 0 - G54。
  let pos:Point4={x:initialOffset.x===0?0:-initialOffset.x,y:initialOffset.y===0?0:-initialOffset.y,z:initialOffset.z===0?0:-initialOffset.z,w:initialOffset.w===0?0:-initialOffset.w}, absolute=true, units=1, motion:MotionKind='rapid', feed=0, spindle=0, spindleTool=0, pendingTool=0, plane:MotionSegment['plane']='G17', workOffset:WorkOffsetCode='G54',localOffset=zero(), toolLengthComp=0, cutterComp:0|41|42=0,cutterRadius=0,cutterOffsetNumber=0,cycleReturnInitial=true, cycleMode:number|undefined,cycleZ:number|undefined,cycleR:number|undefined,cycleQ:number|undefined,cycleP=0,rotaryCode:31|32|33|34=machine?.rotary?.zeroCode??31;
  const cutterMeta=new Map<MotionSegment,CutterMeta>();
  const relativeOrigin={...pos};
  const offset=()=>workOffsets?.[workOffset]??zero();
  // 工件原點的機械位置 = G54（G55…）。
  // 相對座標 = 機械座標 - 工件原點補正 - 刀長補正；反算機械座標時加回兩項補正。
  const machinePoint=(p:Point4):Point4=>({x:p.x+offset().x+localOffset.x,y:p.y+offset().y+localOffset.y,z:p.z+offset().z+localOffset.z+toolLengthComp,w:p.w+offset().w+localOffset.w});
  const pointFromMachine=(p:Point4):Point4=>({x:p.x-offset().x-localOffset.x,y:p.y-offset().y-localOffset.y,z:p.z-offset().z-localOffset.z-toolLengthComp,w:p.w-offset().w-localOffset.w});
  const relativePoint=(p:Point4):Point4=>({x:p.x-relativeOrigin.x,y:p.y-relativeOrigin.y,z:p.z-relativeOrigin.z,w:p.w-relativeOrigin.w});
  const updateSystemVariables=()=>{const mp=machinePoint(pos);(['x','y','z','w'] as const).forEach((axis,i)=>{vars.set(5021+i,mp[axis]);vars.set(5041+i,pos[axis]);});vars.set(5083,toolLengthComp);};
  const commonKind=(n:number)=>n>=100&&n<=149?'common':n>=500&&n<=531?'permanent':machine?.additionalCommonVariables&&n>=150&&n<=199?'common':machine?.additionalCommonVariables&&n>=532&&n<=999?'permanent':undefined;
  const assign=(n:number,value:number,line:number,local:Diagnostic[])=>{
    const common=commonKind(n);
    if(n>=1&&n<=33){vars.set(n,value);variableWrites.push({line,variable:n,value,kind:'local'});return;}
    if(common){vars.set(n,value);variableWrites.push({line,variable:n,value,kind:common});return;}
    if((n>=100&&n<=199)||(n>=500&&n<=999)){local.push({severity:'error',line,code:'VARIABLE_OPTION_REQUIRED',message:`#${n} 需要啟用 FANUC 0M 追加共用變數選配`});return;}
    const count=machine?.toolOffsetCount??200;
    let offsetNo=0,part:'geometry'|'wear'='geometry';
    if(machine?.toolOffsetMemory==='B'){
      if(n>=2001&&n<=2000+Math.min(count,200)){offsetNo=n-2000;part='wear';}
      else if(n>=2201&&n<=2200+Math.min(count,200)){offsetNo=n-2200;part='geometry';}
    }else if(n>=2001&&n<=2000+Math.min(count,200))offsetNo=n-2000;
    if(!offsetNo&&count===400&&n>=10001&&n<=10400){offsetNo=n-10000;part=machine?.toolOffsetMemory==='B'?'wear':'geometry';}
    if(!offsetNo&&count===400&&machine?.toolOffsetMemory==='B'&&n>=11001&&n<=11400){offsetNo=n-11000;part='geometry';}
    if(offsetNo){(part==='wear'?toolWear:toolGeometry)[String(offsetNo)]=value;vars.set(n,value);variableWrites.push({line,variable:n,value,kind:'tool-offset'});return;}
    if(n>=2501&&n<=2806){const axisIndex=Math.floor((n-2500)/100),codeIndex=n%100;if(axisIndex>=0&&axisIndex<=3&&codeIndex>=1&&codeIndex<=6){const code=`G${53+codeIndex}` as WorkOffsetCode,axis=(['x','y','z','w'] as const)[axisIndex];workOffsets[code][axis]=value;vars.set(n,value);variableWrites.push({line,variable:n,value,kind:'work-offset'});return;}}
    if((n>=5001&&n<=5104)||(n>=4001&&n<=4130)){local.push({severity:'error',line,code:'READ_ONLY_SYSTEM_VARIABLE',message:`#${n} 是 FANUC 位置／模態唯讀系統變數，程式不能寫入`});return;}
    local.push({severity:'warning',line,code:'UNSUPPORTED_SYSTEM_VARIABLE',message:`#${n} 不在目前 FANUC 0M 可寫入變數設定內`});
  };
  const lines=source.text.replace(/\r/g,'').split('\n');
  lines.forEach((raw,index)=>{
    const line=source.lineMap?.[index]??index+1, local:Diagnostic[]=[]; updateSystemVariables();
    // G54～G59、G43/G49 或補正變數改變時，先固定真實機械位置，再重新表示相對座標。
    const physicalBeforeModal=machinePoint(pos);
    const skipped=machine?.optionalBlockSkip&&/^\s*\//.test(raw); let clean=skipped?'':stripComments(raw).replace(/^\s*\//,'');
    const assignment=clean.match(/^#(\d+)\s*=\s*(.+)$/);
    if(assignment){const value=evaluate(assignment[2],vars);if(value===undefined)local.push({severity:'warning',line,code:'MACRO_EXPRESSION',message:`無法解析巨集指定 ${clean}`});else assign(Number(assignment[1]),value,line,local);clean='';}
    clean=expandExpressions(clean,vars);
    const words:Record<string,number>={};
    for(const match of clean.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)) words[match[1]]=Number(match[2]);
    const gcodes=[...clean.matchAll(/G\s*(\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
    const rotaryCommand=[...clean.matchAll(/M\s*0*(3[1-4])\b/g)].map(m=>Number(m[1])).at(-1);if(rotaryCommand)rotaryCode=rotaryCommand as 31|32|33|34;
    const isMacroCall=gcodes.includes(65),macroExpanded=isMacroCall&&/G65_EXPANDED/i.test(raw);
    const isG10L2=gcodes.includes(10)&&words.L===2;
    const isG52=gcodes.includes(52);
    if(isG10L2){const p=words.P;if(p===undefined||p<1||p>6)local.push({severity:'error',line,code:'G10_WORK_OFFSET_RANGE',message:'G10 L2 的 P 必須是 1～6（G54～G59）'});else{const code=`G${53+p}` as WorkOffsetCode;for(const [ai,axis] of (['x','y','z','w'] as const).entries()){const v=words[axis.toUpperCase()];if(v!==undefined){const applied=v*units;workOffsets[code][axis]=applied;const variable=2501+ai*100+(p-1);vars.set(variable,applied);variableWrites.push({line,variable,value:applied,kind:'work-offset'});}}}}
    if(gcodes.includes(90)) absolute=true;if(gcodes.includes(91)) absolute=false;if(gcodes.includes(20)) units=25.4;if(gcodes.includes(21)) units=1;
    if(gcodes.includes(98))cycleReturnInitial=true;if(gcodes.includes(99))cycleReturnInitial=false;
    if(gcodes.includes(17))plane='G17';if(gcodes.includes(18))plane='G18';if(gcodes.includes(19))plane='G19';
    for(let g=54;g<=59;g++)if(gcodes.includes(g))workOffset=`G${g}` as WorkOffsetCode;
    if(isG52)for(const axis of ['x','y','z','w'] as const){const value=words[axis.toUpperCase()];if(value!==undefined)localOffset[axis]=value*units;}
    if(gcodes.includes(49))toolLengthComp=0;
    if(gcodes.includes(43)){const h=words.H;if(h===undefined)local.push({severity:'warning',line,code:'MISSING_TOOL_LENGTH_OFFSET',message:'G43 缺少 H 刀長補正號碼'});else if(h<1||h>(machine?.toolOffsetCount??200))local.push({severity:'error',line,code:'TOOL_OFFSET_RANGE',message:`H${h} 超出目前設定的 ${machine?.toolOffsetCount??200} 組刀補`});else if(toolGeometry[String(h)]===undefined&&toolWear[String(h)]===undefined)local.push({severity:'warning',line,code:'UNDEFINED_TOOL_LENGTH_OFFSET',message:`H${h} 尚未定義刀長補正`});else toolLengthComp=(toolGeometry[String(h)]??0)+(machine?.toolOffsetMemory==='B'?(toolWear[String(h)]??0):0);}
    if(!isMacroCall&&words.D!==undefined){cutterOffsetNumber=Math.trunc(words.D);const geometry=toolGeometry[String(cutterOffsetNumber)],wear=toolWear[String(cutterOffsetNumber)];if(geometry===undefined&&wear===undefined){cutterRadius=0;local.push({severity:'warning',line,code:'UNDEFINED_CUTTER_OFFSET',message:`D${cutterOffsetNumber} 尚未定義刀徑補正，G41/G42 不偏移刀路`});}else cutterRadius=(geometry??0)+(wear??0);}
    if(gcodes.includes(40)){cutterComp=0;cutterRadius=0;}else if(gcodes.includes(41)||gcodes.includes(42)){cutterComp=gcodes.includes(41)?41:42;if(!cutterOffsetNumber)local.push({severity:'warning',line,code:'MISSING_CUTTER_OFFSET',message:`G${cutterComp} 缺少 D 刀徑補正號碼`});}
    pos=pointFromMachine(physicalBeforeModal);
    if(gcodes.includes(0))motion='rapid';if(gcodes.includes(1))motion='cut';if(gcodes.includes(2))motion='arc-cw';if(gcodes.includes(3))motion='arc-ccw';
    const cycle=gcodes.find(g=>[73,76,81,82,83,84,85,86,87,88,89].includes(g)); if(cycle) motion='cycle'; if(gcodes.includes(80)) motion='rapid';
    if(!isMacroCall&&words.F!==undefined)feed=words.F*units;if(!isMacroCall&&words.S!==undefined)spindle=words.S;if(!isMacroCall&&words.T!==undefined)pendingTool=words.T;if(/M\s*0*6\b/.test(clean)&&pendingTool)spindleTool=pendingTool;
    const subCall=clean.match(/M\s*98\s*P\s*(\d+)/),macroCall=clean.match(/G\s*(6[56])\s*P\s*(\d+)/);
    const missingSub=!!subCall&&!knownSubs.has(String(Number(subCall[1])).padStart(4,'0'));
    if(missingSub)local.push({severity:'warning',line,code:'MISSING_SUBPROGRAM',message:`缺少 P${Number(subCall![1])} 副程式本體；此呼叫未運算`});
    if(macroCall){const number=String(Number(macroCall[2])).padStart(4,'0'),argumentVariables:Record<string,number>={A:1,B:2,C:3,I:4,J:5,K:6,D:7,E:8,F:9,H:11,M:13,Q:17,R:18,S:19,T:20,U:21,V:22,W:23,X:24,Y:25,Z:26},args:Record<string,{variable:number;value:number}>={};for(const [address,variable] of Object.entries(argumentVariables))if(words[address]!==undefined)args[address]={variable,value:words[address]};macroCalls.push({line,program:number,repeat:Math.max(1,Math.trunc(words.L??1)),arguments:args});if(!knownSubs.has(number))local.push({severity:'warning',line,code:'MISSING_MACRO',message:`缺少 O${number} 巨集本體；G${macroCall[1]} 呼叫未運算`});else if(!macroExpanded)local.push({severity:'warning',line,code:'UNEXECUTED_MACRO',message:`O${number} 巨集尚未展開；請由完整程式分段執行`});}
    const canned=gcodes.find(g=>[73,76,81,82,83,84,85,86,87,88,89].includes(g));if(gcodes.includes(80))cycleMode=undefined;if(canned)cycleMode=canned;
    if(canned){const initialZ=pos.z;if(words.R!==undefined)cycleR=absolute?words.R*units:initialZ+words.R*units;if(words.Z!==undefined)cycleZ=absolute?words.Z*units:(cycleR??initialZ)+words.Z*units;if(words.Q!==undefined)cycleQ=Math.abs(words.Q*units);if(words.P!==undefined)cycleP=Math.max(0,words.P/1000);}
    const supportedCycle=cycleMode!==undefined&&[81,82,83,84].includes(cycleMode),activeCycle=supportedCycle&&(canned!==undefined||['X','Y'].some(axis=>words[axis]!==undefined));
    if(/#\d+|\[[^\]]*\]/.test(clean)) local.push({severity:'warning',line,code:'UNRESOLVED_MACRO',message:'仍有無法解析的巨集或變數；未知動作已略過'});
    // G2/G3 允許省略終點、只以 I/J/K 指定圓心；此 FANUC 寫法代表完整 360° 圓。
    const hasAxis=!isMacroCall&&!isG10L2&&!isG52&&(['X','Y','Z','W'].some(a=>words[a]!==undefined)||((motion==='arc-cw'||motion==='arc-ccw')&&['I','J','K'].some(a=>words[a]!==undefined)));
    let seg:MotionSegment|undefined;const blockMotions:MotionSegment[]=[];
    const addSegment=(end:Point4,kind:MotionKind,suffix:string,center?:Point4,extraSeconds=0)=>{const nominalStart={...pos},length=center&&(kind==='arc-cw'||kind==='arc-ccw')?arcDist(nominalStart,end,center,plane,kind==='arc-cw'):dist(nominalStart,end),rate=kind==='rapid'?rapidRate:feed;if(kind!=='rapid'&&rate<=0&&!local.some(d=>d.code==='NO_FEED'))local.push({severity:'warning',line,code:'NO_FEED',message:'切削移動沒有有效進給率'});const zeroCode=machine?.rotary?.zeroCode??31,direction=machine?.rotary?.direction??1,rotaryAngle=((rotaryCode-zeroCode+4)%4)*90*direction;const made:MotionSegment={id:`${source.name}:${line}:${index}:${suffix}`,line,raw,kind,plane,start:nominalStart,end:{...end},machineStart:machinePoint(nominalStart),machineEnd:machinePoint(end),relativeStart:relativePoint(nominalStart),relativeEnd:relativePoint(end),workOffset,workOffsetValue:{...offset()},localOffset:{...localOffset},toolLengthComp,center:center?{...center}:undefined,feed,spindle,tool:spindleTool,estimatedSeconds:(rate>0?length/rate*60:0)+extraSeconds,rotaryCode,rotaryAngle};cutterMeta.set(made,{nominalStart,nominalEnd:{...end},nominalCenter:center?{...center}:undefined,mode:cutterComp,radius:cutterRadius});segments.push(made);blockMotions.push(made);pos={...end};return made;};
    if(activeCycle&&cycleMode===83&&!local.some(d=>d.code==='UNRESOLVED_MACRO')){
      const initialZ=pos.z,q=cycleQ??0,r=cycleR,target=cycleZ,d=Math.max(0,machine?.g83Clearance??0);
      if(!machine?.g83ClearanceConfigured&&!diagnostics.some(item=>item.code==='UNCONFIRMED_G83_CLEARANCE'))local.push({severity:'warning',line,code:'UNCONFIRMED_G83_CLEARANCE',message:'尚未確認 G83 再接近間隙 d；目前以 0 mm 計算快速接近點'});
      if(!q||r===undefined||target===undefined)local.push({severity:'warning',line,code:'UNEXPANDED_CANNED_CYCLE',message:'G83 需要有效的 Z、Q、R；本節未展開'});
      else{const positioned={...pos};for(const axis of ['x','y','w'] as const){const v=words[axis.toUpperCase()];if(v!==undefined)positioned[axis]=absolute?v*units:positioned[axis]+v*units;}if(dist(pos,positioned)>0)addSegment(positioned,'rapid','g83-position');if(pos.z!==r)addSegment({...pos,z:r},'rapid','g83-r');const direction=target<r?-1:1;let depth=r,peck=0;while((direction<0&&depth>target)||(direction>0&&depth<target)){if(peck>0){const approach=direction<0?Math.min(r,depth+d):Math.max(r,depth-d);if(pos.z!==approach)addSegment({...pos,z:approach},'rapid',`g83-approach-${peck+1}`);}const next=direction<0?Math.max(target,depth-q):Math.min(target,depth+q);addSegment({...pos,z:next},'cut',`g83-cut-${++peck}`);depth=next;if(depth!==target)addSegment({...pos,z:r},'rapid',`g83-retract-${peck}`);}const returnZ=cycleReturnInitial?initialZ:r;if(pos.z!==returnZ)addSegment({...pos,z:returnZ},'rapid','g83-return');seg=blockMotions.at(-1);}
    }else if(activeCycle&&!local.some(d=>d.code==='UNRESOLVED_MACRO')){
      const initialZ=pos.z,r=cycleR,target=cycleZ,mode=cycleMode!;
      if(r===undefined||target===undefined)local.push({severity:'warning',line,code:'UNEXPANDED_CANNED_CYCLE',message:`G${mode} 需要有效的 Z、R；本節未展開`});
      else{const positioned={...pos};for(const axis of ['x','y','w'] as const){const v=words[axis.toUpperCase()];if(v!==undefined)positioned[axis]=absolute?v*units:positioned[axis]+v*units;}if(dist(pos,positioned)>0)addSegment(positioned,'rapid',`g${mode}-position`);if(pos.z!==r)addSegment({...pos,z:r},'rapid',`g${mode}-r`);addSegment({...pos,z:target},'cut',`g${mode}-feed`,undefined,mode===82?cycleP:0);if(mode===84){addSegment({...pos,z:r},'cut','g84-reverse');if(cycleReturnInitial&&r!==initialZ)addSegment({...pos,z:initialZ},'rapid','g84-return');}else{const returnZ=cycleReturnInitial?initialZ:r;if(pos.z!==returnZ)addSegment({...pos,z:returnZ},'rapid',`g${mode}-return`);}seg=blockMotions.at(-1);}
    }else if(canned||cycleMode&&!supportedCycle&&hasAxis){local.push({severity:'warning',line,code:'UNEXPANDED_CANNED_CYCLE',message:`G${canned??cycleMode} 需要機台循環參數／主軸定位資料；為避免假刀路，本節未模擬`});}
    if(hasAxis&&!activeCycle&&!canned&&!cycleMode && !local.some(d=>d.code==='UNRESOLVED_MACRO')) {
      const end={...pos}; for(const axis of ['x','y','z','w'] as const){const v=words[axis.toUpperCase()];if(v!==undefined)end[axis]=absolute?v*units:end[axis]+v*units;}
      let center:Point4|undefined;
      if(motion==='arc-cw'||motion==='arc-ccw'){if(words.R!==undefined){center=radiusArcCenter(pos,end,words.R*units,plane,motion==='arc-cw');if(!center)local.push({severity:'error',line,code:'INVALID_ARC_RADIUS',message:`R${words.R} 無法連接目前起點與終點`});}else{center={...pos};if(plane==='G17'){center.x+=Number(words.I||0)*units;center.y+=Number(words.J||0)*units;}else if(plane==='G18'){center.x+=Number(words.I||0)*units;center.z+=Number(words.K||0)*units;}else{center.y+=Number(words.J||0)*units;center.z+=Number(words.K||0)*units;}}}
      seg=addSegment(end,motion,'motion',center);
    }
    if((gcodes.includes(41)||gcodes.includes(42))&&!hasAxis)local.push({severity:'warning',line,code:'CUTTER_COMP_START_WITHOUT_MOVE',message:`FANUC 標準啟動格式須在 G${cutterComp} 單節同時指定 G00/G01 移動；模擬器沿用至下一移動單節`});
    diagnostics.push(...local);blocks.push({line,raw,normalized:clean.replace(/\s+/g,''),words,motion:seg,motions:blockMotions,diagnostics:local});
  });
  // FANUC 刀徑補正會預讀下一移動單節。先建立各段的平行補正線，再以相鄰補正線交點形成轉角；
  // 這會同時改變轉角的 X 與 Y（或所選平面的另外兩軸），不能只把單一線段平移後硬接。
  for(const segment of segments){const meta=cutterMeta.get(segment)!;const shown=cutterGeometry(meta.nominalStart,meta.nominalEnd,meta.nominalCenter,segment.kind,segment.plane,meta.mode,meta.radius);segment.start=shown.start;segment.end=shown.end;segment.center=shown.center;}
  for(let i=0;i<segments.length-1;i++){const current=segments[i],next=segments[i+1],a=cutterMeta.get(current)!,b=cutterMeta.get(next)!;if(dist(a.nominalEnd,b.nominalStart)>1e-7||!a.mode||a.mode!==b.mode||a.radius!==b.radius||current.plane!==next.plane||a.nominalCenter||b.nominalCenter||!['rapid','cut'].includes(current.kind)||!['rapid','cut'].includes(next.kind))continue;const corner=lineIntersection(current.start,current.end,next.start,next.end,current.plane);if(corner){current.end={...corner};next.start={...corner};}}
  for(let i=0;i<segments.length-1;i++){const current=segments[i],next=segments[i+1],a=cutterMeta.get(current)!,b=cutterMeta.get(next)!;if(dist(a.nominalEnd,b.nominalStart)>1e-7)continue;if(!a.mode&&b.mode)next.start={...current.end};else if(a.mode&&!b.mode)next.start={...current.end};}
  for(const segment of segments){const l=segment.localOffset;segment.machineStart={x:segment.start.x+segment.workOffsetValue.x+l.x,y:segment.start.y+segment.workOffsetValue.y+l.y,z:segment.start.z+segment.workOffsetValue.z+l.z+segment.toolLengthComp,w:segment.start.w+segment.workOffsetValue.w+l.w};segment.machineEnd={x:segment.end.x+segment.workOffsetValue.x+l.x,y:segment.end.y+segment.workOffsetValue.y+l.y,z:segment.end.z+segment.workOffsetValue.z+l.z+segment.toolLengthComp,w:segment.end.w+segment.workOffsetValue.w+l.w};segment.relativeStart=relativePoint(segment.start);segment.relativeEnd=relativePoint(segment.end);const rate=segment.kind==='rapid'?rapidRate:segment.feed,extra=segment.estimatedSeconds-(rate>0?(cutterMeta.get(segment)!.nominalCenter&&['arc-cw','arc-ccw'].includes(segment.kind)?arcDist(cutterMeta.get(segment)!.nominalStart,cutterMeta.get(segment)!.nominalEnd,cutterMeta.get(segment)!.nominalCenter!,segment.plane,segment.kind==='arc-cw'):dist(cutterMeta.get(segment)!.nominalStart,cutterMeta.get(segment)!.nominalEnd))/rate*60:0),length=segment.center&&['arc-cw','arc-ccw'].includes(segment.kind)?arcDist(segment.start,segment.end,segment.center,segment.plane,segment.kind==='arc-cw'):dist(segment.start,segment.end);segment.estimatedSeconds=(rate>0?length/rate*60:0)+Math.max(0,extra);}
  const points=segments.flatMap(s=>[s.start,s.end]); const min=zero(),max=zero();
  for(const axis of ['x','y','z','w'] as const){min[axis]=points.length?Math.min(...points.map(p=>p[axis])):0;max[axis]=points.length?Math.max(...points.map(p=>p[axis])):0;}
  const rapidDistance=segments.filter(s=>s.kind==='rapid').reduce((n,s)=>n+dist(s.start,s.end),0),cutDistance=segments.filter(s=>s.kind!=='rapid').reduce((n,s)=>n+dist(s.start,s.end),0);
  const finalVariables=Object.fromEntries([...vars].filter(([n])=>(n>=1&&n<=33)||!!commonKind(n)).map(([n,v])=>[String(n),v]));
  return {source,blocks,segments,diagnostics,variableWrites,macroCalls,finalVariables,finalToolGeometry:toolGeometry,finalToolWear:toolWear,finalWorkOffsets:workOffsets,finalSpindleTool:spindleTool,finalPendingTool:pendingTool,complete:!diagnostics.some(d=>d.severity==='error'||['MISSING_SUBPROGRAM','MISSING_MACRO','UNEXECUTED_MACRO','UNRESOLVED_MACRO','UNEXPANDED_CANNED_CYCLE'].includes(d.code)),bounds:{min,max},totals:{rapidDistance,cutDistance,estimatedSeconds:segments.reduce((n,s)=>n+s.estimatedSeconds,0),tools:[...new Set(segments.map(s=>s.tool).filter(Boolean))]}};
}
