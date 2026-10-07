import { useEffect, useRef, useState, type ReactElement } from "react";
import { ViewAnnotation } from "@maplibre/maplibre-react-native";

interface Props {
  id: string;
  target: { lng: number; lat: number };
  children: ReactElement;
  ms?: number;
}

// A map marker that glides to each new position instead of jumping. Position updates arrive every few seconds, so each
// marker animates on its own and nothing else on the screen re-renders.
export function GlidingAnnotation({ id, target, children, ms = 2600 }: Props) {
  const shown = useRef({ ...target });
  const from = useRef({ ...target });
  const to = useRef({ ...target });
  const t0 = useRef(0);
  const [pos, setPos] = useState<[number, number]>([target.lng, target.lat]);

  useEffect(() => {
    if (Math.abs(to.current.lng - target.lng) + Math.abs(to.current.lat - target.lat) < 1e-9) return;
    from.current = { ...shown.current };
    to.current = { ...target };
    t0.current = Date.now();
  }, [target.lng, target.lat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0.current) / ms);
      if (k >= 1 && shown.current.lng === to.current.lng && shown.current.lat === to.current.lat) return;
      const e = k * (2 - k);
      shown.current = { lng: from.current.lng + (to.current.lng - from.current.lng) * e, lat: from.current.lat + (to.current.lat - from.current.lat) * e };
      setPos([shown.current.lng, shown.current.lat]);
    }, 80);
    return () => clearInterval(timer);
  }, [ms]);

  return (
    <ViewAnnotation id={id} lngLat={pos} anchor="center">
      {children}
    </ViewAnnotation>
  );
}
