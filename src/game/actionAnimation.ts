export type ActionKind = 'heal'|'eat'|'drink'|'craft'|'cook'|'build'|'search'|'door'|'repair'|'refuel'|'reload'|'cast'|'fish'|'reel';
export interface ActionVisual {kind:ActionKind;label:string;duration:number;remaining:number}
export function actionPose(action:ActionVisual) {
 const progress=Math.max(0,Math.min(1,1-action.remaining/action.duration));
 return {progress,pulse:Math.sin(progress*Math.PI*6),lift:Math.sin(progress*Math.PI),step:Math.floor(progress*8)};
}
/** Small original pixel props and articulated hands over the unchanged survivor sprite.
 * Animation illustrates the action; it adds no new item costs or use-time penalties. */
export function drawActionProp(ctx:CanvasRenderingContext2D,a:ActionVisual,right:boolean) {
 const {pulse,lift,step}=actionPose(a),dir=right?1:-1;
 ctx.save();ctx.scale(dir,1);ctx.translate(0,Math.round(pulse));
 const rect=(x:number,y:number,w:number,h:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),w,h);};
 const line=(x:number,y:number,x2:number,y2:number,color:string,width=2)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.stroke();};
 const hands=(x:number,y:number)=>{line(-5,-14,x-3,y,'#48634b',3);line(5,-14,x+3,y,'#526d50',3);rect(x-4,y-1,3,3,'#cfb584');rect(x+2,y-1,3,3,'#cfb584');};
 if(a.kind==='heal'){
  rect(-6,-13,12,9,'#e3dec6');rect(-2,-13,4,9,'#ad4b40');rect(-6,-10,12,3,'#ad4b40');hands(1,-11+Math.round(pulse*2));
  rect(-5+step%4,-11,3,1,'#fff2cc');
 }else if(a.kind==='eat'||a.kind==='drink'){
  const y=-13-Math.round(lift*7);hands(5,y);
  if(a.kind==='drink'){rect(3,y-7,5,9,'#658e9b');rect(4,y-9,3,2,'#dae1bb');rect(4,y-4,3,4,'#b0cfcd');}
  else{rect(1,y-4,8,6,'#8b9861');rect(1,y-5,8,2,'#d7d6ac');rect(3,y-2,4,2,'#d9c895');}
 }else if(a.kind==='cast'||a.kind==='fish'||a.kind==='reel'){
  hands(6,-12);const tipX=a.kind==='cast'?8+Math.round(lift*17):22;const tipY=-30-Math.round(pulse*3);
  line(5,-12,tipX,tipY,'#ac8752');line(tipX,tipY,30,-5,'#cfddd5',1);rect(5,-14,3,3,'#b9c9b5');
  if(a.kind==='reel'){rect(15,-28-Math.round(lift*8),7,3,'#7fa6aa');rect(21,-29-Math.round(lift*8),2,5,'#b7d3c7');}
 }else if(a.kind==='reload'){
  hands(5,-11+Math.round(pulse*3));rect(2,-14,12,4,'#606d6c');rect(6,-9+Math.round(lift*3),3,7,'#b2ad8c');
 }else if(a.kind==='craft'||a.kind==='build'||a.kind==='repair'||a.kind==='cook'){
  const y=-12-Math.round((pulse+1)*3);hands(5,y);rect(-6,-8,13,3,a.kind==='cook'?'#555d58':'#8d744e');
  if(a.kind==='cook'){line(5,y,11,-7,'#c1b67a');rect(-4,-11,8,4,'#596b68');if(step%2===0)rect(0,-19,2,4,'#c7d0b9');}
  else{line(6,y,11,y-8,'#ad8752');rect(7,y-11,9,4,a.kind==='repair'?'#9aaeb0':'#adb3a1');if(pulse<-.5){rect(10,-11,2,2,'#e4c578');rect(14,-15,1,2,'#e4c578');}}
 }else if(a.kind==='refuel'){
  hands(6,-13);rect(1,-17,10,10,'#866d3a');rect(3,-20,5,3,'#bca575');line(11,-17,16,-12,'#bdbb88');
 }else{
  hands(7,-11+Math.round(pulse*2));rect(3,-12,9,3,'#b4a076');
 }
 ctx.restore();
}
