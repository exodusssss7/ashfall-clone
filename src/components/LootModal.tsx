import { useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, Backpack, PackageOpen, X } from 'lucide-react';
import { ItemIcon } from './ItemIcon';
import { ITEMS } from '../game/recipes';
import { extractLootEntries } from '../game/lootUi';
import type { ActiveLootContainer, Inventory, ItemId, LootContainerEntry } from '../game/types';
type Side = 'player'|'chest';
interface Props {
 container: ActiveLootContainer; inventory: Inventory;
 onTakeItem: (item: ItemId) => void; onDepositItem: (item: ItemId) => void;
 onTakeAll: () => void; onClose: () => void;
}
export function LootModal({container, inventory, onTakeItem, onDepositItem, onTakeAll, onClose}: Props) {
 const own = extractLootEntries(inventory);
 const [drag, setDrag] = useState<{item:ItemId;x:number;y:number}|null>(null);
 const pointer = useRef<{item:ItemId;side:Side;x:number;y:number;moved:boolean}|null>(null);
 const suppressClick = useRef<{item:ItemId;until:number}|null>(null);
 const transfer=(item:ItemId,side:Side)=>side==='chest'?onTakeItem(item):onDepositItem(item);
 function slots(entries:LootContainerEntry[], side:Side) {return <div className="ledger-items ledger-slot-grid">{entries.map(entry=><button key={entry.item} className="inventory-box" aria-label={`${side==='chest'?'Take':'Store'} ${entry.qty} ${ITEMS[entry.item].name}`} title={`${ITEMS[entry.item].name} - tap or drag to ${side==='chest'?'pack':'chest'}`}
   data-loot-item={side==='chest'?entry.item:undefined} data-own-item={side==='player'?entry.item:undefined}
   onPointerDown={e=>{pointer.current={item:entry.item,side,x:e.clientX,y:e.clientY,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
   onPointerMove={e=>{const p=pointer.current;if(!p)return;if(Math.hypot(e.clientX-p.x,e.clientY-p.y)>7){p.moved=true;setDrag({item:p.item,x:e.clientX,y:e.clientY});}}}
   onPointerUp={e=>{const p=pointer.current;if(p?.moved){suppressClick.current={item:p.item,until:performance.now()+400};const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-loot-side]');if(target&&target.getAttribute('data-loot-side')!==p.side)transfer(p.item,p.side);}pointer.current=null;setDrag(null);}}
   onPointerCancel={()=>{pointer.current=null;setDrag(null);}}
   onClick={()=>{if(suppressClick.current?.item===entry.item&&performance.now()<suppressClick.current.until){suppressClick.current=null;return;}suppressClick.current=null;transfer(entry.item,side);}}>
    <ItemIcon kind={entry.item}/><span className="box-label">{ITEMS[entry.item].short}</span><b>{entry.qty}</b>
  </button>)}{Array.from({length:Math.max(4,20-entries.length)},(_,i)=><div className="inventory-box empty-box" key={'empty'+i} aria-hidden="true"><span>+</span></div>)}</div>;}
 return <div className="ledger-scrim">
  <section role="dialog" aria-modal="true" aria-label={container.title} data-testid="loot-modal" className="loot-ledger">
   <header className="ledger-masthead"><div className="journal-brand">A<span>/</span>F</div><div><p>SURVIVOR'S FIELD JOURNAL</p><h1>Salvage & supplies</h1></div><span className="ledger-edition">INVENTORY RECORD<br/>VOL. 01 / ASHFALL</span><button className="paper-close" aria-label="Close Container" onClick={onClose}><X size={19}/></button></header>
   <div className="ledger-spread">
    <section className="ledger-page player-page" data-loot-side="player">
     <div className="page-kicker"><span>01 / PERSONAL EFFECTS</span><Backpack size={17}/></div>
     <h2>Your inventory</h2><p className="page-description">Tap an item to store it in the chest.</p>
     <div className="ledger-columns"><span>CARRIED SUPPLIES</span><span>DRAG TO STORE →</span></div>
     {slots(own,'player')}
     <div className="page-footnote"><span>{own.length} types · scroll for more</span><span>01</span></div>
    </section>
    <div className="ledger-binding"><span/><span/><span/></div>
    <section className="ledger-page chest-page" data-loot-side="chest">
     <div className="page-kicker"><span>02 / FOUND IN THE FIELD</span><PackageOpen size={17}/></div>
     <h2>{container.kind.includes('car_')?'Vehicle trunk':container.kind==='fridge'?'Refrigerator':container.kind==='med_cabinet'?'Medical cabinet':container.kind==='crate_military'?'Military case':'Supply crate'}</h2><p className="page-description">Tap an item to move it to your pack.</p>
     <div className="ledger-columns"><span>← DRAG TO TAKE</span><span>STORED SUPPLIES</span></div>
     {slots(container.entries,'chest')}
     <div className="page-footnote"><span>{container.entries.length} types · no storage limit</span><span>02</span></div>
    </section>
   </div>
   <footer className="ledger-footer"><div><ArrowLeftRight size={17}/><span>Drag items between pages.<br/><b>Or tap to move a full stack.</b></span></div><div className="ledger-footer-actions"><button className="paper-button secondary" onClick={onClose}>Close <kbd>ESC</kbd></button><button data-testid="loot-take-all" className="paper-button primary" disabled={!container.entries.length} onClick={onTakeAll}><ArrowLeft size={15}/> Take all <kbd>E</kbd></button></div></footer>
  </section>
  {drag&&<div className="ledger-drag-ghost" style={{left:drag.x,top:drag.y}}><ItemIcon kind={drag.item}/></div>}
 </div>;
}
