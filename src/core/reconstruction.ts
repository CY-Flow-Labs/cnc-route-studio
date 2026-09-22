import type { MachineConfig, MotionSegment } from '../types';
import { sampleMotionPath, workToMachine } from './geometry';

export interface RotaryDimensions {
  width:number;
  height:number;
  length:number;
  pointCount:number;
}

export const isSlowCut=(segment:MotionSegment,machine:MachineConfig)=>
  segment.kind!=='rapid'&&segment.feed>0&&segment.feed<=machine.rapidRate*.25;

/**
 * 將各轉盤面的機械座標反旋至 M31 零度面，再以轉盤中心至加工點的
 * 最大雙側半徑推算寬、高；Y 軸範圍則作為工件長度。
 */
export function inferRotaryDimensions(segments:MotionSegment[],machine:MachineConfig):RotaryDimensions|undefined{
  if(!machine.rotary.enabled)return undefined;
  const centerX=machine.rotary.centerX,centerCross=machine.rotary.centerZW;
  let radiusX=0,radiusCross=0,minY=Infinity,maxY=-Infinity,pointCount=0;
  for(const segment of segments){
    if(!isSlowCut(segment,machine))continue;
    const angle=-segment.rotaryAngle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(const workPoint of sampleMotionPath(segment)){
      const point=workToMachine(segment,workPoint),dx=point.x-centerX,dCross=(point.z+point.w)-centerCross;
      const zeroX=dx*c-dCross*s,zeroCross=dx*s+dCross*c;
      radiusX=Math.max(radiusX,Math.abs(zeroX));
      radiusCross=Math.max(radiusCross,Math.abs(zeroCross));
      minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);pointCount++;
    }
  }
  return pointCount?{width:radiusX*2,height:radiusCross*2,length:maxY-minY,pointCount}:undefined;
}
