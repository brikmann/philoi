import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';

type FlameIconProps = {
  size?: number;
  /** Square background behind the flame — pass null to render the flame alone (e.g. inline next to text). */
  background?: string | null;
};

export function FlameIcon({ size = 32, background = Colors.plum }: FlameIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="Philoi">
      {background && <Rect x={6} y={6} width={128} height={128} rx={34} fill={background} />}
      <Path d="M70,28 C52,54 49,70 70,86 C91,70 88,54 70,28 Z" fill={Colors.coral} />
      <Path d="M70,46 C59,62 58,76 70,86 C82,76 81,62 70,46 Z" fill={Colors.amber} />
      <Path d="M70,62 C64,72 64,80 70,86 C76,80 76,72 70,62 Z" fill={Colors.ember} />
      <Line x1={48} y1={96} x2={78} y2={84} stroke="#9C6336" strokeWidth={6} strokeLinecap="round" />
      <Line x1={62} y1={84} x2={92} y2={96} stroke="#7E4A2C" strokeWidth={6} strokeLinecap="round" />
      <Circle cx={70} cy={92} r={2} fill={Colors.ember} />
    </Svg>
  );
}
