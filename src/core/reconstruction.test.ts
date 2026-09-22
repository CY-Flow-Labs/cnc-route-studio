import {describe,expect,it} from 'vitest';
import {defaultMachine} from '../defaults';
import type {MotionSegment} from '../types';
import {inferRotaryDimensions} from './reconstruction';

const segment=(rotaryAngle:number,x:number,z:number,y=0):MotionSegment=>({id:String(rotaryAngle),line:1,raw:'',kind:'cut',plane:'G17',start:{x,y,z,w:0},end:{x,y:y+10,z,w:0},machineStart:{x,y,z,w:0},machineEnd:{x,y:y+10,z,w:0},relativeStart:{x,y,z,w:0},relativeEnd:{x,y:y+10,z,w:0},workOffset:'G54',workOffsetValue:{x:0,y:0,z:0,w:0},localOffset:{x:0,y:0,z:0,w:0},toolLengthComp:0,feed:100,spindle:1,tool:1,estimatedSeconds:1,rotaryCode:31,rotaryAngle});

describe('轉盤中心尺寸推算',()=>{
  it('不同轉盤角度會反旋回同一工件方向',()=>{
    const machine={...defaultMachine,rotary:{...defaultMachine.rotary,enabled:true,centerX:0,centerZW:0}};
    const result=inferRotaryDimensions([segment(0,50,20),segment(90,-20,50)],machine)!;
    expect(result.width).toBeCloseTo(100);
    expect(result.height).toBeCloseTo(40);
    expect(result.length).toBeCloseTo(10);
  });
});
