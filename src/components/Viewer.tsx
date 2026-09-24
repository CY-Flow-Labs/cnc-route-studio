import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import type { MachineConfig, MotionSegment, Point4 } from "../types";
import {sampleMotionPath,workToMachine} from "../core/geometry";
import {inferRotaryDimensions,isMillingSurface,isSlowCut} from "../core/reconstruction";
const cnc = (p: Point4) => new THREE.Vector3(p.x, -(p.z + p.w), p.y),
  f = (v?: number) => Number(v ?? 0).toFixed(3);
const interpolatePoint=(start:Point4,end:Point4,t:number):Point4=>({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t,z:start.z+(end.z-start.z)*t,w:start.w+(end.w-start.w)*t});
const pointOnPath=(points:Point4[],progress:number)=>{const scaled=Math.min(points.length-1,progress*(points.length-1)),index=Math.min(points.length-2,Math.floor(scaled));return interpolatePoint(points[index],points[index+1],scaled-index)};
const rotateWithTable=(point:THREE.Vector3,center:THREE.Vector3,degrees:number)=>point.clone().sub(center).applyAxisAngle(new THREE.Vector3(0,0,1),THREE.MathUtils.degToRad(degrees)).add(center);
type AnimatedPosition={work:Point4;machine:Point4};
const mn = (k?: MotionSegment["kind"]) =>
  k === "rapid"
    ? "G0 Rapid"
    : k === "cut"
      ? "G1 Linear cut"
      : k === "arc-cw"
        ? "G2 Arc"
        : k === "arc-ccw"
          ? "G3 Arc"
          : k === "cycle"
            ? "Cycle"
            : "Not started";
export function Viewer({
  a,
  b,
  indexA,
  indexB,
  showA,
  showB,
  showFixtures,
  machine,
  statusA,
  statusB,
  playingA,playingB,speedA,speedB,
}: {
  a: MotionSegment[];
  b: MotionSegment[];
  indexA: number;
  indexB: number;
  showA: boolean;
  showB: boolean;
  showFixtures: boolean;
  machine: MachineConfig;
  statusA:{g:string;m:string;t:string};
  statusB:{g:string;m:string;t:string};
  playingA:boolean;playingB:boolean;speedA:number;speedB:number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [viewPlane, setViewPlane] = useState<"xyz"|"top"|"bottom"|"front"|"back"|"right"|"left">("xyz");
  const [viewRevision,setViewRevision]=useState(0);
  const [animatedA,setAnimatedA]=useState<AnimatedPosition>();
  const [animatedB,setAnimatedB]=useState<AnimatedPosition>();
  const cameraState = useRef({ yaw: -0.7, pitch: 0.65, zoom: 1050, target: new THREE.Vector3(), dataKey: "" });
  const playbackState=useRef({playingA,playingB,speedA,speedB});
  playbackState.current={playingA,playingB,speedA,speedB};
  const displaySegment=(showA?a[Math.min(indexA,a.length-1)]:undefined)??(showB?b[Math.min(indexB,b.length-1)]:undefined);
  const completedSegments=useMemo(()=>[
    ...(showA?a.slice(0,Math.max(0,indexA+(playingA?0:1))):[]),
    ...(showB?b.slice(0,Math.max(0,indexB+(playingB?0:1))):[]),
  ],[a,b,indexA,indexB,playingA,playingB,showA,showB]);
  const parsedBoundarySegments=useMemo(()=>[...(showA?a:[]),...(showB?b:[])],[a,b,showA,showB]);
  const inferredDimensions=useMemo(()=>inferRotaryDimensions(completedSegments,machine,parsedBoundarySegments),[completedSegments,machine,parsedBoundarySegments]);
  useEffect(() => {
    if (!host.current) return;
    const el = host.current,
      scene = new THREE.Scene(),
      perspectiveCamera = new THREE.PerspectiveCamera(
        45,
        el.clientWidth / el.clientHeight,
        0.1,
        100000,
      ),
      orthographicCamera=new THREE.OrthographicCamera(-1,1,1,-1,.1,100000),
      renderer = new THREE.WebGLRenderer({ antialias: true });
    scene.background = new THREE.Color(0x05090d);
    perspectiveCamera.up.set(0, 0, 1);orthographicCamera.up.set(0,0,1);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const ax = (d: THREE.Vector3, c: number) =>
      scene.add(new THREE.ArrowHelper(d, new THREE.Vector3(), 90, c, 14, 7));
    if(!machine.rotary.enabled){ax(new THREE.Vector3(1, 0, 0), 0xff4058);ax(new THREE.Vector3(0, 0, 1), 0x48e081);ax(new THREE.Vector3(0, -1, 0), 0x438cff);}
    if(machine.rotary.enabled){
      const rotary=machine.rotary,angle=THREE.MathUtils.degToRad(displaySegment?.rotaryAngle??0);
      const center=new THREE.Vector3(rotary.centerX,-rotary.centerZW,rotary.centerY+rotary.length/2);
      const assembly=new THREE.Group();assembly.position.copy(center);assembly.rotation.z=angle;scene.add(assembly);
      const axis=new THREE.Mesh(new THREE.CylinderGeometry(3,3,rotary.length+80,16),new THREE.MeshBasicMaterial({color:0xf4d35e,transparent:true,opacity:.8}));axis.rotation.x=Math.PI/2;assembly.add(axis);
    }
    const marker=(position:Point4,color:number,size:number)=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(size,16,12),new THREE.MeshBasicMaterial({color}));
      mesh.position.copy(cnc(position));
      scene.add(mesh);
    };
    if(!machine.rotary.enabled)marker({x:0,y:0,z:0,w:0},0xffffff,7);
    const worldLabel=(text:string,position:THREE.Vector3,color:string,scale=128)=>{
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;
      const ctx=canvas.getContext('2d');if(!ctx)return;
      ctx.font='bold 34px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='rgba(5,9,13,.88)';ctx.fillRect(0,0,512,96);ctx.strokeStyle='rgba(104,220,255,.38)';ctx.strokeRect(1,1,510,94);ctx.fillStyle=color;ctx.fillText(text,256,48);
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));
      sprite.position.copy(position);sprite.scale.set(scale,scale*96/512,1);scene.add(sprite);
    };
    const label=(text:string,position:Point4,color:string)=>worldLabel(text,cnc(position).add(new THREE.Vector3(0,18,0)),color);
    if(!machine.rotary.enabled)label('Machine zero X0 Y0 Z0',{x:0,y:0,z:0,w:0},'#ffffff');
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(machine.stock.x, machine.stock.z, machine.stock.y),
      new THREE.MeshPhongMaterial({
        color: 0x41576a,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      }),
    );
    stock.position.set(
      machine.stock.origin.x,
      -(machine.stock.origin.z + machine.stock.z / 2),
      machine.stock.origin.y,
    );
    if(!machine.rotary.enabled)scene.add(stock);
    if (showFixtures)
      for (const q of machine.fixtures) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(q.x, q.z, q.y),
          new THREE.MeshPhongMaterial({
            color: 0xf08b3e,
            transparent: true,
            opacity: 0.65,
          }),
        );
        m.position.set(q.origin.x, -(q.origin.z + q.z / 2), q.origin.y);
        scene.add(m);
      }
    const gridKeys=new Set<string>();
    for(const [segment,color] of [[showA?a[Math.min(indexA,a.length-1)]:undefined,0x37d5ff],[showB?b[Math.min(indexB,b.length-1)]:undefined,0xf4c44e]] as const){
      if(!segment||segment.workOffset==='G59')continue;const q=segment.workOffsetValue,key=`${q.x}:${q.y}:${q.z}:${q.w}`;
      if(gridKeys.has(key))continue;gridKeys.add(key);
      const grid=new THREE.GridHelper(1200,24,color,0x142633);grid.position.copy(cnc(q));scene.add(grid);
    }
    // 3D 世界一律使用固定MachineCoords；G54～G59 與刀L只改變Path換算，不移動Machine zero。
    const point=(s:MotionSegment,end=false)=>cnc(end?s.machineEnd:s.machineStart);
    const animations:Array<{side:'A'|'B';segment:MotionSegment;workPoints:Point4[];machinePoints:Point4[];vectors:THREE.Vector3[];line:THREE.Line;tip:THREE.Mesh;tool?:THREE.Mesh;duration:number;progress:number}>=[];
    const machiningEnvelope=new THREE.Box3(),reconstructionPoints:THREE.Vector3[]=[],dimensionPoints:THREE.Vector3[]=[];
    const path = (side:'A'|'B',items: MotionSegment[], index: number,playing:boolean,speed:number) => {
      const currentAngle=items[Math.min(index,items.length-1)]?.rotaryAngle??0;
      const rotaryCenter=new THREE.Vector3(machine.rotary.centerX,-machine.rotary.centerZW,machine.rotary.centerY+machine.rotary.length/2);
      return (
      items.forEach((s, i) => {
        const workPoints=sampleMotionPath(s),machinePoints=workPoints.map(q=>workToMachine(s,q));
        machinePoints[0]={...s.machineStart};machinePoints[machinePoints.length-1]={...s.machineEnd};
        const attachToRotatingWorkpiece=machine.rotary.enabled&&i<index;
        const angleDelta=currentAngle-s.rotaryAngle;
        const p=machinePoints.map(q=>{const world=cnc(q);return attachToRotatingWorkpiece?rotateWithTable(world,rotaryCenter,angleDelta):world;}),
          now = i === index,
          done = i < index,
          millingSurface=isMillingSurface(s,machine),
          otherSlow=isSlowCut(s,machine)&&!millingSurface,
          color = now
            ? 0xffff40
            : s.kind === "rapid"
              ? 0xff4058
              : otherSlow
                ? 0xc983ff
              : millingSurface
                ? 0x42e67b
                : 0x42c9ff;
        const line=new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(now&&playing?[p[0],p[0]]:p),
            new THREE.LineBasicMaterial({
              color,
              transparent: true,
              opacity: now ? 1 : done ? 0.95 : 0.14,
            }));scene.add(line);
        if(otherSlow){scene.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(p),new THREE.PointsMaterial({color:0xc983ff,size:6,sizeAttenuation:false,transparent:true,opacity:now?1:(done ? .95 : .3),depthTest:false})));}
        const completed=i<index||(i===index&&!playing);
        if(completed&&millingSurface){
          const attached=machinePoints.map(cnc).map(point=>machine.rotary.enabled?rotateWithTable(point,rotaryCenter,currentAngle-s.rotaryAngle):point);
          attached.forEach(point=>{machiningEnvelope.expandByPoint(point);reconstructionPoints.push(point.clone());});
          if(attached.length>=2){const configuredTool=machine.tools.find(tool=>tool.number===s.tool),radius=Math.max(1,Math.min(12,(configuredTool?.diameter??8)/2)),material=new THREE.MeshStandardMaterial({color:0x43e58f,emissive:0x0b6f43,emissiveIntensity:.5,transparent:true,opacity:.82,roughness:.55}),curve=new THREE.CurvePath<THREE.Vector3>();for(let pointIndex=1;pointIndex<attached.length;pointIndex++)curve.add(new THREE.LineCurve3(attached[pointIndex-1],attached[pointIndex]));scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(2,attached.length*2),radius,8,false),material));}
        }
        if (now) {
          const tip = new THREE.Mesh(
            new THREE.SphereGeometry(9, 18, 12),
            new THREE.MeshBasicMaterial({ color: 0xffffff }),
          );
          tip.position.copy(playing?p[0]:p[p.length-1]);
          scene.add(tip);
          animations.push({side,segment:s,workPoints,machinePoints,vectors:p,line,tip,duration:Math.max(.025,s.estimatedSeconds),progress:playing?0:1});
        }
      }));
    };
    if (showA) path('A',a, indexA,playingA,speedA);
    if (showB) path('B',b, indexB,playingB,speedB);
    if(inferredDimensions?.widthFromFinishedFaces&&reconstructionPoints.length){
      const currentAngle=displaySegment?.rotaryAngle??0,rotaryCenter=new THREE.Vector3(machine.rotary.centerX,-machine.rotary.centerZW,machine.rotary.centerY+machine.rotary.length/2),minX=machine.rotary.centerX+inferredDimensions.minX,maxX=machine.rotary.centerX+inferredDimensions.maxX;
      for(const point of reconstructionPoints){const zeroPoint=rotateWithTable(point,rotaryCenter,-currentAngle);zeroPoint.x=Math.max(minX,Math.min(maxX,zeroPoint.x));point.copy(rotateWithTable(zeroPoint,rotaryCenter,currentAngle));}
    }
    // 將四面慢速Cut線的取樣點直接重建為工件外殼，不加入推定方盒或RotaryCenter點。
    if(reconstructionPoints.length>=4){
      try{const unique=[...new Map(reconstructionPoints.map(point=>[`${point.x.toFixed(3)}:${point.y.toFixed(3)}:${point.z.toFixed(3)}`,point])).values()];if(unique.length>=4){const shellGeometry=new ConvexGeometry(unique),shell=new THREE.Mesh(shellGeometry,new THREE.MeshStandardMaterial({color:0x7796a3,transparent:true,opacity:.32,roughness:.72,metalness:.08,side:THREE.DoubleSide,depthWrite:false}));scene.add(shell);scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(shellGeometry,12),new THREE.LineBasicMaterial({color:0xa8edff,transparent:true,opacity:.72})));}}catch{/* 點雲共面時只Showing加工掃掠線 */}
    }
    if(inferredDimensions&&reconstructionPoints.length){
      const currentAngle=displaySegment?.rotaryAngle??0,rotaryCenter=new THREE.Vector3(machine.rotary.centerX,-machine.rotary.centerZW,machine.rotary.centerY+machine.rotary.length/2),angleRadians=THREE.MathUtils.degToRad(currentAngle),rotateDimension=(point:THREE.Vector3)=>rotateWithTable(point,rotaryCenter,currentAngle),rotateDirection=(vector:THREE.Vector3)=>vector.clone().applyAxisAngle(new THREE.Vector3(0,0,1),angleRadians),
        viewingAxis=viewPlane==='top'?new THREE.Vector3(0,1,0):viewPlane==='bottom'?new THREE.Vector3(0,-1,0):viewPlane==='front'?new THREE.Vector3(0,0,1):viewPlane==='back'?new THREE.Vector3(0,0,-1):viewPlane==='right'?new THREE.Vector3(-1,0,0):viewPlane==='left'?new THREE.Vector3(1,0,0):undefined,
        minLength=inferredDimensions.minY,maxLength=inferredDimensions.maxY,centerX=machine.rotary.centerX,
        width=inferredDimensions.width,height=inferredDimensions.height,length=inferredDimensions.length,pad=Math.max(24,Math.max(width,height)*.12),tick=Math.max(8,pad*.34),color=0x6fe8ff;
      const dimension=(start:THREE.Vector3,end:THREE.Vector3,text:string,tickVector:THREE.Vector3,labelOffset:THREE.Vector3)=>{
        const rotatedStart=rotateDimension(start),rotatedEnd=rotateDimension(end),unit=rotateDirection(tickVector).normalize().multiplyScalar(tick),rotatedLabelOffset=rotateDirection(labelOffset),points=[rotatedStart,rotatedEnd,rotatedStart.clone().sub(unit),rotatedStart.clone().add(unit),rotatedEnd.clone().sub(unit),rotatedEnd.clone().add(unit)],labelPosition=rotatedStart.clone().lerp(rotatedEnd,.5).add(rotatedLabelOffset);
        if(viewingAxis&&Math.abs(rotatedEnd.clone().sub(rotatedStart).normalize().dot(viewingAxis))>.985)return;
        scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color,transparent:true,opacity:.95,depthTest:false})));
        worldLabel(text,labelPosition,'#bff7ff',Math.max(190,Math.min(280,text.length*18)));
        dimensionPoints.push(rotatedStart.clone(),rotatedEnd.clone(),labelPosition);
      };
      const minWorldX=centerX+inferredDimensions.minX,maxWorldX=centerX+inferredDimensions.maxX,minWorldY=-(machine.rotary.centerZW+inferredDimensions.maxCross),maxWorldY=-(machine.rotary.centerZW+inferredDimensions.minCross),widthZ=minLength-pad,widthY=maxWorldY+pad;
      dimension(new THREE.Vector3(minWorldX,widthY,widthZ),new THREE.Vector3(maxWorldX,widthY,widthZ),`W ${f(width)} mm`,new THREE.Vector3(0,1,0),new THREE.Vector3(0,tick*1.8,0));
      const heightX=maxWorldX+pad;
      dimension(new THREE.Vector3(heightX,minWorldY,widthZ),new THREE.Vector3(heightX,maxWorldY,widthZ),`H ${f(height)} mm`,new THREE.Vector3(1,0,0),new THREE.Vector3(tick*2,0,0));
      const lengthX=minWorldX-pad,lengthY=minWorldY-pad;
      dimension(new THREE.Vector3(lengthX,lengthY,minLength),new THREE.Vector3(lengthX,lengthY,maxLength),`L ${f(length)} mm`,new THREE.Vector3(1,0,0),new THREE.Vector3(-tick*2,0,0));
    }
    const addTool = (side:'A'|'B',cur: MotionSegment | undefined, color: number,playing:boolean) => {
      if (!cur) return;
      const tool = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6, 70, 20),
        new THREE.MeshPhongMaterial({ color }),
      );
      const animation=animations.find(item=>item.side===side);tool.position.copy(playing&&animation?animation.vectors[0]:point(cur,true)).add(new THREE.Vector3(0, -35, 0));
      if(animation)animation.tool=tool;
      scene.add(tool);
    };
    if (showA) addTool('A',a[Math.min(indexA, a.length - 1)], 0x66d8ff,playingA);
    if (showB) addTool('B',b[Math.min(indexB, b.length - 1)], 0xffd166,playingB);
    const visibleItems = [...(showA ? a : []), ...(showB ? b : [])];
    const dataKey = `${showA}-${showB}-${a.length}-${b.length}-${visibleItems[0]?.id ?? ""}-${visibleItems.at(-1)?.id ?? ""}-${machine.rotary.enabled?'rotary-object':'machine'}`;
    if (cameraState.current.dataKey !== dataKey && visibleItems.length) {
      const box = new THREE.Box3();
      if(machine.rotary.enabled&&reconstructionPoints.length)box.setFromPoints([...reconstructionPoints,...dimensionPoints]);else visibleItems.forEach((segment) => sampleMotionPath(segment).forEach(q=>box.expandByPoint(cnc(workToMachine(segment,q)))));
      box.getCenter(cameraState.current.target);
      const size = box.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (showA && !showB) cameraState.current.target.z -= extent * 0.22;
      cameraState.current.zoom = Math.max(180, extent * (showA && !showB ? 1.18 : 1.45));
      cameraState.current.dataKey = dataKey;
    }
    let dragMode:"rotate"|"pan"|null = null,
      lx = 0,
      ly = 0;
    const view = () => {
      const { yaw, pitch, zoom, target } = cameraState.current;
      const aspect=Math.max(.1,el.clientWidth/Math.max(1,el.clientHeight)),distance=Math.max(10000,zoom*4),camera=viewPlane==='xyz'?perspectiveCamera:orthographicCamera;
      orthographicCamera.left=-zoom*aspect/2;orthographicCamera.right=zoom*aspect/2;orthographicCamera.top=zoom/2;orthographicCamera.bottom=-zoom/2;orthographicCamera.updateProjectionMatrix();
      if (viewPlane === "top") {
        camera.up.set(0, 0, 1);
        camera.position.copy(target).add(new THREE.Vector3(0, -distance, 0));
      } else if(viewPlane === "bottom"){
        camera.up.set(0,0,1);
        camera.position.copy(target).add(new THREE.Vector3(0,distance,0));
      } else if(viewPlane === "front"){
        camera.up.set(0,-1,0);
        camera.position.copy(target).add(new THREE.Vector3(0,0,-distance));
      } else if(viewPlane === "back"){
        camera.up.set(0,-1,0);
        camera.position.copy(target).add(new THREE.Vector3(0,0,distance));
      } else if (viewPlane === "right") {
        camera.up.set(0, 0, 1);
        camera.position.copy(target).add(new THREE.Vector3(distance, 0, 0));
      } else if(viewPlane === "left"){
        camera.up.set(0,0,1);
        camera.position.copy(target).add(new THREE.Vector3(-distance,0,0));
      } else {
        camera.up.set(0, 0, 1);
        camera.position.copy(target).add(new THREE.Vector3(
          zoom * Math.cos(pitch) * Math.cos(yaw),
          zoom * Math.cos(pitch) * Math.sin(yaw),
          zoom * Math.sin(pitch),
        ));
      }
      camera.lookAt(target);
    };
    view();
    const pd = (e: PointerEvent) => {
        dragMode=e.button===1||e.button===2||e.shiftKey?'pan':'rotate';
        lx = e.clientX;
        ly = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
        e.preventDefault();
      },
      pu = (e:PointerEvent) => {dragMode=null;if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);},
      pm = (e: PointerEvent) => {
        if (!dragMode) return;
        const dx=e.clientX-lx,dy=e.clientY-ly;
        if(dragMode==='rotate'&&viewPlane==='xyz'){
          cameraState.current.yaw -= dx * 0.008;
          cameraState.current.pitch = Math.max(0.08,Math.min(1.48,cameraState.current.pitch + dy * 0.008));
        }else{
          const camera=viewPlane==='xyz'?perspectiveCamera:orthographicCamera,forward=cameraState.current.target.clone().sub(camera.position).normalize(),right=new THREE.Vector3().crossVectors(forward,camera.up).normalize(),up=new THREE.Vector3().crossVectors(right,forward).normalize(),scale=cameraState.current.zoom*.0015;
          cameraState.current.target.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);
        }
        lx = e.clientX;
        ly = e.clientY;
        view();
      },
      wh = (e: WheelEvent) => {
        cameraState.current.zoom = Math.max(20, Math.min(50000, cameraState.current.zoom * (e.deltaY > 0 ? 1.1 : 0.9)));
        view();
        e.preventDefault();
      };
    renderer.domElement.addEventListener("pointerdown", pd);
    renderer.domElement.addEventListener("pointerup", pu);
    renderer.domElement.addEventListener("pointercancel", pu);
    renderer.domElement.addEventListener("pointermove", pm);
    renderer.domElement.addEventListener("wheel", wh, { passive: false });
    renderer.domElement.addEventListener("contextmenu",e=>e.preventDefault());
    let frame = 0;const current=new THREE.Vector3();let lastCoordinateUpdate=0,lastFrame=performance.now();
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const now=performance.now(),delta=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;for(const animation of animations){const state=playbackState.current,active=animation.side==='A'?state.playingA:state.playingB,speed=animation.side==='A'?state.speedA:state.speedB;if(active)animation.progress=Math.min(1,animation.progress+delta*Math.max(.01,speed)/animation.duration);const progress=animation.progress,scaled=Math.min(animation.vectors.length-1,progress*(animation.vectors.length-1)),pathIndex=Math.min(animation.vectors.length-2,Math.floor(scaled));current.copy(animation.vectors[pathIndex]).lerp(animation.vectors[pathIndex+1],scaled-pathIndex);animation.line.geometry.setFromPoints([...animation.vectors.slice(0,pathIndex+1),current.clone()]);animation.tip.position.copy(current);animation.tool?.position.copy(current).add(new THREE.Vector3(0,-35,0));if(now-lastCoordinateUpdate>=50){const position={work:pointOnPath(animation.workPoints,progress),machine:pointOnPath(animation.machinePoints,progress)};animation.side==='A'?setAnimatedA(position):setAnimatedB(position);}}
      if(now-lastCoordinateUpdate>=50)lastCoordinateUpdate=now;
      renderer.render(scene,viewPlane==='xyz'?perspectiveCamera:orthographicCamera);
    };
    loop();
    const resize = () => {
      perspectiveCamera.aspect = el.clientWidth / el.clientHeight;
      perspectiveCamera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
      view();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    const resizeFrames = [
      requestAnimationFrame(resize),
      requestAnimationFrame(() => requestAnimationFrame(resize)),
    ];
    const settleTimer = window.setTimeout(resize, 180);
    return () => {
      cancelAnimationFrame(frame);
      resizeFrames.forEach(cancelAnimationFrame);
      window.clearTimeout(settleTimer);
      ro.disconnect();
      scene.traverse(object=>{const renderable=object as THREE.Mesh|THREE.Line|THREE.Sprite;const geometry=(renderable as THREE.Mesh).geometry;if(geometry)geometry.dispose();const materials=Array.isArray(renderable.material)?renderable.material:renderable.material?[renderable.material]:[];for(const material of materials){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.dispose();material.dispose();}});
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
    };
  }, [a, b, indexA, indexB, showA, showB, showFixtures, machine, viewPlane,viewRevision,displaySegment?.rotaryAngle]);
  const ca = a[Math.min(indexA, a.length - 1)],
    cb = b[Math.min(indexB, b.length - 1)];
  const adjustView=(action:'in'|'out'|'left'|'right'|'up'|'down'|'reset')=>{const state=cameraState.current,step=state.zoom*.08;if(action==='in')state.zoom=Math.max(20,state.zoom*.8);else if(action==='out')state.zoom=Math.min(50000,state.zoom*1.25);else if(action==='left')state.target.x-=step;else if(action==='right')state.target.x+=step;else if(action==='up')state.target.z+=step;else if(action==='down')state.target.z-=step;else state.dataKey='';setViewRevision(v=>v+1);};
  return (
    <div className="viewer-shell">
      <div className="coordinate-panel">
        {showA && <Row side="A" s={ca} position={animatedA} />} {showB && <Row side="B" s={cb} position={animatedB} />}
      </div>
      <div className="viewer" ref={host}>
        <div className="live-code-status" aria-label="Live G/M/T">
          {showA&&<CodeStatus side="A" value={statusA}/>} {showB&&<CodeStatus side="B" value={statusB}/>} 
        </div>
        <div className="legend">
          {machine.rotary.enabled?<><span className="rapid-dot" />G0 Rapid <span style={{background:'#62e6b7'}} />Milling surface <span style={{background:'#c983ff'}} />Other slow <span style={{background:'#42c9ff'}} />Other cuts</>:<><span style={{background:'#fff'}} />Machine zero <span className="rapid-dot" />G0 Rapid <span className="g1-dot" />G1 Cut <span className="arc-dot" />G2/G3 Arc</>}
        </div>
        {machine.rotary.enabled&&<div className="rotary-status"><strong>Rotary M{displaySegment?.rotaryCode??machine.rotary.zeroCode}</strong><b>{displaySegment?.rotaryAngle??0}°</b><span>Center X {f(machine.rotary.centerX)}　Z+W {f(machine.rotary.centerZW)}</span><span>{inferredDimensions?`Estimated：W ${f(inferredDimensions.width)}　H ${f(inferredDimensions.height)}　L ${f(inferredDimensions.length)} mm`:'Estimated：Waiting for milled surfaces'}</span><span>Completed surfaces · final face bounds</span></div>}
        <div className="view-presets" aria-label="Views">
          {([['xyz','3D'],['top','Top'],['bottom','Bottom'],['front','Front'],['back','Back'],['right','Right'],['left','Left']] as const).map(([plane,label]) => <button key={plane} type="button" className={viewPlane === plane ? "active" : ""} onClick={() => setViewPlane(plane)}>{label}</button>)}
        </div>
        <div className="camera-controls" aria-label="View controls"><button type="button" title="Pan left" onClick={()=>adjustView('left')}>←</button><button type="button" title="Pan up" onClick={()=>adjustView('up')}>↑</button><button type="button" title="Pan down" onClick={()=>adjustView('down')}>↓</button><button type="button" title="Pan right" onClick={()=>adjustView('right')}>→</button><button type="button" title="Zoom in" onClick={()=>adjustView('in')}>＋</button><button type="button" title="Zoom out" onClick={()=>adjustView('out')}>－</button><button type="button" title="Fit paths" onClick={()=>adjustView('reset')}>Fit</button></div>
      </div>
    </div>
  );
}
function CodeStatus({side,value}:{side:'A'|'B';value:{g:string;m:string;t:string}}){return <section className={`code-status side-${side.toLowerCase()}`}><strong>Program {side} Status</strong><output><b>G</b>{value.g}</output><output><b>M</b>{value.m}</output><output><b>T</b>{value.t}</output></section>}
function Row({ side, s,position }: { side: "A" | "B"; s?: MotionSegment;position?:AnimatedPosition }) {
  const coords=(label:string,p?:Point4)=><output><em>{label}</em><b>X</b> {f(p?.x)} <b>Y</b> {f(p?.y)} <b>Z</b> {f(p?.z)} <b>W</b> {f(p?.w)}</output>;
  const work=position?.work??s?.end,machine=position?.machine??s?.machineEnd;
  const remaining = work && s ? {
    x: s.end.x - work.x,
    y: s.end.y - work.y,
    z: s.end.z - work.z,
    w: s.end.w - work.w,
  } : undefined;
  return (
    <div className={`coordinate-row side-${side.toLowerCase()}`}>
      <div>
        <strong>Program {side}</strong>
        <span>{s ? `Line ${s.line}・${mn(s.kind)}・${s.workOffset}・M${s.rotaryCode} ${s.rotaryAngle}°${s.toolLengthComp?` · H ${f(s.toolLengthComp)}`:""}` : "No coordinates"}</span>
      </div>
      {coords("Work",work)}
      {coords("Machine",machine)}
      {coords("Remaining",remaining)}
    </div>
  );
}
