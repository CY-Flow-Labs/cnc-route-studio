import {describe,expect,it} from 'vitest';
import {defaultMachine} from '../defaults';
import type {MotionSegment} from '../types';
import {inferRotaryDimensions,isMillingSurface,isSlowCut} from './reconstruction';

const segment=(rotaryAngle:number,x:number,z:number,y=0):MotionSegment=>({id:String(rotaryAngle),line:1,raw:'',kind:'cut',plane:'G17',start:{x,y,z,w:0},end:{x,y:y+10,z,w:0},machineStart:{x,y,z,w:0},machineEnd:{x,y:y+10,z,w:0},relativeStart:{x,y,z,w:0},relativeEnd:{x,y:y+10,z,w:0},workOffset:'G54',workOffsetValue:{x:0,y:0,z:0,w:0},localOffset:{x:0,y:0,z:0,w:0},toolLengthComp:0,feed:100,spindle:1,tool:1,estimatedSeconds:1,rotaryCode:31,rotaryAngle});

describe('轉盤中心尺寸推算',()=>{
  it('不同轉盤角度會反旋回同一鋒面點',()=>{
    const machine={...defaultMachine,rotary:{...defaultMachine.rotary,centerX:0,centerZW:0}};
    const result=inferRotaryDimensions([segment(0,50,20),segment(90,-20,50)],machine)!;
    expect(result.width).toBeCloseTo(0);
    expect(result.height).toBeCloseTo(0);
    expect(result.length).toBeCloseTo(10);
  });
  it('只用慢速鋒面重建，排除鑽孔循環與純軸向進退刀',()=>{
    const machine={...defaultMachine,rotary:{...defaultMachine.rotary,centerX:0,centerZW:0}},surface=segment(0,50,20),plunge={...segment(0,0,0),end:{x:0,y:0,z:-40,w:0},machineEnd:{x:0,y:0,z:-40,w:0}},cycle={...surface,kind:'cycle' as const};
    expect(isSlowCut(plunge,machine)).toBe(true);
    expect(isMillingSurface(surface,machine)).toBe(true);
    expect(isMillingSurface(plunge,machine)).toBe(false);
    expect(isMillingSurface(cycle,machine)).toBe(false);
  });
  it('尺寸跟隨鋒面點集的實際邊界，不以中心半徑倍增',()=>{
    const machine={...defaultMachine,rotary:{...defaultMachine.rotary,centerX:0,centerZW:0}};
    const result=inferRotaryDimensions([segment(0,-20,5),segment(0,50,25)],machine)!;
    expect(result.width).toBeCloseTo(70);
    expect(result.height).toBeCloseTo(20);
    expect(result.minX).toBeCloseTo(-20);
    expect(result.maxX).toBeCloseTo(50);
  });
  it('G55 與 G57 的 Z0 完成面優先定義加工件寬度',()=>{
    const machine={...defaultMachine,rotary:{...defaultMachine.rotary,centerX:0,centerZW:0}},g55={...segment(90,0,480.174),workOffset:'G55' as const,workOffsetValue:{x:0,y:0,z:480.174,w:0},toolLengthComp:250,start:{x:0,y:0,z:0,w:0},end:{x:0,y:10,z:0,w:0}},g57={...segment(270,0,480.826),workOffset:'G57' as const,workOffsetValue:{x:0,y:0,z:480.826,w:0},toolLengthComp:250,start:{x:0,y:0,z:0,w:0},end:{x:0,y:10,z:0,w:0}};
    const result=inferRotaryDimensions([g55,g57],machine)!;
    expect(result.widthFromFinishedFaces).toBe(true);
    expect(result.width).toBeCloseTo(961);
  });
  it('可先從已解析程式取得最終面邊界，模型內容仍只用已完成鋒面',()=>{
    const machine={...defaultMachine,rotary:{...defaultMachine.rotary,centerX:0,centerZW:0}},completed=segment(0,20,10),g55={...segment(90,0,480.174),workOffset:'G55' as const,workOffsetValue:{x:0,y:0,z:480.174,w:0},start:{x:0,y:0,z:0,w:0},end:{x:0,y:10,z:0,w:0}},g57={...segment(270,0,480.826),workOffset:'G57' as const,workOffsetValue:{x:0,y:0,z:480.826,w:0},start:{x:0,y:0,z:0,w:0},end:{x:0,y:10,z:0,w:0}};
    const result=inferRotaryDimensions([completed],machine,[completed,g55,g57])!;
    expect(result.pointCount).toBe(2);
    expect(result.width).toBeCloseTo(961);
  });
});
