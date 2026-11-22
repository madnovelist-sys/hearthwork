// The town's coat of arms, drawn as a little shield.
import type { Arms } from '../sim/types';

const SHIELD = 'M4 4 H56 V30 C56 50 42 60 30 66 C18 60 4 50 4 30 Z';

/** Simple shapes for each charge, centered on (30, 32). */
export function Charge({ kind, color }: { kind: string; color: string }) {
  const s = { fill: color, stroke: 'rgba(0,0,0,0.35)', 'stroke-width': 0.8 } as const;
  switch (kind) {
    case 'flame':
      return <path {...s} d="M30 14 C38 24 40 30 36 38 C35 33 33 31 31 30 C33 36 30 42 26 44 C21 40 20 33 24 26 C24 30 26 32 28 32 C26 26 27 19 30 14 Z" />;
    case 'spiral':
      return <path fill="none" stroke={color} stroke-width={3.2} stroke-linecap="round" d="M30 32 m0 0 a2 2 0 1 1 3 -2 a5 5 0 1 1 -8 4 a8 8 0 1 1 13 -6 a11 11 0 1 1 -16 10" />;
    case 'oak':
      return <g {...s}><rect x={27.5} y={32} width={5} height={14} /><circle cx={30} cy={24} r={9} /><circle cx={22} cy={28} r={6} /><circle cx={38} cy={28} r={6} /></g>;
    case 'pot':
      return <path {...s} d="M24 18 H36 V21 C42 25 43 34 39 40 C36 44 24 44 21 40 C17 34 18 25 24 21 Z" />;
    case 'hammer':
      return <g {...s}><rect x={28} y={24} width={4} height={22} /><rect x={20} y={16} width={20} height={9} rx={1.5} /></g>;
    case 'fish':
      return <path {...s} d="M16 32 C22 22 34 22 40 32 C34 42 22 42 16 32 Z M40 32 L47 25 V39 Z" />;
    case 'wheat':
      return <g {...s}><rect x={29} y={20} width={2} height={26} />{[0, 1, 2, 3].map((i) => <g key={i}><ellipse cx={26.5} cy={19 + i * 5} rx={2.5} ry={4} transform={`rotate(-25 26.5 ${19 + i * 5})`} /><ellipse cx={33.5} cy={19 + i * 5} rx={2.5} ry={4} transform={`rotate(25 33.5 ${19 + i * 5})`} /></g>)}</g>;
    case 'ram':
      return <g {...s}><path d="M24 22 C24 30 26 42 30 44 C34 42 36 30 36 22 Z" /><path fill="none" stroke={color} stroke-width={3.5} d="M24 22 C14 18 14 32 22 30 M36 22 C46 18 46 32 38 30" /></g>;
    case 'axe':
      return <g {...s}><rect x={29} y={16} width={3} height={30} /><path d="M32 18 C42 18 44 28 42 32 C38 30 35 30 32 30 Z" /></g>;
    case 'star':
      return <path {...s} d="M30 14 L34 27 L47 27 L36.5 35 L40.5 48 L30 40 L19.5 48 L23.5 35 L13 27 L26 27 Z" />;
    case 'wave':
    default:
      return <path fill="none" stroke={color} stroke-width={4} stroke-linecap="round" d="M12 28 q6 -6 12 0 t12 0 t12 0 M12 38 q6 -6 12 0 t12 0 t12 0" />;
  }
}

export function ArmsShield({ arms, size = 60 }: { arms: Arms; size?: number }) {
  const id = `clip${size}${arms.field.slice(1)}${arms.charge}`;
  const band = arms.tincture;
  const division = {
    plain: null,
    pale: <rect x={30} y={0} width={30} height={70} fill={band} opacity={0.9} />,
    fess: <rect x={0} y={24} width={60} height={14} fill={band} opacity={0.9} />,
    bend: <path d="M0 0 L14 0 L60 52 L60 66 Z" fill={band} opacity={0.9} />,
    chevron: <path d="M0 58 L30 36 L60 58 L60 68 L30 46 L0 68 Z" fill={band} opacity={0.9} />,
    chief: <rect x={0} y={0} width={60} height={14} fill={band} opacity={0.9} />,
  }[arms.division];
  // On a divided field, the charge takes the field's color where it would vanish into the band.
  const onBand = arms.division === 'fess' || arms.division === 'pale';
  return (
    <svg width={size} height={size * 70 / 60} viewBox="0 0 60 70" role="img" aria-label="Coat of arms">
      <defs><clipPath id={id}><path d={SHIELD} /></clipPath></defs>
      <g clip-path={`url(#${id})`}>
        <rect width={60} height={70} fill={arms.field} />
        {division}
        <Charge kind={arms.charge} color={onBand ? '#F4EEDF' : arms.tincture} />
      </g>
      <path d={SHIELD} fill="none" stroke="#3B2F2A" stroke-width={2} />
    </svg>
  );
}
