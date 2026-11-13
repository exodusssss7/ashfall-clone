interface Props { kind: string; className?: string }
export function ItemIcon({kind,className=''}:Props) {
 const name=kind==='raw_fish'||kind==='cooked_fish'?'fish':kind==='fish_stew'||kind==='hot_rations'?'meal':kind;
 return <img src={`${import.meta.env.BASE_URL}ui/${name}.svg`} alt="" aria-hidden="true" draggable={false} className={`item-icon ${className}`}/>;
}
