export type ProgramSection = {
  key: string;
  number: string;
  label: string;
  start: number;
  end: number;
  calls: string[];
};

const number4 = (value: string) => String(Number(value)).padStart(4, "0");

export function findProgramSections(text: string): ProgramSection[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const starts: Array<{ index: number; number: string; label: string }> = [];
  lines.forEach((line, index) => {
    const match = line.match(/^\s*(?::|O)\s*(\d+)\s*(.*)$/i);
    if (match) starts.push({ index, number: number4(match[1]), label: match[2].trim() });
  });
  return starts.map((item, i) => {
    const end = (starts[i + 1]?.index ?? lines.length) - 1;
    const body = lines.slice(item.index, end + 1).join("\n");
    const calls = [...body.matchAll(/\b(?:M98|G65)\s*P\s*(\d+)/gi)].map((m) => number4(m[1]));
    return {
      key: `${item.number}@${item.index + 1}`,
      number: item.number,
      label: item.label,
      start: item.index + 1,
      end: end + 1,
      calls: [...new Set(calls)],
    };
  });
}

export function sectionSelection(text: string, key: string) {
  const sections = findProgramSections(text);
  const selected = sections.find((section) => section.key === key);
  const originalLines = text.replace(/\r/g, "").split("\n");
  if (!selected) return { text, lineMap: originalLines.map((_, index) => index + 1), selected: undefined, related: [] as ProgramSection[], missing: [] as string[] };
  const byNumber = new Map<string, ProgramSection>();
  sections.forEach((section) => { if (!byNumber.has(section.number)) byNumber.set(section.number, section); });
  const related: ProgramSection[] = [];
  const missing = new Set<string>();
  const included = new Map<string, ProgramSection>([[selected.key, selected]]);
  const visit = (section: ProgramSection) => section.calls.forEach((number) => {
    const target = byNumber.get(number);
    if (!target) { missing.add(number); return; }
    if (included.has(target.key)) return;
    included.set(target.key, target);
    related.push(target);
    visit(target);
  });
  visit(selected);
  const execution: Array<{ raw: string; line: number }> = [{raw:originalLines[selected.start-1],line:selected.start}];
  const macroShared=new Map<number,number>();
  const argumentVariables:Record<string,number>={A:1,B:2,C:3,I:4,J:5,K:6,D:7,E:8,F:9,H:11,M:13,Q:17,R:18,S:19,T:20,U:21,V:22,W:23,X:24,Y:25,Z:26};
  const macroValue=(expr:string,local:Map<number,number>)=>{let s=expr.toUpperCase();for(let guard=0;guard<40&&/(ABS|SIN|COS|TAN|SQRT)\s*\[([^\[\]]+)\]/.test(s);guard++)s=s.replace(/(ABS|SIN|COS|TAN|SQRT)\s*\[([^\[\]]+)\]/g,(_,fn,inner)=>{const v=macroValue(inner,local);if(v===undefined)return 'NAN';return String(fn==='ABS'?Math.abs(v):fn==='SQRT'?Math.sqrt(v):fn==='SIN'?Math.sin(v*Math.PI/180):fn==='COS'?Math.cos(v*Math.PI/180):Math.tan(v*Math.PI/180));});s=s.replace(/#(\d+)/g,(_,n)=>String(local.get(+n)??macroShared.get(+n)??NaN)).replace(/\[/g,'(').replace(/\]/g,')');if(!/^[\d+\-*/().\sEeNa]+$/.test(s))return undefined;try{const v=Function(`"use strict";return (${s})`)();if(!Number.isFinite(v))return undefined;return Math.abs(v)<1e-12?0:Math.round(v*1e12)/1e12;}catch{return undefined;}};
  const macroCondition=(expr:string,local:Map<number,number>)=>{const m=expr.match(/^(.*?)(GE|GT|LE|LT|EQ|NE)(.*)$/i);if(!m)return !!macroValue(expr,local);const a=macroValue(m[1],local),b=macroValue(m[3],local);if(a===undefined||b===undefined)return false;return m[2]==='GE'?a>=b:m[2]==='GT'?a>b:m[2]==='LE'?a<=b:m[2]==='LT'?a<b:m[2]==='EQ'?a===b:a!==b;};
  const resolveMacroLine=(raw:string,local:Map<number,number>)=>{let out=raw;for(let guard=0;guard<20&&/(ABS|SIN|COS|TAN|SQRT)\s*\[[^\[\]]+\]/i.test(out);guard++)out=out.replace(/(ABS|SIN|COS|TAN|SQRT)\s*\[([^\[\]]+)\]/gi,(all,fn,e)=>{const v=macroValue(`${fn}[${e}]`,local);return v===undefined?all:String(v);});for(let guard=0;guard<20&&/\[[^\[\]]+\]/.test(out);guard++)out=out.replace(/\[([^\[\]]+)\]/g,(all,e)=>{const v=macroValue(e,local);return v===undefined?all:String(v);});return out.replace(/#(\d+)/g,(all,n)=>{const v=local.get(+n)??macroShared.get(+n);return v===undefined?all:String(v);});};
  const expandMacro=(target:ProgramSection,callRaw:string,callLine:number,stack:string[])=>{if(stack.includes(target.number)||stack.length>=5){missing.add(`${target.number}（巨集遞迴或超過 FANUC 5 層）`);return;}const cleanCall=callRaw.replace(/\([^)]*\)/g,''),local=new Map<number,number>();for(const m of cleanCall.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/gi)){const variable=argumentVariables[m[1].toUpperCase()];if(variable)local.set(variable,+m[2]);}const labels=new Map<number,number>();for(let line=target.start+1;line<=target.end;line++){const n=originalLines[line-1].replace(/\([^)]*\)/g,'').match(/^\s*N\s*(\d+)/i);if(n)labels.set(+n[1],line);}let pc=target.start+1,guard=0;while(pc<=target.end&&guard++<10000){const raw=originalLines[pc-1],clean=raw.replace(/\([^)]*\)/g,'').trim().toUpperCase();if(/\bM\s*99\b/.test(clean))break;const conditional=clean.match(/^IF\s*\[([^\]]+)\]\s*GOTO\s*(\d+)/);if(conditional){pc=macroCondition(conditional[1],local)?(labels.get(+conditional[2])??pc+1):pc+1;continue;}const assignment=clean.match(/^#(\d+)\s*=\s*(.+)$/);if(assignment){const n=+assignment[1],value=macroValue(assignment[2],local);if(value!==undefined){if(n<=33)local.set(n,value);else{macroShared.set(n,value);execution.push({raw:`#${n}=${value} (G65 P${target.number})`,line:pc});}}pc++;continue;}const nested=clean.match(/\bG\s*65\s*P\s*(\d+)/);if(nested){const child=byNumber.get(number4(nested[1]));execution.push({raw:`${raw} (G65_EXPANDED)`,line:pc});if(child)expandMacro(child,raw,pc,[...stack,target.number]);else missing.add(number4(nested[1]));pc++;continue;}execution.push({raw:resolveMacroLine(raw,local),line:pc});pc++;}if(guard>=10000)missing.add(`${target.number}（巨集迴圈超過 10000 單節）`);};
  const expand = (section: ProgramSection, stack: string[]) => {
    if (stack.includes(section.number) || stack.length >= 20) { missing.add(`${section.number}（遞迴或超過 20 層）`); return; }
    const nextStack = [...stack, section.number];
    for (let line = section.start + 1; line <= section.end; line++) {
      const raw = originalLines[line - 1], clean = raw.replace(/\([^)]*\)/g, "");
      if (/\bM\s*99\b/i.test(clean)) break;
      const macro=clean.match(/\bG\s*65\s*P\s*(\d+)/i);
      execution.push({ raw:macro?`${raw} (G65_EXPANDED)`:raw, line });
      if(macro){const number=number4(macro[1]),target=byNumber.get(number),repeat=Math.max(1,Number(clean.match(/\bL\s*(\d+)/i)?.[1]??1));if(!target)missing.add(number);else for(let count=0;count<repeat;count++)expandMacro(target,raw,line,nextStack);continue;}
      const call = clean.match(/\bM\s*98\s*P\s*(\d+)/i);
      if (!call) continue;
      const number = number4(call[1]), target = byNumber.get(number), repeat = Math.max(1, Number(clean.match(/\bL\s*(\d+)/i)?.[1] ?? 1));
      if (!target) { missing.add(number); continue; }
      for (let count = 0; count < repeat; count++) expand(target, nextStack);
    }
  };
  expand(selected, []);
  return {
    text: execution.map((item) => item.raw).join("\n"),
    lineMap: execution.map((item) => item.line),
    selected,
    related,
    missing: [...missing],
  };
}
