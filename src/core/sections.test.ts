import { describe, expect, it } from "vitest";
import { findProgramSections, sectionSelection } from "./sections";

const source = `%\n:1000(MAIN)\nG0 X1\nM98 P1\nM98 P9999\nM30\n:0001(SUB)\nG1 X2 F10\nM99\n:2000(OTHER)\nG0 X999\nM30\n%`;

describe("program sections", () => {
  it("indexes colon programs and their calls", () => {
    const sections = findProgramSections(source);
    expect(sections.map((s) => s.number)).toEqual(["1000", "0001", "2000"]);
    expect(sections[0].calls).toEqual(["0001", "9999"]);
  });
  it("expands called sections in execution order while preserving source line mapping", () => {
    const main = findProgramSections(source)[0];
    const result = sectionSelection(source, main.key);
    expect(result.related.map((s) => s.number)).toEqual(["0001"]);
    expect(result.missing).toEqual(["9999"]);
    expect(result.text).toContain("G1 X2 F10");
    expect(result.text).not.toContain("G0 X999");
    expect(result.text.split("\n")).toEqual([":1000(MAIN)", "G0 X1", "M98 P1", "G1 X2 F10", "M98 P9999", "M30"]);
    expect(result.lineMap).toEqual([2, 3, 4, 8, 5, 6]);
  });
  it("indexes standard O-number programs", () => {
    expect(findProgramSections("O0001\nG0X1\nM99\nO8002\nM99").map((s) => s.number)).toEqual(["0001", "8002"]);
  });
  it("allows every indexed program to run as its own section",()=>{const sections=findProgramSections(source);for(const section of sections){const selected=sectionSelection(source,section.key);expect(selected.selected?.number).toBe(section.number);expect(selected.text.length).toBeGreaterThan(0);}});
  it("依 G65 引數與 IF GOTO 展開 FANUC Macro B",()=>{const text=':8102(MACRO)\n#100=#24\n#110=#6\n#112=ABS[360/#110]\n#111=#5\nN1 G90 G1 X[#100+10*COS[#111]] Y[10*SIN[#111]] F100\n#111=#111+#112\n#110=#110-1\nIF[#110GT0]GOTO1\nM99\n:9000(MAIN)\nG65 P8102 X5 J0 K4\nM30',sections=findProgramSections(text),selected=sectionSelection(text,sections.find(s=>s.number==='9000')!.key);expect(selected.related.map(s=>s.number)).toContain('8102');expect(selected.text.match(/G90 G1/g)).toHaveLength(4);expect(selected.text).toContain('X15 Y0');expect(selected.text).toContain('X5 Y10')});
});
