import type { MachineConfig, MotionSegment } from '../types';
import { sampleMotionPath, workToMachine } from './geometry';

export interface RotaryDimensions {
  width:number;
  height:number;
  length:number;
  pointCount:number;
  minX:number;
  maxX:number;
  minCross:number;
  maxCross:number;
  minY:number;
  maxY:number;
  widthFromFinishedFaces:boolean;
}

export const isSlowCut=(segment:MotionSegment,machine:MachineConfig)=>
  segment.kind!=='rapid'&&segment.feed>0&&segment.feed<=machine.rapidRate*.25;

/**
 * 慢速不一定代表鋒面：鑽孔循環、純 Z/W 向進退刀不應擔大工件外形。
 * 只有在 X/Y 面有有效切削行程的慢速移動，才視為可用於重建的鋒面路徑。
 */
export const isMillingSurface=(segment:MotionSegment,machine:MachineConfig)=>{
  if(!isSlowCut(segment,machine)||segment.kind==='cycle')return false;
  const dx=segment.machineEnd.x-segment.machineStart.x,dy=segment.machineEnd.y-segment.machineStart.y,
    cross=(segment.machineEnd.z+segment.machineEnd.w)-(segment.machineStart.z+segment.machineStart.w),surfaceTravel=Math.hypot(dx,dy);
  return surfaceTravel>.01&&surfaceTravel>=Math.abs(cross)*.25;
};

/**
 * 將各轉盤面的機械座標反旋至 M31 零度面，尺寸直接取與
 * 重建模型相同的鋒面點集包圍，不再以轉盤中心最大半徑倍增。
 */
export function inferRotaryDimensions(segments:MotionSegment[],machine:MachineConfig,boundarySegments:MotionSegment[]=segments):RotaryDimensions|undefined{
  if(!machine.rotary.enabled)return undefined;
  const centerX=machine.rotary.centerX,centerCross=machine.rotary.centerZW;
  let minX=Infinity,maxX=-Infinity,minCross=Infinity,maxCross=-Infinity,minY=Infinity,maxY=-Infinity,pointCount=0;
  for(const segment of segments){
    if(!isMillingSurface(segment,machine))continue;
    const angle=-segment.rotaryAngle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(const workPoint of sampleMotionPath(segment)){
      const point=workToMachine(segment,workPoint),dx=point.x-centerX,dCross=(point.z+point.w)-centerCross;
      const zeroX=dx*c-dCross*s,zeroCross=dx*s+dCross*c;
      minX=Math.min(minX,zeroX);maxX=Math.max(maxX,zeroX);
      minCross=Math.min(minCross,zeroCross);maxCross=Math.max(maxCross,zeroCross);
      minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);pointCount++;
    }
  }
  const finishedWidthFaces:{G55:number[];G57:number[]}={G55:[],G57:[]};
  for(const segment of boundarySegments){
    if(!isMillingSurface(segment,machine)||(segment.workOffset!=='G55'&&segment.workOffset!=='G57')||Math.abs(segment.start.z)>=.001||Math.abs(segment.end.z)>=.001||Math.abs(segment.start.w)>=.001||Math.abs(segment.end.w)>=.001)continue;
    const angle=-segment.rotaryAngle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    for(const workPoint of sampleMotionPath(segment)){const point=workToMachine(segment,workPoint),dx=point.x-centerX,dCross=point.z+point.w-segment.toolLengthComp-centerCross;finishedWidthFaces[segment.workOffset].push(dx*c-dCross*s);}
  }
  const widthFromFinishedFaces=finishedWidthFaces.G55.length>0&&finishedWidthFaces.G57.length>0;
  if(widthFromFinishedFaces){
    const face55=finishedWidthFaces.G55.reduce((sum,value)=>sum+value,0)/finishedWidthFaces.G55.length,face57=finishedWidthFaces.G57.reduce((sum,value)=>sum+value,0)/finishedWidthFaces.G57.length;
    minX=Math.min(face55,face57);maxX=Math.max(face55,face57);
  }
  return pointCount?{width:maxX-minX,height:maxCross-minCross,length:maxY-minY,pointCount,minX,maxX,minCross,maxCross,minY,maxY,widthFromFinishedFaces}:undefined;
}
