import { describe, expect, it } from 'vitest';
import { defaultMachine } from '../defaults';
import { analyzeCollisions } from './analysis';
import { parseProgram } from './parser';

describe('固定機械座標碰撞判斷',()=>{
  it('使用機械座標比對毛胚，不受 G54 相對座標移動影響',()=>{
    const machine={...defaultMachine,initialMachinePositionConfigured:true,stock:{...defaultMachine.stock,x:20,y:20,z:20,origin:{x:0,y:0,z:-20,w:0}},fixtures:[],workOffsets:{...defaultMachine.workOffsets,G54:{x:100,y:0,z:0,w:0}}};
    const result=parseProgram({name:'fixed-origin.nc',text:'G54 G0 X-100 Y0 Z-10'},8000,[],machine);
    expect(result.segments[0].end.x).toBe(-100);
    expect(result.segments[0].machineEnd.x).toBe(0);
    expect(analyzeCollisions(result,machine).some(event=>event.type==='rapid-stock')).toBe(true);
  });
});
