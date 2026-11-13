import { ItemIcon } from './ItemIcon';
import { useState, type RefObject } from 'react';
import { Map, X, Navigation } from 'lucide-react';
import type { HudSnapshot } from '../game/types';

const PLACES = [
  { name: 'Crossroads camp', detail: 'Starting campfire · cooking', x: 26.5, y: 27.5, icon: 'meal' },
  { name: 'Lake pier', detail: 'Fishing · north-east of town', x: 40.5, y: 10.5, icon: 'fish' },
  { name: 'Diner', detail: 'Kitchen stove · food supplies', x: 39.5, y: 23.5, icon: 'food' },
  { name: 'Clinic', detail: 'Medical supplies · locked entrance', x: 18.5, y: 23.5, icon: 'bandage' },
  { name: 'Hardware shed', detail: 'Building materials', x: 18.5, y: 33.5, icon: 'wood' },
  { name: 'Police outpost', detail: 'Ammunition · locked entrance', x: 39.5, y: 33.5, icon: 'pistol' },
];
type Place = typeof PLACES[number];
interface Props { hud: HudSnapshot; canvasRef: RefObject<HTMLCanvasElement | null>; onWaypoint: (x: number|null,y: number|null)=>void; }
export function NavigationRadar({hud,canvasRef,onWaypoint}:Props) {
  const [open,setOpen]=useState(false);
  const [selected,setSelected]=useState<Place|null>(null);
  const dx=selected ? selected.x-hud.worldCoords.gx-.5 : 0;
  const dy=selected ? selected.y-hud.worldCoords.gy-.5 : 0;
  const distance=Math.round(Math.hypot(dx,dy));
  // Compass is screen-aligned to the same isometric projection as the game.
  const angle=Math.atan2(dx+dy,dx-dy)*180/Math.PI+90;
  return <>
    <button type="button" aria-label="Open navigation map" data-testid="mobile-map" onClick={()=>setOpen(true)}
      className="fixed left-3 top-[122px] z-10 pointer-events-auto hud-panel p-1 text-left text-[#c7c2b6] w-[88px] shadow-lg">
      <div className="flex justify-between items-center text-[9px] font-telemetry px-0.5 pb-0.5"><span>MAP</span><Map className="w-3 h-3"/></div>
      <canvas ref={canvasRef} width={112} height={112} aria-label="Nearby explored terrain, survivor, loot and infected" className="block pixelated w-[76px] h-[76px]"/>
      {selected ? <div className="text-[9px] font-telemetry text-[#70d9ff] leading-tight mt-1 flex gap-1 items-center"><Navigation className="w-3 h-3 shrink-0" style={{transform:`rotate(${angle-45}deg)`}}/><span>{distance<=2?'ARRIVED':`${distance} tiles`}<br/>{selected.name}</span></div> : <div className="text-[9px] font-telemetry mt-0.5">Tap for places</div>}
    </button>
    {open && <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-3 pointer-events-auto" onPointerDown={ev=>ev.stopPropagation()}>
      <section role="dialog" aria-label="Town navigation" className="hud-panel w-full max-w-lg max-h-[94dvh] flex flex-col">
        <header className="flex justify-between items-center px-4 py-2 border-b border-[#353d3b]"><div><h2 className="font-pixel text-xl">Town navigation</h2><p className="text-[10px] text-[#9aa09c]">Select a destination. Follow the blue marker, travel around walls.</p></div><button type="button" aria-label="Close navigation" className="hud-slot p-2" onClick={()=>setOpen(false)}><X className="w-4 h-4"/></button></header>
        <div className="overflow-y-auto p-3 grid grid-cols-2 gap-2">
          {PLACES.map(place=><button type="button" key={place.name} onClick={()=>{setSelected(place);onWaypoint(place.x,place.y);setOpen(false);}} className={`hud-slot p-2 text-left min-h-[54px] flex gap-2 items-center ${selected?.name===place.name?'border-[#70d9ff]':''}`}><ItemIcon kind={place.icon} className="w-8 h-8"/><div><div className="text-xs font-bold text-[#f0ece1]">{place.name}</div><div className="text-[10px] text-[#9aa09c]">{place.detail}</div></div></button>)}
        </div>
        <footer className="px-4 pb-2 text-[10px] font-telemetry text-[#9aa09c]"><span className="text-[#5ef28f]">Green: YOU</span> · <span className="text-[#e0483e]">Red: INFECTED</span> · Gold: LOOT<br/>Map is north-up (world grid), not screen-up. Unknown terrain stays dark. This menu does not pause.
        {selected&&<button type="button" onClick={()=>{setSelected(null);onWaypoint(null,null);setOpen(false);}} className="block text-[#70d9ff] mt-1 py-1">Clear destination</button>}</footer>
      </section>
    </div>}
  </>;
}
