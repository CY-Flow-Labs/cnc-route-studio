import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import "./viewer-fixes.css";
import "./independent-sim.css";
import { parseProgram } from "./core/parser";
import { analyzeCollisions } from "./core/analysis";
import { findProgramSections, sectionSelection } from "./core/sections";
import { comparePrograms, type DifferenceKind } from "./core/comparison";
import { defaultMachine, normalizeMachine } from "./defaults";
import { sampleA, sampleB } from "./sample";
import { Viewer } from "./components/Viewer";
import type { MachineConfig, MotionSegment, ParseResult, WorkOffsetCode } from "./types";
type ProgramOverrides = Pick<MachineConfig,"toolLengthOffsets"|"toolWearOffsets"|"customVariables"|"workOffsets">;
type LiveCodeStatus={g:string;m:string;t:string};
const liveCodeStatus=(result:ParseResult):LiveCodeStatus=>{
  const groups=new Map<string,string>();let spindle='M05',coolant='M09',lastM='—',selected=0;
  const group=(g:number)=>g>=0&&g<=3?'motion':g>=17&&g<=19?'plane':g===20||g===21?'units':g>=40&&g<=42?'cutter':g===43||g===49?'length':g>=54&&g<=59?'work':g===80||g>=81&&g<=89?'cycle':g===90||g===91?'distance':g===98||g===99?'return':'';
  for(const block of result.blocks){const code=block.normalized;for(const match of code.matchAll(/G(\d+(?:\.\d+)?)/g)){const n=+match[1],key=group(n);if(key)groups.set(key,`G${match[1].padStart(2,'0')}`);}for(const match of code.matchAll(/M(\d+)/g)){const n=+match[1],formatted=`M${match[1].padStart(2,'0')}`;lastM=formatted;if(n>=3&&n<=5)spindle=formatted;if(n>=7&&n<=9)coolant=formatted;}const t=code.match(/T(\d+)/);if(t)selected=+t[1];}
  const m=[spindle,coolant,lastM].filter((v,i,a)=>a.indexOf(v)===i).join(' ');
  return {g:[...groups.values()].join(' ')||'—',m,t:`主軸 T${result.finalSpindleTool||0}・預選 T${result.finalPendingTool||selected||0}`};
};
const emptyProgramOverrides = ():ProgramOverrides => ({toolLengthOffsets:{},toolWearOffsets:{},customVariables:{},workOffsets:{} as MachineConfig['workOffsets']});
const programMachine = (base:MachineConfig,override:ProgramOverrides):MachineConfig => ({...base,toolLengthOffsets:{...base.toolLengthOffsets,...override.toolLengthOffsets},toolWearOffsets:{...base.toolWearOffsets,...override.toolWearOffsets},customVariables:{...base.customVariables,...override.customVariables},workOffsets:Object.fromEntries((['G54','G55','G56','G57','G58','G59'] as WorkOffsetCode[]).map(code=>[code,{...base.workOffsets[code],...override.workOffsets[code]}])) as MachineConfig['workOffsets']});
const programOverrides = (base:MachineConfig,next:MachineConfig):ProgramOverrides => {
  const changed=(a:object,b:object)=>{const current=a as Record<string,number>;return Object.fromEntries(Object.entries(b).filter(([key,value])=>value!==(current[key]??0)));};
  return {toolLengthOffsets:changed(base.toolLengthOffsets,next.toolLengthOffsets),toolWearOffsets:changed(base.toolWearOffsets,next.toolWearOffsets),customVariables:changed(base.customVariables,next.customVariables),workOffsets:Object.fromEntries((['G54','G55','G56','G57','G58','G59'] as WorkOffsetCode[]).map(code=>[code,changed(base.workOffsets[code],next.workOffsets[code])])) as unknown as MachineConfig['workOffsets']};
};
function download(name: string, text: string) {
  const link = document.createElement("a"),
    url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
  link.href = url;
  link.download = name || "program.nc";
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const defaultSectionKey = (text: string) => findProgramSections(text)[0]?.key ?? "__all";
export default function App() {
  const [textA, setA] = useState(sampleA),
    [textB, setB] = useState(sampleB),
    [nameA, setNameA] = useState("demo-a.nc"),
    [nameB, setNameB] = useState("demo-b.nc"),
    [sectionA, setSectionA] = useState(() => defaultSectionKey(sampleA)),
    [sectionB, setSectionB] = useState(() => defaultSectionKey(sampleB)),
    [indexA, setIndexA] = useState(0),
    [indexB, setIndexB] = useState(0),
    [subMotionA,setSubMotionA]=useState(0),
    [subMotionB,setSubMotionB]=useState(0),
    [playingA, setPlayingA] = useState(false),
    [playingB, setPlayingB] = useState(false),
    [speedA, setSpeedA] = useState(5),
    [speedB, setSpeedB] = useState(5),
    [activeSide,setActiveSide]=useState<"A"|"B">("A"),
    [showA, setShowA] = useState(true),
    [showB, setShowB] = useState(false),
    [showFixtures, setShowFixtures] = useState(false),
    [editorBVisible, setEditorBVisible] = useState(false),
    [syncAB, setSyncAB] = useState(false),
    [editorSplit, setEditorSplit] = useState(50),
    [programAreaWidth, setProgramAreaWidth] = useState(38),
    [asideWidth, setAsideWidth] = useState(270),
    [programAreaVisible, setProgramAreaVisible] = useState(true),
    [simulationVisible, setSimulationVisible] = useState(true),
    [asideVisible, setAsideVisible] = useState(true),
    [tab, setTab] = useState<"system" | "tool" | "machine" | "macro" | "issues">("issues"),
    [machine, setMachine] = useState<MachineConfig>(() => {
      try {
        return (
          normalizeMachine(JSON.parse(localStorage.getItem("cnc-machine") || "null") || {})
        );
      } catch {
        return defaultMachine;
      }
    }),
    [overridesA,setOverridesA]=useState<ProgramOverrides>(()=>{try{return {...emptyProgramOverrides(),...JSON.parse(localStorage.getItem('cnc-program-a-overrides')||'{}')} as ProgramOverrides}catch{return emptyProgramOverrides()}}),
    [overridesB,setOverridesB]=useState<ProgramOverrides>(()=>{try{return {...emptyProgramOverrides(),...JSON.parse(localStorage.getItem('cnc-program-b-overrides')||'{}')} as ProgramOverrides}catch{return emptyProgramOverrides()}});
  const inputA = useRef<HTMLInputElement>(null),
    inputB = useRef<HTMLInputElement>(null),
    editorsHost = useRef<HTMLDivElement>(null),
    workspaceHost = useRef<HTMLElement>(null),
    timingA=useRef({key:'',remainingSeconds:0,startedAt:0,speed:1}),
    timingB=useRef({key:'',remainingSeconds:0,startedAt:0,speed:1});
  const sectionsA = useMemo(() => findProgramSections(textA), [textA]),
    sectionsB = useMemo(() => findProgramSections(textB), [textB]),
    selectionA = useMemo(() => sectionSelection(textA, sectionA), [textA, sectionA]),
    selectionB = useMemo(() => sectionSelection(textB, sectionB), [textB, sectionB]),
    comparison = useMemo(() => syncAB ? comparePrograms(textA, textB) : undefined, [syncAB, textA, textB]),
    machineA=useMemo(()=>programMachine(machine,overridesA),[machine,overridesA]),
    machineB=useMemo(()=>programMachine(machine,overridesB),[machine,overridesB]),
    a = useMemo(
      () => parseProgram({ name: nameA, text: selectionA.text, lineMap: selectionA.lineMap }, machineA.rapidRate, sectionsA.map((s) => s.number), machineA),
      [nameA, selectionA.text, sectionsA, machineA],
    ),
    b = useMemo(
      () => parseProgram({ name: nameB, text: selectionB.text, lineMap: selectionB.lineMap }, machineB.rapidRate, sectionsB.map((s) => s.number), machineB),
      [nameB, selectionB.text, sectionsB, machineB],
    ),
    runtimeA=useMemo(()=>{const lines=selectionA.text.split('\n');return parseProgram({name:nameA,text:lines.slice(0,indexA+1).join('\n'),lineMap:selectionA.lineMap.slice(0,indexA+1)},machineA.rapidRate,sectionsA.map(s=>s.number),machineA)},[nameA,selectionA.text,selectionA.lineMap,indexA,machineA,sectionsA]),
    runtimeB=useMemo(()=>{const lines=selectionB.text.split('\n');return parseProgram({name:nameB,text:lines.slice(0,indexB+1).join('\n'),lineMap:selectionB.lineMap.slice(0,indexB+1)},machineB.rapidRate,sectionsB.map(s=>s.number),machineB)},[nameB,selectionB.text,selectionB.lineMap,indexB,machineB,sectionsB]),
    collisions = useMemo(
      () => [
        ...analyzeCollisions(a, machineA).map((x) => ({ ...x, side: "A" })),
        ...analyzeCollisions(b, machineB).map((x) => ({ ...x, side: "B" })),
      ],
      [a, b, machineA, machineB],
    ),
    maxA = Math.max(0, a.blocks.length - 1),
    maxB = Math.max(0, b.blocks.length - 1),
    motionIndexA=a.blocks.slice(0,indexA).reduce((count,block)=>count+(block.motions?.length??(block.motion?1:0)),0)+Math.min(subMotionA,Math.max(0,(a.blocks[indexA]?.motions?.length??1)-1)),
    motionIndexB=b.blocks.slice(0,indexB).reduce((count,block)=>count+(block.motions?.length??(block.motion?1:0)),0)+Math.min(subMotionB,Math.max(0,(b.blocks[indexB]?.motions?.length??1)-1));
  useEffect(() => {
    if (indexA > maxA) setIndexA(maxA);
  }, [maxA, indexA]);
  useEffect(() => {
    if (indexB > maxB) setIndexB(maxB);
  }, [maxB, indexB]);
  useEffect(() => {
    if (!syncAB || !a.blocks.length || !b.blocks.length) return;
    if (!comparison) return;
    const targetLine = comparison.mapAToB(a.blocks[Math.min(indexA, a.blocks.length - 1)].line);
    let nearest = 0, distance = Infinity;
    b.blocks.forEach((block, i) => { const next = Math.abs(block.line - targetLine); if (next < distance) { distance = next; nearest = i; } });
    setSubMotionB(subMotionA);
    setIndexB(nearest);
  }, [syncAB, indexA, subMotionA, a.blocks, b.blocks, comparison]);
  useEffect(() => { if (syncAB) setPlayingB(playingA); }, [syncAB, playingA]);
  useEffect(() => { if (syncAB) setSpeedB(speedA); }, [syncAB, speedA]);
  useEffect(() => {
    if (!playingA) return;
    const motions=a.blocks[indexA]?.motions??[],motion=motions[Math.min(subMotionA,Math.max(0,motions.length-1))],key=`${indexA}:${subMotionA}`,timing=timingA.current;if(timing.key!==key){timing.key=key;timing.remainingSeconds=motion?.estimatedSeconds??.1;}timing.startedAt=performance.now();timing.speed=speedA;
    const id=window.setTimeout(()=>{timing.remainingSeconds=0;if(subMotionA<motions.length-1)setSubMotionA(i=>i+1);else{setSubMotionA(0);setIndexA(i=>(i>=maxA?(setPlayingA(false),i):i+1));}},Math.max(25,timing.remainingSeconds*1000/speedA));
    return () => {window.clearTimeout(id);timing.remainingSeconds=Math.max(0,timing.remainingSeconds-(performance.now()-timing.startedAt)/1000*timing.speed);};
  }, [playingA, speedA, maxA,indexA,subMotionA,a.blocks]);
  useEffect(() => {
    if (!playingB || syncAB) return;
    const motions=b.blocks[indexB]?.motions??[],motion=motions[Math.min(subMotionB,Math.max(0,motions.length-1))],key=`${indexB}:${subMotionB}`,timing=timingB.current;if(timing.key!==key){timing.key=key;timing.remainingSeconds=motion?.estimatedSeconds??.1;}timing.startedAt=performance.now();timing.speed=speedB;
    const id=window.setTimeout(()=>{timing.remainingSeconds=0;if(subMotionB<motions.length-1)setSubMotionB(i=>i+1);else{setSubMotionB(0);setIndexB(i=>(i>=maxB?(setPlayingB(false),i):i+1));}},Math.max(25,timing.remainingSeconds*1000/speedB));
    return () => {window.clearTimeout(id);timing.remainingSeconds=Math.max(0,timing.remainingSeconds-(performance.now()-timing.startedAt)/1000*timing.speed);};
  }, [playingB, speedB, maxB,indexB,subMotionB,b.blocks,syncAB]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.ctrlKey||event.altKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName))return;const code=event.key.toLowerCase();if(!['a','s','d','f'].includes(code))return;event.preventDefault();const side=activeSide==='B'&&showB?'B':'A';if(side==='A'){if(code==='a'){setPlayingA(false);setOverridesA(emptyProgramOverrides());setSubMotionA(0);setIndexA(0);}else if(code==='s')setPlayingA(v=>!v);else{setPlayingA(false);setSubMotionA(0);setIndexA(i=>code==='d'?Math.max(0,i-1):Math.min(maxA,i+1));}}else{if(code==='a'){setPlayingB(false);setOverridesB(emptyProgramOverrides());setSubMotionB(0);setIndexB(0);}else if(code==='s')setPlayingB(v=>!v);else{setPlayingB(false);setSubMotionB(0);setIndexB(i=>code==='d'?Math.max(0,i-1):Math.min(maxB,i+1));}}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[activeSide,showB,maxA,maxB]);
  useEffect(
    () => localStorage.setItem("cnc-machine", JSON.stringify(machine)),
    [machine],
  );
  useEffect(()=>localStorage.setItem('cnc-program-a-overrides',JSON.stringify(overridesA)),[overridesA]);
  useEffect(()=>localStorage.setItem('cnc-program-b-overrides',JSON.stringify(overridesB)),[overridesB]);
  const setProgramA=(next:MachineConfig)=>setOverridesA(programOverrides(machine,next));
  const setProgramB=(next:MachineConfig)=>setOverridesB(programOverrides(machine,next));
  const open = (side: "A" | "B", file?: File, input?: HTMLInputElement) => {
    if (!file) return;
    const r = new FileReader();
    r.onerror = () => alert(`無法讀取 ${file.name}`);
    r.onload = () => {
      const loaded = String(r.result);
      const sections = findProgramSections(loaded);
      const initial = defaultSectionKey(loaded);
      side === "A"
        ? (setA(loaded), setNameA(file.name), setSectionA(initial),setOverridesA(emptyProgramOverrides()))
        : (setB(loaded), setNameB(file.name), setSectionB(initial),setOverridesB(emptyProgramOverrides()));
      side === "A" ? setIndexA(0) : setIndexB(0);
      if (input) input.value = "";
    };
    r.readAsText(file);
  };
  const issues = [
    ...a.diagnostics.map((d) => ({ ...d, side: "A" })),
    ...b.diagnostics.map((d) => ({ ...d, side: "B" })),
    ...collisions,
  ];
  const dataProblemCodes = new Set(['UNCONFIRMED_MACHINE_POSITION','UNCONFIRMED_G83_CLEARANCE','UNDEFINED_TOOL_LENGTH_OFFSET','MISSING_SUBPROGRAM','MISSING_MACRO','UNEXECUTED_MACRO','UNRESOLVED_MACRO','UNEXPANDED_CANNED_CYCLE']);
  const dataProblems = issues.filter((item:any) => dataProblemCodes.has(item.code));
  const goLine = (side: string, line: number) => {
    const list = side === "A" ? a.blocks : b.blocks,
      i = list.findIndex((block) => block.line === line);
    if (i >= 0) side === "A" ? setIndexA(i) : setIndexB(i);
  };
  const editors = (
    [
      ["A", nameA, textA, setA, inputA],
      ["B", nameB, textB, setB, inputB],
    ] as const
  ).filter(([side]) => side === "A" || editorBVisible);
  const resizeEditors = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (next: PointerEvent) => {
      const rect = editorsHost.current?.getBoundingClientRect();
      if (!rect?.width) return;
      setEditorSplit(Math.max(20, Math.min(80, (next.clientX - rect.left) / rect.width * 100)));
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.classList.remove('resizing-editors');
    };
    document.body.classList.add('resizing-editors');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop, { once: true });
  };
  const resizeWorkspace = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (next: PointerEvent) => {
      const rect = workspaceHost.current?.getBoundingClientRect();
      if (!rect?.width) return;
      const asidePixels = asideVisible ? 270 : 0;
      const minimum = Math.min(260, rect.width * .35);
      const maximum = Math.max(minimum, rect.width - asidePixels - 370);
      const pixels = Math.max(minimum, Math.min(maximum, next.clientX - rect.left));
      setProgramAreaWidth(pixels / rect.width * 100);
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.classList.remove('resizing-workspace');
    };
    document.body.classList.add('resizing-workspace');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop, { once: true });
  };
  const resizeAside = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (next: PointerEvent) => {
      const rect = workspaceHost.current?.getBoundingClientRect();
      if (!rect?.width) return;
      setAsideWidth(Math.max(230, Math.min(Math.min(520, rect.width * .45), rect.right - next.clientX)));
    };
    const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); document.body.classList.remove('resizing-aside'); };
    document.body.classList.add('resizing-aside');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop, { once: true });
  };
  return (
    <main>
      <section ref={workspaceHost} className={`workspace workspace-resizable ${editorBVisible ? "" : "b-hidden"} ${asideVisible ? "" : "aside-hidden"} ${programAreaVisible?'':'program-area-hidden'} ${simulationVisible?'':'simulation-hidden'}`} style={{'--program-area-width':`${programAreaWidth}%`,'--aside-width':`${asideWidth}px`} as React.CSSProperties}>
        <div ref={editorsHost} className={`editors ${editorBVisible?'has-resizer':''}`} style={{'--editor-a-width':`${editorSplit}%`} as React.CSSProperties}>
          {editors.map(([side, name, value, set, ref], editorIndex) => (
            <Fragment key={side}>
            {editorIndex===1&&<div className="editor-resizer" role="separator" aria-label="調整 A、B 程式區寬度" aria-orientation="vertical" title="左右拖曳調整 A／B 程式區大小" onPointerDown={resizeEditors}><span>⋮</span></div>}
            <ProgramEditor
              side={side}
              name={name}
              value={value}
              setValue={set}
              inputRef={ref}
              currentLine={
                (side === "A" ? a : b).blocks[
                  Math.min(side === "A" ? indexA : indexB, (side === "A" ? a : b).blocks.length - 1)
                ]?.line
              }
              onOpen={open}
              differences={side === "B" ? comparison?.bDifferences : undefined}
            />
            </Fragment>
          ))}
        </div>
        <div className="workspace-resizer" role="separator" aria-label="調整程式區與模擬區寬度" aria-orientation="vertical" title="左右拖曳調整程式區與模擬區大小" onPointerDown={programAreaVisible&&simulationVisible?resizeWorkspace:undefined}><span>⋮</span><div className="workspace-divider-controls"><PanelToggle panel="程式 B" expanded={editorBVisible} arrow={editorBVisible?'◀':'▶'} className="panel-edge-toggle" onToggle={()=>setEditorBVisible(v=>!v)}/><PanelToggle panel="程式區" expanded={programAreaVisible} arrow={programAreaVisible?'◀':'▶'} className="panel-edge-toggle" onToggle={()=>{if(programAreaVisible&&!simulationVisible)setSimulationVisible(true);setProgramAreaVisible(v=>!v)}}/><PanelToggle panel="模擬區" expanded={simulationVisible} arrow={simulationVisible?'▶':'◀'} className="panel-edge-toggle" onToggle={()=>{if(simulationVisible&&!programAreaVisible)setProgramAreaVisible(true);setSimulationVisible(v=>!v)}}/></div></div>
        <div className="sim">
          <div className="sim-toolbar">
            <label>
              <input
                type="checkbox"
                checked={showA}
                onChange={(e) => setShowA(e.target.checked)}
              />{" "}
              A 刀路
            </label>
            <label>
              <input
                type="checkbox"
                checked={showB}
                onChange={(e) => {
                  const visible = e.target.checked;
                  setShowB(visible);
                  if (!visible) setPlayingB(false);
                }}
              />{" "}
              B 刀路
            </label>
            <label title="橘色物件是通用夾具">
              <input
                type="checkbox"
                checked={showFixtures}
                onChange={(e) => setShowFixtures(e.target.checked)}
              />{" "}
              橘色夾具
            </label>
            <label title="開啟後略過以 / 開頭的單節"><input type="checkbox" checked={machine.optionalBlockSkip} onChange={e=>setMachine({...machine,optionalBlockSkip:e.target.checked})}/> / 區段跳脫：{machine.optionalBlockSkip?'略過':'執行'}</label>
            <label className="sync-ab-toggle" title="以程式 A 為主控，利用 N 碼錨點同步程式 B；大量增刪不會讓後續全數錯位"><input type="checkbox" checked={syncAB} onChange={e=>{const enabled=e.target.checked;setSyncAB(enabled);if(enabled){setShowA(true);setShowB(true);setEditorBVisible(true);setActiveSide('A');setPlayingB(playingA);setSpeedB(speedA);}}}/> AB 同步模擬</label>
            {syncAB&&comparison&&<output className="diff-summary" title={`依 ${comparison.sections} 個 N 分段比較`}>B 差異：改 {comparison.changed}・增 {comparison.added}・缺 {comparison.removed}</output>}
            {sectionsA.length > 0 && <SegmentSelect side="A" sections={sectionsA} value={sectionA} onChange={(value) => { setPlayingA(false); setOverridesA(emptyProgramOverrides()); setIndexA(0); setSectionA(value); }} related={selectionA.related.length} missing={selectionA.missing} />}
            {sectionsB.length > 0 && showB && <SegmentSelect side="B" sections={sectionsB} value={sectionB} onChange={(value) => { setPlayingB(false); setOverridesB(emptyProgramOverrides()); setIndexB(0); setSectionB(value); }} related={selectionB.related.length} missing={selectionB.missing} />}
          </div>
          {dataProblems.length>0&&<button className="simulation-data-warning" type="button" title="可運算部分仍會正常模擬；按此查看詳細問題" onClick={()=>{setAsideVisible(true);setTab('issues')}}><strong>⚠ 模擬警示 {dataProblems.length}</strong><span>可運算部分仍正常顯示・按此查看</span></button>}
          <Viewer
            key={`layout-${editorBVisible}-${asideVisible}-fixture-${showFixtures}`}
            a={a.segments}
            b={b.segments}
            indexA={motionIndexA}
            indexB={motionIndexB}
            showA={showA}
            showB={showB}
            showFixtures={showFixtures}
            machine={machine}
            statusA={liveCodeStatus(runtimeA)}
            statusB={liveCodeStatus(runtimeB)}
            playingA={playingA}
            playingB={playingB}
            speedA={speedA}
            speedB={speedB}
          />
          <div className="transport transport-stack">
            <SimControls side="A" active={activeSide==='A'} onActivate={()=>setActiveSide('A')} index={indexA} max={maxA} playing={playingA} speed={speedA} setIndex={setIndexA} setPlaying={setPlayingA} setSpeed={setSpeedA} onRestart={()=>{setSubMotionA(0);setOverridesA(emptyProgramOverrides())}} />
            {showB && !syncAB && <SimControls side="B" active={activeSide==='B'} onActivate={()=>setActiveSide('B')} index={indexB} max={maxB} playing={playingB} speed={speedB} setIndex={setIndexB} setPlaying={setPlayingB} setSpeed={setSpeedB} onRestart={()=>{setSubMotionB(0);setOverridesB(emptyProgramOverrides())}} />}
            {showB && syncAB && <div className="sync-status"><strong>AB 同步</strong><span>A L{a.blocks[indexA]?.line??'—'} → B L{b.blocks[indexB]?.line??'—'}</span><span>依 N 碼分段對齊</span></div>}
          </div>
        </div>
        {!asideVisible && <PanelToggle panel="右側面板" expanded={false} arrow="◀" className="panel-edge-toggle aside-expand" onToggle={() => setAsideVisible(true)}/>} 
        {asideVisible && simulationVisible && <div className="aside-resizer" role="separator" aria-label="調整模擬區與右側面板寬度" aria-orientation="vertical" title="左右拖曳調整模擬區與右側面板大小" onPointerDown={resizeAside}><span>⋮</span><PanelToggle panel="右側面板" expanded arrow="▶" className="panel-edge-toggle" onToggle={()=>setAsideVisible(false)}/></div>}
        {asideVisible && <aside>
          <nav>
            {([['system','座標'],['tool','刀補'],['machine','機台'],['macro','macro'],['issues',`問題 ${issues.length}`]] as const).map(([key,label])=><button key={key} type="button" className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}</button>)}
          </nav>
          {tab === "issues" ? (
            <div className="issues">
              {issues.length === 0 ? (
                <div className="empty">沒有發現問題</div>
              ) : (
                issues.map((d: any, i) => (
                  <button
                    type="button"
                    className={`issue ${d.severity}`}
                    key={i}
                    onClick={() => goLine(d.side, d.line)}
                  >
                    <b>
                      {d.side} · L{d.line}
                    </b>
                    <span>{d.message}</span>
                  </button>
                ))
              )}
            </div>
          ) : (
            <MachinePanel mode={tab} value={machine} onChange={setMachine} programA={machineA} programB={machineB} onProgramA={setProgramA} onProgramB={setProgramB} resultA={runtimeA} resultB={runtimeB} textA={textA} textB={textB} currentA={runtimeA.segments.at(-1)} currentB={runtimeB.segments.at(-1)} />
          )}
        </aside>}
      </section>
      <footer className="app-footer">
        <span><b>OFFLINE CNC LAB</b>　CNC 雙程式路線模擬器　<small>v1.7.8・中央三鍵控制版</small></span>
        <span className={a.complete && b.complete ? "footer-health ok" : "footer-health warn"}>{a.complete && b.complete ? "解析完整" : "結果不完整"}　{a.segments.length + b.segments.length} 動作</span>
      </footer>
    </main>
  );
}
function PanelToggle({panel,expanded,arrow,onToggle,className=""}:{panel:string;expanded:boolean;arrow:string;onToggle:()=>void;className?:string}){
  const action=expanded?'收合':'展開',shortLabel=panel==='程式 B'?'B':panel==='程式區'?'程式':panel==='模擬區'?'模擬':'右側';
  return <button className={`panel-collapse-toggle ${className}`} type="button" title={`${action}${panel}`} aria-label={`${action}${panel}`} aria-expanded={expanded} onPointerDown={event=>event.stopPropagation()} onClick={onToggle}><span>{shortLabel}</span><b aria-hidden="true">{arrow}</b></button>;
}
function SegmentSelect({ side, sections, value, onChange, related, missing }: {
  side: "A" | "B";
  sections: ReturnType<typeof findProgramSections>;
  value: string;
  onChange: (value: string) => void;
  related: number;
  missing: string[];
}) {
  const status = missing.length ? `缺少副程式 ${missing.join(", ")}` : `含 ${related} 個相關副程式`;
  return <label className={`segment-select side-${side.toLowerCase()}`} title={status}>
    <span>{side} 分段</span>
    <select aria-label={`程式 ${side} 模擬分段`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="__all">全部程式（{sections.length} 段）</option>
      {sections.map((section) => <option key={section.key} value={section.key}>單節 :{section.number} {section.label.slice(0, 16)}</option>)}
    </select>
    <small className={missing.length ? "missing" : "found"}>{missing.length ? `缺 ${missing.length}` : `副 ${related}`}</small>
  </label>;
}
function SimControls({ side, active,onActivate,index, max, playing, speed, setIndex, setPlaying, setSpeed, onRestart }: {
  side: "A" | "B"; index: number; max: number; playing: boolean; speed: number;
  active:boolean;onActivate:()=>void;
  setIndex: React.Dispatch<React.SetStateAction<number>>;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setSpeed: React.Dispatch<React.SetStateAction<number>>;
  onRestart:()=>void;
}) {
  return <div className={`transport-row side-${side.toLowerCase()} ${active?'keyboard-active':''}`} onMouseDown={onActivate}>
    <div className="transport-actions">
      <strong><span className="program-dot" />程式 {side}</strong>
      <button type="button" title={`${side} 回起點（快捷鍵 A）`} aria-label={`程式 ${side} 重新模擬並重新匯入 G10`} onClick={() => { setPlaying(false); onRestart(); setIndex(0); }}><span>⏮</span><kbd>A</kbd></button>
      <button type="button" className="play" title="播放／暫停（快捷鍵 S）" onClick={() => setPlaying((x) => !x)}><span>{playing ? "暫停" : "播放"}</span><kbd>S</kbd></button>
      <button type="button" title="上一個單節（快捷鍵 D）" onClick={() => {setPlaying(false);setIndex((i) => Math.max(0, i - 1));}}><span>上單節</span><kbd>D</kbd></button>
      <button type="button" title="下一個單節（快捷鍵 F）" onClick={() => {setPlaying(false);setIndex((i) => Math.min(max, i + 1));}}><span>下單節</span><kbd>F</kbd></button>
      <label className="speed-control"><span>速度</span><select aria-label={`程式 ${side} 模擬速度`} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
        {[.25,.5,1,2,3,5,8,10,15,20].map(value=><option key={value} value={value}>{value}×</option>)}
      </select></label>
    </div>
    <div className="transport-progress">
      <input aria-label={`程式 ${side} 模擬進度`} type="range" min="0" max={max} value={Math.min(index, max)} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} />
      <output>{Math.min(index, max) + 1} / {max + 1}</output>
    </div>
  </div>;
}
function ProgramEditor({
  side,
  name,
  value,
  setValue,
  inputRef,
  currentLine,
  onOpen,
  differences,
}: {
  side: "A" | "B";
  name: string;
  value: string;
  setValue: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  currentLine?: number;
  onOpen: (side: "A" | "B", file?: File, input?: HTMLInputElement) => void;
  differences?: Map<number, DifferenceKind>;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const matches = useMemo(() => {
    if (!searchTerm) return [] as number[];
    const found: number[] = [], source = value.toLocaleLowerCase(), needle = searchTerm.toLocaleLowerCase();
    for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + Math.max(1, needle.length))) found.push(at);
    return found;
  }, [value, searchTerm]);
  const jumpToMatch = (next: number, positions = matches, needle = searchTerm) => {
    if (!positions.length || !needle) { setMatchIndex(-1); return; }
    const normalized = (next + positions.length) % positions.length, start = positions[normalized];
    setMatchIndex(normalized);
    requestAnimationFrame(() => {
      if (!area.current) return;
      area.current.focus();
      area.current.setSelectionRange(start, start + needle.length);
      const lineNumber = value.slice(0, start).split("\n").length;
      area.current.scrollTop = Math.max(0, (lineNumber - 4) * 27.9);
      setScroll({ top: area.current.scrollTop, left: area.current.scrollLeft });
    });
  };
  const submitSearch=(direction:1|-1=1)=>{const needle=query.trim();if(!needle){setSearchTerm("");setMatchIndex(-1);return;}if(needle!==searchTerm){const source=value.toLocaleLowerCase(),key=needle.toLocaleLowerCase(),found:number[]=[];for(let at=source.indexOf(key);at>=0;at=source.indexOf(key,at+Math.max(1,key.length)))found.push(at);setSearchTerm(needle);jumpToMatch(direction<0?found.length-1:0,found,needle);return;}jumpToMatch(matchIndex+direction);};
  useEffect(() => {
    if (area.current && currentLine) {
      area.current.scrollTop = Math.max(0, (currentLine - 3) * 27.9);
      setScroll({ top: area.current.scrollTop, left: area.current.scrollLeft });
    }
  }, [currentLine]);
  const line = value.split("\n")[Math.max(0, (currentLine ?? 1) - 1)] || "";
  const allLines = useMemo(() => value.split("\n"), [value]);
  const lineOffsets=useMemo(()=>{const offsets:number[]=[];let at=0;for(const item of allLines){offsets.push(at);at+=item.length+1;}return offsets;},[allLines]);
  const lineHeight = 27.9;
  const visibleStart = Math.max(0, Math.floor(scroll.top / lineHeight) - 8);
  const visibleCount = Math.ceil((area.current?.clientHeight || 500) / lineHeight) + 16;
  const visibleLines = allLines.slice(visibleStart, visibleStart + visibleCount);
  const motionClass = /G0(?!\d)/i.test(line) ? "g0" : /G1(?!\d)/i.test(line) ? "g1" : /G[23](?!\d)/i.test(line) ? "arc" : "other";
  return (
    <div className={`editor editor-${side.toLowerCase()}`}>
      <div className="panel-title">
        <div>
          <b>程式 {side}</b>
          <span>{name}</span>{side === "B" && differences && <output className="editor-diff-count">差異 {differences.size}</output>}
        </div>
        <div>
          <button type="button" onClick={() => inputRef.current?.click()}>
            匯入
          </button>
          <button type="button" onClick={() => download(name, value)}>
            下載
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="*/*"
            onChange={(e) => onOpen(side, e.target.files?.[0], e.currentTarget)}
          />
        </div>
      </div>
      <div className="program-search" role="search">
        <span>搜尋</span>
        <input aria-label={`搜尋程式 ${side} 文字`} type="search" placeholder="輸入完成後按 Enter…" value={query} onChange={(e) => {setQuery(e.target.value);setMatchIndex(-1);}} onKeyDown={(e)=>{if(e.key==='Enter'){e.preventDefault();submitSearch(e.shiftKey?-1:1);}}}/>
        <output>{query!==searchTerm?"按 Enter":matches.length ? `${matchIndex + 1} / ${matches.length}` : searchTerm ? "0 / 0" : "—"}</output>
        <button type="button" title="上一筆（Shift+Enter）" disabled={!query.trim()} onClick={()=>submitSearch(-1)}>↑</button>
        <button type="button" title="下一筆（Enter）" disabled={!query.trim()} onClick={()=>submitSearch(1)}>↓</button>
      </div>
      <div className={`current-code-line ${motionClass}`}>
        <b>▶ L{currentLine ?? "—"}</b>
        <code>{line || "等待模擬"}</code>
        <span className="motion-badge">{motionClass === "g0" ? "G0 快移" : motionClass === "g1" ? "G1 切削" : motionClass === "arc" ? "G2/G3 圓弧" : "一般指令"}</span>
      </div>
      <div className="code-stack">
        <pre className="code-highlight" aria-hidden="true" style={{transform:`translate(${-scroll.left}px, ${-scroll.top}px)`,height:`${allLines.length * lineHeight + 24}px`,paddingTop:`${12 + visibleStart * lineHeight}px`}}>{visibleLines.map((code,i)=>{const n=visibleStart+i+1,start=lineOffsets[n-1]??0,activeStart=matches[matchIndex],difference=differences?.get(n);return <div className={`syntax-line ${n===currentLine?"active":""} ${difference?`diff-${difference}`:""}`} key={n}><span className="line-number">{n}{difference?<i title={difference==='added'?'B 新增行':'B 修改行'}>{difference==='added'?'+':'≠'}</i>:null}</span><SearchSyntaxLine code={code} term={searchTerm} activeOffset={activeStart>=start&&activeStart<start+code.length?activeStart-start:-1}/></div>})}</pre>
        <textarea ref={area} className="code-editor color-overlay" spellCheck={false} value={value} onScroll={e=>setScroll({top:e.currentTarget.scrollTop,left:e.currentTarget.scrollLeft})} onChange={(e) => setValue(e.target.value)} />
      </div>
    </div>
  );
}
function SyntaxLine({code}:{code:string}){const parts=code.split(/(\([^)]*\)|;.*$|G0+(?!\d)|G1(?!\d)|G[23](?!\d)|[XYZWIJKR][-+]?\d*\.?\d+|[FSTH][-+]?\d*\.?\d+|M\d+)/gi);return <>{parts.map((p,i)=>{const cls=/^\(|^;/.test(p)?"tok-comment":/^G0+(?!\d)/i.test(p)?"tok-g0":/^G1(?!\d)/i.test(p)?"tok-g1":/^G[23](?!\d)/i.test(p)?"tok-arc":/^[XYZWIJKR]/i.test(p)?"tok-axis":/^[FSTH]/i.test(p)?"tok-param":/^M/i.test(p)?"tok-m":"";return <span className={cls} key={i}>{p}</span>})}</>}
function SearchSyntaxLine({code,term,activeOffset}:{code:string;term:string;activeOffset:number}){if(!term)return <SyntaxLine code={code}/>;const source=code.toLocaleLowerCase(),needle=term.toLocaleLowerCase(),parts:React.ReactNode[]=[];let cursor=0,index=0;for(let at=source.indexOf(needle);at>=0;at=source.indexOf(needle,at+Math.max(1,needle.length))){if(at>cursor)parts.push(<SyntaxLine code={code.slice(cursor,at)} key={`text-${index}`}/>);parts.push(<mark className={`search-match ${at===activeOffset?'current':''}`} key={`match-${index++}`}>{code.slice(at,at+term.length)}</mark>);cursor=at+term.length;}if(cursor<code.length)parts.push(<SyntaxLine code={code.slice(cursor)} key={`tail-${index}`}/>);return <code className="search-syntax-line">{parts}</code>}
function MachinePanel({
  mode,
  value,
  onChange,
  currentA,
  currentB,
  resultA,
  resultB,
  programA,
  programB,
  onProgramA,
  onProgramB,
  textA,
  textB,
}: {
  mode: "system" | "tool" | "machine" | "macro";
  value: MachineConfig;
  onChange: (v: MachineConfig) => void;
  currentA?: MotionSegment;
  currentB?: MotionSegment;
  resultA: ParseResult;
  resultB: ParseResult;
  programA:MachineConfig;
  programB:MachineConfig;
  onProgramA:(v:MachineConfig)=>void;
  onProgramB:(v:MachineConfig)=>void;
  textA:string;
  textB:string;
}) {
  const set = (axis: "x" | "y" | "z" | "w", i: 0 | 1, n: number) =>
    onChange({
      ...value,
      limits: {
        ...value.limits,
        [axis]: value.limits[axis].map((v, j) => (j === i ? n : v)) as [
          number,
          number,
        ],
      },
    });
  if(mode==='tool')return <ToolVariableTable value={value} onChange={onChange} programA={programA} programB={programB} onProgramA={onProgramA} onProgramB={onProgramB}/>;
  if(mode==='system')return <SystemVariableTable value={value} onChange={onChange} programA={programA} programB={programB} onProgramA={onProgramA} onProgramB={onProgramB} a={resultA} b={resultB} currentA={currentA} currentB={currentB}/>;
  if(mode==='macro')return <LiveMacroTable textA={textA} textB={textB} value={value} onChange={onChange} programA={programA} programB={programB} onProgramA={onProgramA} onProgramB={onProgramB} resultA={resultA} resultB={resultB}/>;
  return (
    <div className="machine">
      <>
      <p>通用 3+1 軸機台（W 平行 Z）</p>
      {(["x", "y", "z", "w"] as const).map((axis) => (
        <label key={axis}>
          <b>{axis.toUpperCase()} 行程</b>
          <input
            type="number"
            value={value.limits[axis][0]}
            onChange={(e) => set(axis, 0, +e.target.value)}
          />
          <span>～</span>
          <input
            type="number"
            value={value.limits[axis][1]}
            onChange={(e) => set(axis, 1, +e.target.value)}
          />
        </label>
      ))}
      <label>
        <b>快移 mm/min</b>
        <input
          type="number"
          value={value.rapidRate}
          onChange={(e) => onChange({ ...value, rapidRate: +e.target.value })}
        />
      </label>
      <label><b>/ 選擇性跳段</b><input type="checkbox" checked={value.optionalBlockSkip} onChange={e=>onChange({...value,optionalBlockSkip:e.target.checked})}/><span>{value.optionalBlockSkip?'略過':'執行'}</span></label>
      <label title="FANUC G83 第二次以後快速接近到前一次孔底前 d 的位置；請依機台參數輸入"><b>G83 間隙 d</b><input type="number" min="0" step="any" value={value.g83Clearance} onChange={e=>onChange({...value,g83Clearance:Math.max(0,+e.target.value||0)})}/><span>mm</span><input aria-label="確認 G83 再接近間隙" type="checkbox" checked={value.g83ClearanceConfigured} onChange={e=>onChange({...value,g83ClearanceConfigured:e.target.checked})}/></label>
      </>
      <>
      <h3>毛胚</h3>
      {(["x", "y", "z"] as const).map((axis) => (
        <label key={axis}>
          <b>{axis.toUpperCase()} 尺寸</b>
          <input
            type="number"
            value={value.stock[axis]}
            onChange={(e) =>
              onChange({
                ...value,
                stock: { ...value.stock, [axis]: +e.target.value },
              })
            }
          />
        </label>
      ))}
      <button
        type="button"
        className="reset"
        onClick={() => onChange(defaultMachine)}
      >
        恢復預設機台
      </button>
      </>
    </div>
  );
}
function MachinePositionPanel({value,onChange}:{value:MachineConfig;onChange:(v:MachineConfig)=>void}){
  const axes=['x','y','z','w'] as const,codes=['G54','G55','G56','G57','G58','G59'] as WorkOffsetCode[];
  return <div className="machine position-page">
    <h3>固定機械座標原點</h3>
    <p>模擬唯一基準固定為 X0、Y0、Z0、W0，不能輸入或移動。程式 A、B 與 G54～G59 全部由此原點換算。</p>
    <output><b>機械原點</b>　X 0.000　Y 0.000　Z 0.000　W 0.000</output>
    <h3>工件原點相對機械原點的位置</h3>
    <p>工件原點的機械位置就是 G54（G55…）設定值；刀長補正只作用於刀具位置，不移動原點。</p>
    {codes.map(code=><output key={code}><b>{code}</b>　{axes.map(axis=><span key={axis}>{axis.toUpperCase()} {value.workOffsets[code][axis].toFixed(3)}　</span>)}</output>)}
    <small>座標公式：相對座標＝機械座標−G54（G55…）−刀長補正。</small>
  </div>;
}
function SystemVariables({title,segment}:{title:string;segment?:MotionSegment}) {
  const axes=['x','y','z','w'] as const;
  return <div className="system-vars"><b>{title}　{segment?.workOffset??'—'}</b>{segment&&<span>原點 X{segment.workOffsetValue.x.toFixed(3)} Y{segment.workOffsetValue.y.toFixed(3)} Z{segment.workOffsetValue.z.toFixed(3)} W{segment.workOffsetValue.w.toFixed(3)}</span>}{axes.map((axis,i)=><span key={axis}>#{5021+i} {axis.toUpperCase()}={Number(segment?.machineEnd[axis]??0).toFixed(3)}　#{5041+i}={Number(segment?.end[axis]??0).toFixed(3)}</span>)}<span>#5083={Number(segment?.toolLengthComp??0).toFixed(3)}</span></div>;
}
function SystemVariableValue({variable,a,b}:{variable:number;a?:MotionSegment;b?:MotionSegment}){
  const value=(s?:MotionSegment)=>variable>=5021&&variable<=5024?s?.machineEnd[(['x','y','z','w'] as const)[variable-5021]]:variable>=5041&&variable<=5044?s?.end[(['x','y','z','w'] as const)[variable-5041]]:variable>=5081&&variable<=5084?(variable===5083?s?.toolLengthComp:0):undefined;
  const av=value(a),bv=value(b);return <output className="variable-readout">{av===undefined&&bv===undefined?'目前未支援此唯讀號碼':`A ${Number(av??0).toFixed(3)}　B ${Number(bv??0).toFixed(3)}`}</output>;
}
function EditableNumber({value,onCommit}:{value:number;onCommit:(value:number)=>void}){const [draft,setDraft]=useState(String(value));useEffect(()=>setDraft(String(value)),[value]);const commit=()=>{const next=Number(draft);if(draft.trim()!==''&&Number.isFinite(next))onCommit(next);else setDraft(String(value));};return <input type="text" inputMode="decimal" value={draft} onChange={e=>setDraft(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape'){setDraft(String(value));e.currentTarget.blur();}}}/>;}
function VariableTableFrame({title,count,query,setQuery,children,controls}:{title:string;count:number;query:string;setQuery:(v:string)=>void;children:React.ReactNode;controls?:React.ReactNode}){return <div className="machine variable-page"><div className="variable-page-head"><b>{title}</b>{controls}</div><input className="variable-table-search" type="search" placeholder="搜尋變數號碼或名稱…" value={query} onChange={e=>setQuery(e.target.value)}/><small>顯示 {count} 筆</small><div className="variable-table"><div className="variable-table-header"><span>變數</span><span>名稱</span><span title="A、B 共用的機台預設值">共用設定</span><span title="讀入程式 A 後匯入，可手動覆寫">程式 A</span><span title="讀入程式 B 後匯入，可手動覆寫">程式 B</span></div>{children}</div></div>}
function ToolVariableTable({value,onChange,programA,programB,onProgramA,onProgramB}:{value:MachineConfig;onChange:(v:MachineConfig)=>void;programA:MachineConfig;programB:MachineConfig;onProgramA:(v:MachineConfig)=>void;onProgramB:(v:MachineConfig)=>void}){
  const [q,setQ]=useState(''), rows:Array<{n:number;h:number;part:'geometry'|'wear';name:string}>=[];
  for(let h=1;h<=value.toolOffsetCount;h++){if(value.toolOffsetMemory==='A')rows.push({n:(value.toolOffsetCount===400?10000:2000)+h,h,part:'geometry',name:`H${h} 刀長補正`});else{rows.push({n:(value.toolOffsetCount===400?10000:2000)+h,h,part:'wear',name:`H${h} 磨耗`});rows.push({n:(value.toolOffsetCount===400?11000:2200)+h,h,part:'geometry',name:`H${h} 幾何`});}}
  const shown=rows.filter(r=>`#${r.n} ${r.name}`.toLowerCase().includes(q.toLowerCase()));
  const controls=<><select value={value.toolOffsetMemory} onChange={e=>onChange({...value,toolOffsetMemory:e.target.value as 'A'|'B'})}><option value="A">Memory A</option><option value="B">Memory B</option></select><select value={value.toolOffsetCount} onChange={e=>onChange({...value,toolOffsetCount:+e.target.value as MachineConfig['toolOffsetCount']})}>{[32,64,99,200,400].map(n=><option key={n}>{n}</option>)}</select></>;
  return <VariableTableFrame title="刀補變數" count={shown.length} query={q} setQuery={setQ} controls={controls}>{shown.map(r=>{const field=r.part==='wear'?'toolWearOffsets':'toolLengthOffsets',source=value[field];return <div className="variable-table-row" key={`${r.part}-${r.h}`}><b>#{r.n}</b><span>{r.name}</span><input type="number" step="any" value={source[String(r.h)]??0} onChange={e=>onChange({...value,[field]:{...source,[r.h]:+e.target.value}})}/><input type="number" step="any" value={programA[field][String(r.h)]??0} onChange={e=>onProgramA({...programA,[field]:{...programA[field],[r.h]:+e.target.value}})}/><input type="number" step="any" value={programB[field][String(r.h)]??0} onChange={e=>onProgramB({...programB,[field]:{...programB[field],[r.h]:+e.target.value}})}/></div>})}</VariableTableFrame>;
}
function CustomVariableTable({value,onChange,programA,programB,onProgramA,onProgramB}:{value:MachineConfig;onChange:(v:MachineConfig)=>void;programA:MachineConfig;programB:MachineConfig;onProgramA:(v:MachineConfig)=>void;onProgramB:(v:MachineConfig)=>void}){
  const [q,setQ]=useState('');const nums=[...Array.from({length:50},(_,i)=>100+i),...(value.additionalCommonVariables?Array.from({length:50},(_,i)=>150+i):[]),...Array.from({length:32},(_,i)=>500+i),...(value.additionalCommonVariables?Array.from({length:468},(_,i)=>532+i):[])];const shown=nums.filter(n=>`#${n} ${n>=500?'永久':'共用'}`.includes(q));
  const controls=<label className="table-option"><input type="checkbox" checked={value.additionalCommonVariables} onChange={e=>onChange({...value,additionalCommonVariables:e.target.checked})}/>追加選配</label>;
  return <VariableTableFrame title={`自設變數（${value.additionalCommonVariables?'600':'82'} 個）`} count={shown.length} query={q} setQuery={setQ} controls={controls}>{shown.map(n=><div className="variable-table-row" key={n}><b>#{n}</b><span>{n>=500?'永久共用':'一般共用'}</span><input type="number" step="any" value={value.customVariables[n]??0} onChange={e=>onChange({...value,customVariables:{...value.customVariables,[n]:+e.target.value}})}/><input type="number" step="any" value={programA.customVariables[n]??0} onChange={e=>onProgramA({...programA,customVariables:{...programA.customVariables,[n]:+e.target.value}})}/><input type="number" step="any" value={programB.customVariables[n]??0} onChange={e=>onProgramB({...programB,customVariables:{...programB.customVariables,[n]:+e.target.value}})}/></div>)}</VariableTableFrame>;
}
function SystemVariableTable({value,onChange,programA,programB,onProgramA,onProgramB,a,b,currentA,currentB}:{value:MachineConfig;onChange:(v:MachineConfig)=>void;programA:MachineConfig;programB:MachineConfig;onProgramA:(v:MachineConfig)=>void;onProgramB:(v:MachineConfig)=>void;a:ParseResult;b:ParseResult;currentA?:MotionSegment;currentB?:MotionSegment}){
  const [q,setQ]=useState('');const axes=['x','y','z','w'] as const,codes=['G54','G55','G56','G57','G58','G59'] as WorkOffsetCode[];const writable=codes.flatMap((code,ci)=>axes.map((axis,ai)=>({n:2501+ai*100+ci,code,axis,name:`${code} ${axis.toUpperCase()} 原點`})));const readonly=[...axes.map((axis,i)=>({n:5021+i,name:`機械 ${axis.toUpperCase()} 座標`,get:(s?:MotionSegment)=>s?.machineEnd[axis]})),...axes.map((axis,i)=>({n:5041+i,name:`工件 ${axis.toUpperCase()} 座標`,get:(s?:MotionSegment)=>s?.end[axis]})),...axes.map((axis,i)=>({n:5081+i,name:`第 ${i+1} 軸目前刀補`,get:(s?:MotionSegment)=>i===2?s?.toolLengthComp:0}))];const needle=q.toLowerCase();const wr=writable.filter(r=>`#${r.n} ${r.name}`.toLowerCase().includes(needle)),ro=readonly.filter(r=>`#${r.n} ${r.name}`.toLowerCase().includes(needle));
  return <VariableTableFrame title="系統變數" count={wr.length+ro.length} query={q} setQuery={setQ}>{wr.map(r=>{const av=a.finalWorkOffsets[r.code][r.axis],bv=b.finalWorkOffsets[r.code][r.axis];return <div className="variable-table-row" key={r.n}><b>#{r.n}</b><span>{r.name}</span><input type="number" step="any" value={value.workOffsets[r.code][r.axis]} onChange={e=>onChange({...value,workOffsets:{...value.workOffsets,[r.code]:{...value.workOffsets[r.code],[r.axis]:+e.target.value}}})}/><EditableNumber value={av} onCommit={n=>onProgramA({...programA,workOffsets:{...programA.workOffsets,[r.code]:{...programA.workOffsets[r.code],[r.axis]:n}}})}/><EditableNumber value={bv} onCommit={n=>onProgramB({...programB,workOffsets:{...programB.workOffsets,[r.code]:{...programB.workOffsets[r.code],[r.axis]:n}}})}/></div>})}{ro.map(r=><div className="variable-table-row readonly" key={r.n}><b>#{r.n}</b><span>{r.name}</span><em>唯讀</em><output>{Number(r.get(currentA)??0).toFixed(3)}</output><output>{Number(r.get(currentB)??0).toFixed(3)}</output></div>)}</VariableTableFrame>;
}
function macroInventory(text:string){const sections=findProgramSections(text).filter(s=>+s.number>=8000),calls=new Map<string,number>();for(const m of text.matchAll(/G\s*65[^\r\n]*P\s*(\d+)/gi)){const n=String(+m[1]).padStart(4,'0');calls.set(n,(calls.get(n)??0)+1);}return {sections,calls};}
function MacroSection({title,count,open=false,children}:{title:string;count?:number;open?:boolean;children:React.ReactNode}){return <details className={`macro-section ${title==='變數變化紀錄'?'macro-change-section':''}`} open={open}><summary><span>{title}</span>{count!==undefined&&<small>{count} 筆</small>}</summary><div className="macro-section-body">{children}</div></details>}
function MacroTable({textA,textB,value,onChange,programA,programB,onProgramA,onProgramB,resultA,resultB}:{textA:string;textB:string;value:MachineConfig;onChange:(v:MachineConfig)=>void;programA:MachineConfig;programB:MachineConfig;onProgramA:(v:MachineConfig)=>void;onProgramB:(v:MachineConfig)=>void;resultA:ParseResult;resultB:ParseResult}){const [q,setQ]=useState(''),a=macroInventory(textA),b=macroInventory(textB),numbers=[...new Set([...a.sections.map(s=>s.number),...b.sections.map(s=>s.number),...a.calls.keys(),...b.calls.keys()])].sort(),needle=q.toLowerCase(),shown=numbers.filter(n=>{const s=a.sections.find(x=>x.number===n)??b.sections.find(x=>x.number===n);return `${n} ${s?.label??''}`.toLowerCase().includes(needle)}),writes=[...resultA.variableWrites.map(w=>({...w,side:'A'})),...resultB.variableWrites.map(w=>({...w,side:'B'}))].filter(w=>w.kind==='common'||w.kind==='permanent').slice(-200),calls=[...resultA.macroCalls.map(c=>({...c,side:'A'})),...resultB.macroCalls.map(c=>({...c,side:'B'}))],mapping=[['A',1],['B',2],['C',3],['I',4],['J',5],['K',6],['D',7],['E',8],['F',9],['H',11],['M',13],['Q',17],['R',18],['S',19],['T',20],['U',21],['V',22],['W',23],['X',24],['Y',25],['Z',26]] as const,latest=(side:'A'|'B',address:string)=>{const list=side==='A'?resultA.macroCalls:resultB.macroCalls;for(let i=list.length-1;i>=0;i--){const arg=list[i].arguments[address];if(arg)return arg.value;}return undefined;};return <div className="macro-page-stack"><MacroSection title="G65 引數規格Ⅰ" count={mapping.length} open><div className="macro-note">P＝呼叫程式號碼，L＝重複次數；兩者不寫入區域變數。下表顯示字母與 #1～#33 對應，以及 A／B 最近一次呼叫值。</div><div className="variable-table macro-argument-table"><div className="variable-table-header"><span>引數</span><span>區域變數</span><span>說明</span><span>程式 A</span><span>程式 B</span></div>{mapping.map(([address,variable])=><div className="variable-table-row" key={address}><b>{address}</b><span>#{variable}</span><em>G65 引數</em><output>{latest('A',address)??'—'}</output><output>{latest('B',address)??'—'}</output></div>)}</div></MacroSection><MacroSection title="巨集清單與 G65 呼叫" count={shown.length+calls.length} open><VariableTableFrame title="MACRO 清單" count={shown.length} query={q} setQuery={setQ}><div className="macro-note">G65 依 FANUC Macro B 建立區域引數，L 為重複次數；目前支援實檔所用的 ABS／SIN／COS 與 IF…GOTO。</div>{shown.map(n=>{const section=a.sections.find(x=>x.number===n)??b.sections.find(x=>x.number===n),found=!!section;return <div className="variable-table-row" key={n}><b>:{n}</b><span>{section?.label||'只找到呼叫'}</span><output>{a.calls.get(n)??0} 次</output><output>{b.calls.get(n)??0} 次</output><em className={found?'macro-found':'macro-missing'}>{found?'有本體':'缺本體'}</em></div>})}{calls.map((c,i)=><div className="macro-note" key={`${c.side}-${c.line}-${i}`}><b>{c.side} L{c.line}　G65 P{c.program}</b>　{Object.entries(c.arguments).map(([address,arg])=>`${address}→#${arg.variable}=${arg.value}`).join('　')}{c.repeat>1?`　重複 ${c.repeat} 次`:''}</div>)}</VariableTableFrame></MacroSection><MacroSection title="自設變數設定"><CustomVariableTable value={value} onChange={onChange} programA={programA} programB={programB} onProgramA={onProgramA} onProgramB={onProgramB}/></MacroSection><MacroSection title="變數變化紀錄" count={writes.length}><VariableTableFrame title="最近 200 筆" count={writes.length} query="" setQuery={()=>{}}>{writes.map((w,i)=><div className="variable-table-row" key={`${w.side}-${w.line}-${w.variable}-${i}`}><b>#{w.variable}</b><span>{w.side}・L{w.line}</span><output>{w.value}</output><output>{w.kind==='permanent'?'永久共用':'一般共用'}</output><em>寫入</em></div>)}</VariableTableFrame></MacroSection></div>}
function LiveMacroTable(props:{textA:string;textB:string;value:MachineConfig;onChange:(v:MachineConfig)=>void;programA:MachineConfig;programB:MachineConfig;onProgramA:(v:MachineConfig)=>void;onProgramB:(v:MachineConfig)=>void;resultA:ParseResult;resultB:ParseResult}){
  const {textA,textB,value,onChange,programA,programB,onProgramA,onProgramB,resultA,resultB}=props,[q,setQ]=useState(''),inventoryA=macroInventory(textA),inventoryB=macroInventory(textB);
  const calls=[...resultA.macroCalls.map(call=>({...call,side:'A' as const})),...resultB.macroCalls.map(call=>({...call,side:'B' as const}))],used=new Set(calls.flatMap(call=>Object.keys(call.arguments))),all=[['A',1],['B',2],['C',3],['I',4],['J',5],['K',6],['D',7],['E',8],['F',9],['H',11],['M',13],['Q',17],['R',18],['S',19],['T',20],['U',21],['V',22],['W',23],['X',24],['Y',25],['Z',26]] as const,mapping=all.filter(([address])=>used.has(address));
  const latest=(side:'A'|'B',address:string)=>{const list=side==='A'?resultA.macroCalls:resultB.macroCalls;for(let i=list.length-1;i>=0;i--){const argument=list[i].arguments[address];if(argument)return argument.value;}return undefined;},numbers=[...new Set([...inventoryA.sections.map(s=>s.number),...inventoryB.sections.map(s=>s.number),...inventoryA.calls.keys(),...inventoryB.calls.keys()])].sort(),shown=numbers.filter(number=>{const section=inventoryA.sections.find(s=>s.number===number)??inventoryB.sections.find(s=>s.number===number);return `${number} ${section?.label??''}`.toLowerCase().includes(q.toLowerCase())}),writes=[...resultA.variableWrites.map(write=>({...write,side:'A'})),...resultB.variableWrites.map(write=>({...write,side:'B'}))].filter(write=>write.kind==='common'||write.kind==='permanent').slice(-200);
  return <div className="macro-page-stack">
    <MacroSection title="當下使用的 G65 引數" count={mapping.length} open><div className="macro-note">只顯示目前單節已執行範圍內實際出現的引數；P 是程式號碼、L 是重複次數，不列入區域變數。</div>{mapping.length?<div className="variable-table macro-argument-table"><div className="variable-table-header"><span>引數／區域變數</span><span>程式 A</span><span>程式 B</span><span>說明</span></div>{mapping.map(([address,variable])=><div className="variable-table-row" key={address}><b>{address} → #{variable}</b><output>{latest('A',address)??'—'}</output><output>{latest('B',address)??'—'}</output><em>當下使用</em></div>)}</div>:<div className="empty macro-empty">目前尚未執行 G65</div>}</MacroSection>
    <MacroSection title="變數變化紀錄" count={writes.length} open><div className="variable-table macro-change-table"><div className="variable-table-header"><span>變數</span><span>程式／行</span><span>寫入值</span><span>共用設定</span></div>{writes.map((write,index)=><div className="variable-table-row" key={`${write.side}-${write.line}-${write.variable}-${index}`}><b>#{write.variable}</b><span>{write.side}・L{write.line}</span><output>{write.value}</output><output>{value.customVariables[write.variable]??0}</output></div>)}</div></MacroSection>
    <MacroSection title="巨集清單與 G65 呼叫" count={shown.length+calls.length}><VariableTableFrame title="MACRO 清單" count={shown.length} query={q} setQuery={setQ}>{shown.map(number=>{const section=inventoryA.sections.find(s=>s.number===number)??inventoryB.sections.find(s=>s.number===number);return <div className="variable-table-row" key={number}><b>:{number}</b><span>{section?.label||'只找到呼叫'}</span><output>{inventoryA.calls.get(number)??0} 次</output><output>{inventoryB.calls.get(number)??0} 次</output><em>{section?'有本體':'缺本體'}</em></div>})}{calls.map((call,index)=><div className="macro-note" key={`${call.side}-${call.line}-${index}`}><b>{call.side} L{call.line}　G65 P{call.program}</b>　{Object.entries(call.arguments).map(([address,arg])=>`${address}→#${arg.variable}=${arg.value}`).join('　')}</div>)}</VariableTableFrame></MacroSection>
    <MacroSection title="自設變數設定"><CustomVariableTable value={value} onChange={onChange} programA={programA} programB={programB} onProgramA={onProgramA} onProgramB={onProgramB}/></MacroSection>
  </div>;
}
function toolUses(text:string){const map=new Map<number,number>();for(const raw of text.split(/\r?\n/)){const line=raw.replace(/\([^)]*\)/g,'');for(const m of line.matchAll(/(?:^|\s)T\s*(\d+)/gi)){const n=+m[1];map.set(n,(map.get(n)??0)+1);}}return map;}
function ToolMagazineTable({value,onChange,a,b,textA,textB}:{value:MachineConfig;onChange:(v:MachineConfig)=>void;a:ParseResult;b:ParseResult;textA:string;textB:string}){const [q,setQ]=useState(''),ua=toolUses(textA),ub=toolUses(textB),pockets=Array.from({length:value.toolMagazineCapacity},(_,i)=>i+1),needle=q.toLowerCase(),shown=pockets.filter(p=>{const t=value.toolMagazine[p]??p;return `p${p} t${t}`.toLowerCase().includes(needle)}),controls=<label className="magazine-capacity">口袋<input type="number" min="1" max="240" value={value.toolMagazineCapacity} onChange={e=>onChange({...value,toolMagazineCapacity:Math.max(1,Math.min(240,+e.target.value||1))})}/></label>;return <VariableTableFrame title="刀庫（機台廠映射）" count={shown.length} query={q} setQuery={setQ} controls={controls}>{shown.map(p=>{const t=value.toolMagazine[p]??p,status=[a.finalSpindleTool===t||b.finalSpindleTool===t?'主軸':'',a.finalPendingTool===t||b.finalPendingTool===t?'待命':''].filter(Boolean).join('／')||'刀庫';return <div className="variable-table-row" key={p}><b>P{p}</b><span>刀具 T<input className="inline-tool" type="number" min="0" value={t} onChange={e=>onChange({...value,toolMagazine:{...value.toolMagazine,[p]:+e.target.value}})}/></span><output>{ua.get(t)??0} 次</output><output>{ub.get(t)??0} 次</output><em>{status}</em></div>})}<div className="macro-note">N4 實檔：T1～T60、54 個不同刀號。T 為預選、M6 才換入主軸；M31～M34 屬機台廠自訂，不在缺少機台手冊時猜測用途。</div></VariableTableFrame>}
