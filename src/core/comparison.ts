export type DifferenceKind = 'changed' | 'added';

export interface ProgramComparison {
  bDifferences: Map<number, DifferenceKind>;
  mapAToB: (line: number) => number;
  changed: number;
  added: number;
  removed: number;
  sections: number;
}

const normalized = (line: string) => line
  .replace(/\([^)]*\)|;.*$/g, '')
  .replace(/\s+/g, '')
  .toUpperCase()
  .replace(/([GMT])0+(\d+)/g, '$1$2');

interface NSection { key: string; start: number; end: number; lines: string[] }

function nSections(text: string): NSection[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const sections: NSection[] = [];
  const uses = new Map<string, number>();
  let current: NSection = { key: '__HEAD__:1', start: 1, end: lines.length, lines: [] };
  sections.push(current);
  lines.forEach((line, index) => {
    const match = line.match(/^\s*\/?\s*N\s*(\d+)/i);
    if (match) {
      const number = String(+match[1]), occurrence = (uses.get(number) ?? 0) + 1;
      uses.set(number, occurrence);
      current.end = index;
      current = { key: `${number}:${occurrence}`, start: index + 1, end: lines.length, lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  });
  return sections.filter(section => section.lines.length > 0);
}

function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  if (a.length * b.length > 62500) return [];
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const pairs: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { pairs.push([i++, j++]); }
    else if (table[i + 1][j] >= table[i][j + 1]) i++; else j++;
  }
  return pairs;
}

export function comparePrograms(textA: string, textB: string): ProgramComparison {
  const aSections = nSections(textA), bSections = nSections(textB);
  const aByKey = new Map(aSections.map(section => [section.key, section]));
  const bByKey = new Map(bSections.map(section => [section.key, section]));
  const bDifferences = new Map<number, DifferenceKind>(), linePairs: Array<[number, number]> = [];
  let added = 0, removed = 0;
  for (const b of bSections) {
    const a = aByKey.get(b.key);
    if (!a) {
      b.lines.forEach((_, i) => bDifferences.set(b.start + i, 'added'));
      added += b.lines.length;
      continue;
    }
    const an = a.lines.map(normalized), bn = b.lines.map(normalized), pairs = lcsPairs(an, bn);
    const matchedB = new Set(pairs.map(([, j]) => j)), matchedA = new Set(pairs.map(([i]) => i));
    pairs.forEach(([i, j]) => linePairs.push([a.start + i, b.start + j]));
    bn.forEach((_, j) => { if (!matchedB.has(j)) bDifferences.set(b.start + j, j < an.length ? 'changed' : 'added'); });
    added += Math.max(0, b.lines.length - a.lines.length);
    removed += Math.max(0, a.lines.length - b.lines.length);
    if (!pairs.length) linePairs.push([a.start, b.start], [a.end, b.end]);
    else {
      linePairs.push([a.start, b.start], [a.end, b.end]);
      removed += an.length - matchedA.size - Math.max(0, an.length - bn.length);
    }
  }
  for (const a of aSections) if (!bByKey.has(a.key)) removed += a.lines.length;
  linePairs.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const mapAToB = (line: number) => {
    if (!linePairs.length) return Math.max(1, line);
    let before = linePairs[0], after = linePairs[linePairs.length - 1];
    for (const pair of linePairs) { if (pair[0] <= line) before = pair; if (pair[0] >= line) { after = pair; break; } }
    if (after[0] === before[0]) return before[1];
    return Math.round(before[1] + (line - before[0]) * (after[1] - before[1]) / (after[0] - before[0]));
  };
  const changed = [...bDifferences.values()].filter(kind => kind === 'changed').length;
  return { bDifferences, mapAToB, changed, added, removed, sections: new Set([...aSections, ...bSections].map(s => s.key)).size };
}
