import React, { useLayoutEffect, useRef, useState } from 'react';
import { X, Hammer, Backpack, Heart, Droplet, Utensils } from 'lucide-react';
import { ItemIcon } from './ItemIcon';
import { CRAFT_RECIPES, ITEMS, WEAPONS } from '../game/recipes';
import { canAffordCost } from '../game/survivalLogic';
import type { ConsumableItemId, HudSnapshot, ItemId } from '../game/types';
interface Props { hud: HudSnapshot; onClose:()=>void; onCraft:(id:string)=>void; onUseConsumable:(id:ConsumableItemId)=>void }
const ORDER: ItemId[]=['wood','scrap','cloth','fuel','food','water','bandage','ammo_9mm','ammo_shell','molotov','raw_fish','cooked_fish','fish_stew','hot_rations'];
const CATEGORIES: Record<string,ItemId[]>={All:ORDER,Provisions:['food','water','raw_fish','cooked_fish','fish_stew','hot_rations'],Medical:['bandage'],Materials:['wood','scrap','cloth','fuel'],Combat:['ammo_9mm','ammo_shell','molotov']};
const DETAILS: Record<ItemId,{kind:string;description:string;effect?:string;action?:string}>={
 wood:{kind:'Material',description:'Salvaged timber for barricades, spike traps and campfires.'},
 scrap:{kind:'Material',description:'Metal salvage for ammunition, defenses and vehicle repairs.'},
 cloth:{kind:'Material',description:'Clean fabric for field bandages, firebombs and campfires.'},
 fuel:{kind:'Material',description:'Gasoline for vehicles, firebombs and ammunition crafting.'},
 food:{kind:'Provision',description:'Ready-to-eat canned supplies.',effect:'+38 Food  /  +8 HP',action:'EAT RATIONS'},
 water:{kind:'Provision',description:'Purified drinking water.',effect:'+44 H2O',action:'DRINK WATER'},
 bandage:{kind:'Medical',description:'Dress a wound and stop bleeding.',effect:'+35 HP  /  Stops bleeding',action:'APPLY BANDAGE'},
 ammo_9mm:{kind:'Ammunition',description:'Reserve ammunition for the 9mm pistol. Reload with RLD.'},
 ammo_shell:{kind:'Ammunition',description:'Reserve 12-gauge shells for the pump shotgun. Reload with RLD.'},
 molotov:{kind:'Throwable',description:'A firebomb. Equip it from the weapon bar, then aim and throw.'},
 raw_fish:{kind:'Raw provision',description:'Best cooked near a stove or campfire. Eating raw fish reduces hydration.',effect:'+16 Food  /  -5 H2O',action:'EAT RAW FISH'},
 cooked_fish:{kind:'Provision',description:'Grilled lake fish, ready to eat.',effect:'+42 Food  /  +14 HP',action:'EAT GRILLED FISH'},
 fish_stew:{kind:'Provision',description:'A hearty fish stew for long nights.',effect:'+58 Food  /  +40 H2O  /  +24 HP',action:'EAT FISH STEW'},
 hot_rations:{kind:'Provision',description:'A warming meal for a tired survivor.',effect:'+48 Food  /  +12 HP',action:'EAT HOT MEAL'},
};
export function CraftModal({hud,onClose,onCraft,onUseConsumable}: Props) {
 const storageRef=useRef<HTMLElement>(null);
 const detailRef=useRef<HTMLDivElement>(null);
 const [tab,setTab]=useState<'pack'|'craft'>('pack');
 const [category,setCategory]=useState('All');
 const [selected,setSelected]=useState<ItemId>('food');
 const [recipeId,setRecipeId]=useState(CRAFT_RECIPES[0].id);
 const item=ITEMS[selected],detail=DETAILS[selected],recipe=CRAFT_RECIPES.find(r=>r.id===recipeId)!;
 useLayoutEffect(()=>{if(storageRef.current)storageRef.current.scrollTop=0;},[tab,category]);
 useLayoutEffect(()=>{if(detailRef.current)detailRef.current.scrollTop=0;},[tab,selected,recipeId]);
 const stock=ORDER.filter(id=>hud.inventory[id]>0).length;
 const chooseCategory=(value:string)=>{setCategory(value);if(!CATEGORIES[value].includes(selected))setSelected(CATEGORIES[value][0]);};
 return <div className="pack-backdrop fixed inset-0 z-30 flex items-center justify-center bg-black/65">
  <div role="dialog" aria-label="Backpack and Crafting Workbench" className="pack-dialog hud-panel">
   <header className="pack-header">
    <div className="pack-heading"><Backpack/><div><h2>FIELD PACK</h2><p>DAY {hud.day} / {hud.timeLabel} / {stock} stocked item types</p></div></div>
    <div className="pack-tabs" role="tablist" aria-label="Backpack sections">
     <button role="tab" aria-selected={tab==='pack'} onClick={()=>setTab('pack')}><Backpack/>ITEMS</button>
     <button role="tab" aria-selected={tab==='craft'} onClick={()=>setTab('craft')}><Hammer/>CRAFT</button>
    </div>
    <button type="button" className="pack-close" aria-label="Close Backpack" onClick={onClose}><X/></button>
   </header>
   <div className="pack-body">
    <aside className="pack-survivor">
     <div className="pack-survivor-title">SURVIVOR</div>
     <img className="pack-portrait" src={`${import.meta.env.BASE_URL}ui/survivor.svg`} alt="Pixel-art survivor"/>
     <div className="pack-vital"><Heart/><span>HEALTH</span><b>{Math.round(hud.hp)}</b><i style={{width:`${hud.hp}%`}}/></div>
     <div className="pack-vital"><Utensils/><span>FOOD</span><b>{Math.round(hud.hunger)}</b><i style={{width:`${hud.hunger}%`}}/></div>
     <div className="pack-vital"><Droplet/><span>H2O</span><b>{Math.round(hud.thirst)}</b><i style={{width:`${hud.thirst}%`}}/></div>
     <div className="pack-equipped"><span>IN HAND</span><ItemIcon kind={hud.equippedWeapon}/><strong>{WEAPONS[hud.equippedWeapon].name}</strong></div>
    </aside>
    {tab==='pack' ? <>
     <section ref={storageRef} key="items" className="pack-storage" aria-label="Carried items">
      <nav className="pack-filters" aria-label="Item categories">{Object.keys(CATEGORIES).map(c=><button key={c} aria-pressed={category===c} onClick={()=>chooseCategory(c)}>{c}</button>)}</nav>
      <div className="pack-slot-grid">
       {CATEGORIES[category].map(id=><button type="button" key={id} data-item={id} className={`pack-item-slot ${selected===id?'is-selected':''} ${hud.inventory[id]===0?'is-empty':''}`} aria-label={`${ITEMS[id].name}, ${hud.inventory[id]} carried`} aria-pressed={selected===id} onClick={()=>setSelected(id)}>
        <ItemIcon kind={id}/><span className="pack-slot-name">{ITEMS[id].short}</span><b className="pack-slot-count">{hud.inventory[id]}</b>
       </button>)}
      </div>
      <div className="pack-grid-note">Tap an item to inspect it. Counts show carried reserves.</div>
     </section>
     <aside className="pack-details" aria-label="Selected item"><div ref={detailRef} className="pack-detail-content">
      <div className="pack-detail-kind">{detail.kind}</div>
      <div className="pack-detail-art"><ItemIcon kind={selected}/></div>
      <h3>{item.name}</h3><div className="pack-owned">CARRIED <b>{hud.inventory[selected]}</b></div>
      <p>{detail.description}</p>{detail.effect&&<div className="pack-effect">{detail.effect}</div>}
      </div><div className="pack-detail-action">{detail.action ? <button className="pack-primary" disabled={hud.inventory[selected]<=0} onClick={()=>onUseConsumable(selected as ConsumableItemId)}>{detail.action}</button> : <div className="pack-passive">{selected==='molotov'?'Equip from the weapon bar':'Used by existing crafting or action controls'}</div>}</div>
     </aside>
    </> : <>
     <section ref={storageRef} key="workbench" className="pack-storage pack-workbench" aria-label="Crafting recipes">
      <div className="pack-section-heading"><div><strong>WORKBENCH</strong><span>Medical supplies, munitions &amp; defenses</span></div><b>{CRAFT_RECIPES.filter(r=>canAffordCost(hud.inventory,r.cost)).length} READY</b></div>
      <div className="pack-recipe-list">
      {CRAFT_RECIPES.map(r=><button key={r.id} aria-pressed={r.id===recipe.id} className={`pack-recipe ${r.id===recipe.id?'is-selected':''}`} onClick={()=>setRecipeId(r.id)}>
       <ItemIcon kind={r.outputItem??r.outputStructure??'build'}/><span><strong>{r.name}</strong><small>{r.category==='structure'?'DEFENSE':r.category.toUpperCase()}</small></span><i className={canAffordCost(hud.inventory,r.cost)?'ready':'needs'}>{canAffordCost(hud.inventory,r.cost)?'READY':'NEED ITEMS'}</i>
      </button>)}
      </div>
      <div className="pack-grid-note">Choose a blueprint. Required materials are shown on the right.</div>
     </section>
     <aside className="pack-details" aria-label="Selected recipe"><div ref={detailRef} className="pack-detail-content">
      <div className="pack-detail-kind">WORKBENCH / {recipe.category}</div><div className="pack-detail-art"><ItemIcon kind={recipe.outputItem??recipe.outputStructure??'build'}/></div>
      <h3>{recipe.name}</h3><p>{recipe.description}</p>
      <div className="pack-cost-label">MATERIALS / CARRIED : NEEDED</div><div className="pack-costs">{Object.entries(recipe.cost).map(([id,n])=><div key={id} className={hud.inventory[id as ItemId]>=n?'has-cost':'missing-cost'}><ItemIcon kind={id}/><span>{ITEMS[id as ItemId].short}</span><b>{hud.inventory[id as ItemId]} / {n}</b></div>)}</div>
      </div><div className="pack-detail-action"><button className="pack-primary" disabled={!canAffordCost(hud.inventory,recipe.cost)} onClick={()=>onCraft(recipe.id)}>{recipe.outputStructure?'PLACE IN WORLD':`CRAFT${recipe.outputAmount ? ` x${recipe.outputAmount}` : ''}`}</button></div>
     </aside>
    </>}
   </div>
   <footer className="pack-footer"><span>{tab==='pack'?'BACKPACK / TAP TO INSPECT':'WORKBENCH / SELECT A BLUEPRINT'}</span><span>Scroll panels for more <b>↓</b></span></footer>
  </div>
 </div>;
}
