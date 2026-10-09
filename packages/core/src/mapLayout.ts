import { useSafeAreaInsets } from "react-native-safe-area-context";

export const MAP_ROW = 44;
export const MAP_GAP = 8;
export const MAP_PILL = 32;
export const MAP_SIDE = 16;

export function mapTops(insetTop: number) {
  const search = Math.max(insetTop, 20) + MAP_GAP;
  const pill = search + MAP_ROW + MAP_GAP;
  const below = pill + MAP_PILL + MAP_GAP;
  return { search, pill, below };
}

export const useMapTops = () => mapTops(useSafeAreaInsets().top);
