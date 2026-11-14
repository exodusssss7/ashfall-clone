interface Props {
  kind: string;
  className?: string;
}

const CONTAINER_SPRITE_ALIASES: Record<string, string> = {
  car_police: 'car_trunk',
  car_sedan: 'car_trunk',
  zombie_drop: 'survivor',
};

export function ItemIcon({ kind, className = '' }: Props) {
  const name = CONTAINER_SPRITE_ALIASES[kind] ?? kind;
  return (
    <img
      src={`${import.meta.env.BASE_URL}ui/${name}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`item-icon ${className}`}
    />
  );
}
