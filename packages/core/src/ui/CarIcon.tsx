import Svg, { Path, Rect } from "react-native-svg";
import { CAR_ICONS, carIconKey } from "../carIcons";

interface Props {
  icon: string | null | undefined;
  size?: number;
  color?: string;
  // Degrees clockwise from straight up. The nose points up at zero.
  rotation?: number;
}

// A minimal racecar, seen from above. Single colour, rotates around its centre.
export function CarIcon({ icon, size = 28, color = "#E9EEF8", rotation = 0 }: Props) {
  const shape = CAR_ICONS[carIconKey(icon)];
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" style={{ transform: [{ rotate: `${rotation}deg` }] }}>
      {shape.wheels.map(([x, y, w, h], i) => (
        <Rect key={i} x={x} y={y} width={w} height={h} rx={1.2} fill={color} opacity={0.75} />
      ))}
      <Path d={shape.body} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
