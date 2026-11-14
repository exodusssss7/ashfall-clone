import { AIM_ATTACK_THRESHOLD } from '../game/touchAim';
import React, { useEffect, useRef, useState } from 'react';

interface Props {
  testId: string; label: string; size?: number; side: 'left' | 'right'; accentColor: string;
  onChange: (nx: number, ny: number, active: boolean) => void;
}

/** A thumb may start anywhere in its lower-screen zone. The ring follows touchdown,
 * while pointer capture preserves control outside the original hit region. */
export function FloatingStick({testId,label,size=108,side,accentColor,onChange}: Props) {
  const zone = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const origin = useRef({x:0,y:0});
  const callback = useRef(onChange); callback.current = onChange;
  const [visual,setVisual] = useState({x:0,y:0,kx:0,ky:0,active:false});
  const radius = size * .36;
  const reset = () => {
    if (pointer.current === null) return;
    pointer.current = null;
    setVisual(v=>({...v,kx:0,ky:0,active:false}));
    callback.current(0,0,false);
  };
  useEffect(()=>{
    const onHidden=()=>{if(document.hidden)reset();};
    // Multi-touch safety net: when the last finger leaves the screen, or the OS cancels the gesture
    // (3-finger gestures, notification shade), no stick may stay latched.
    const onTouchEnd=(e:TouchEvent)=>{if(e.touches.length===0)reset();};
    window.addEventListener('blur',reset); document.addEventListener('visibilitychange',onHidden);
    window.addEventListener('touchend',onTouchEnd,true); window.addEventListener('touchcancel',reset,true);
    return ()=>{window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',onHidden);
      window.removeEventListener('touchend',onTouchEnd,true);window.removeEventListener('touchcancel',reset,true);callback.current(0,0,false);};
  },[]);
  const update=(x:number,y:number)=>{
    const dx=x-origin.current.x,dy=y-origin.current.y,d=Math.hypot(dx,dy),scale=d>radius?radius/d:1;
    setVisual(v=>({...v,kx:dx*scale,ky:dy*scale}));
    callback.current(dx*scale/radius,dy*scale/radius,true);
  };
  return <div ref={zone} data-testid={`${testId}-zone`} className={`floating-stick-zone floating-stick-${side}`}
    role="application" aria-label={`${label} touch zone`} style={{touchAction:'none'}}
    onPointerDown={e=>{
      // A second finger never steals a live stick, but a stale pointer (its up event was lost) is replaced.
      if(pointer.current!==null){
        let live=false; try{live=e.currentTarget.hasPointerCapture(pointer.current);}catch{live=true;}
        if(live)return; pointer.current=null;
      }
      e.preventDefault();e.stopPropagation();pointer.current=e.pointerId;
      const rect=e.currentTarget.getBoundingClientRect(); origin.current={x:e.clientX,y:e.clientY};
      setVisual({x:e.clientX-rect.left,y:e.clientY-rect.top,kx:0,ky:0,active:true});
      try{e.currentTarget.setPointerCapture(e.pointerId);}catch{/* synthetic test pointer */}
      callback.current(0,0,true);
    }}
    onPointerMove={e=>{if(pointer.current===e.pointerId){e.preventDefault();update(e.clientX,e.clientY);}}}
    onPointerUp={e=>{if(pointer.current===e.pointerId){e.preventDefault();reset();}}}
    onPointerCancel={e=>{if(pointer.current===e.pointerId)reset();}}
    onLostPointerCapture={e=>{if(pointer.current===e.pointerId)reset();}}
  >
    <div data-testid={testId} data-active={visual.active} data-attacking={side==='right' && visual.active && Math.hypot(visual.kx,visual.ky)/radius>=AIM_ATTACK_THRESHOLD} className="floating-stick-ring"
      style={{width:size,height:size,left:visual.active?visual.x:side==='left'?'16.7vw':'calc(100% - 16.7vw)',top:visual.active?visual.y:'calc(100% - 29vh)',transform:'translate(-50%,-50%)'}}>
      <div className="floating-stick-guide"/>
      {side==='right' && <div className="floating-aim-boundary" style={{width:radius*AIM_ATTACK_THRESHOLD*2,height:radius*AIM_ATTACK_THRESHOLD*2}}/>}
      <div className="floating-stick-knob" style={{transform:`translate(${visual.kx}px,${visual.ky}px)`,borderColor:visual.active?accentColor:undefined}}>
        <i style={{background:visual.active?accentColor:undefined}}/>
      </div>
      <span>{side==='right' && visual.active ? Math.hypot(visual.kx,visual.ky)/radius>=AIM_ATTACK_THRESHOLD ? 'AIM + ATTACK' : 'AIM ONLY' : label}</span>
    </div>
  </div>;
}
