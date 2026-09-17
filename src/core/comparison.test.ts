import { describe, expect, it } from 'vitest';
import { comparePrograms } from './comparison';

describe('comparePrograms', () => {
  it('以 N 碼隔離大量插入並映射同步行', () => {
    const a = 'N10 G0 X0\nG1 X1\nN20 G0 X2\nG1 X3';
    const b = 'N10 G0 X0\nG1 X9\nG1 X10\nN20 G0 X2\nG1 X3';
    const result = comparePrograms(a, b);
    expect(result.bDifferences.get(2)).toBe('changed');
    expect(result.bDifferences.get(3)).toBe('added');
    expect(result.bDifferences.has(4)).toBe(false);
    expect(result.mapAToB(3)).toBe(4);
  });

  it('忽略空白與註解差異', () => {
    const result = comparePrograms('N1 G01 X1 (A)', 'N1G1X1(B)');
    expect(result.bDifferences.size).toBe(0);
  });
});
