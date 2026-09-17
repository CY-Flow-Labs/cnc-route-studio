import type {MotionSegment,Point4} from '../types';

const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;

/** 依 FANUC G17/G18/G19 將圓弧取樣；同起終點視為完整 360° 圓。 */
export function sampleMotionPath(segment:MotionSegment,maxStep=Math.PI/36):Point4[]{
  if((segment.kind!=='arc-cw'&&segment.kind!=='arc-ccw')||!segment.center)return [{...segment.start},{...segment.end}];
  const [u,v]=segment.plane==='G18'?(['x','z'] as const):segment.plane==='G19'?(['y','z'] as const):(['x','y'] as const);
  const start=segment.start,end=segment.end,center=segment.center;
  const startAngle=Math.atan2(start[v]-center[v],start[u]-center[u]);
  const endAngle=Math.atan2(end[v]-center[v],end[u]-center[u]);
  let sweep=endAngle-startAngle;
  if(segment.kind==='arc-cw'){if(sweep>=-1e-12)sweep-=Math.PI*2;}else if(sweep<=1e-12)sweep+=Math.PI*2;
  const radius=(Math.hypot(start[u]-center[u],start[v]-center[v])+Math.hypot(end[u]-center[u],end[v]-center[v]))/2;
  const steps=Math.max(2,Math.ceil(Math.abs(sweep)/maxStep));
  const points=Array.from({length:steps+1},(_,i)=>{
    const t=i/steps,angle=startAngle+sweep*t;
    const point:Point4={x:lerp(start.x,end.x,t),y:lerp(start.y,end.y,t),z:lerp(start.z,end.z,t),w:lerp(start.w,end.w,t)};
    point[u]=center[u]+radius*Math.cos(angle);point[v]=center[v]+radius*Math.sin(angle);
    return point;
  });
  points[0]={...start};points[points.length-1]={...end};
  return points;
}

export function workToMachine(segment:MotionSegment,point:Point4):Point4{
  const q=segment.workOffsetValue;
  return {x:point.x+q.x,y:point.y+q.y,z:point.z+q.z+segment.toolLengthComp,w:point.w+q.w};
}
