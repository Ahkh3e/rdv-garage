// Smooth movement from sparse updates. Positions arrive every few seconds, so a car is drawn a little behind real time
// and moves at a steady speed between the two updates either side of that moment, instead of leaping to each new one and
// stopping. The cost is a short, constant delay for other members; your own car is not delayed.
export interface Sample {
  t: number;
  lng: number;
  lat: number;
  heading: number;
}

export const RENDER_DELAY_MS = 3400;
export const MAX_SAMPLES = 12;
// A gap this large means the member went quiet; jump instead of sliding across the city.
export const MAX_SLIDE_MS = 15000;

const turn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

export function addSample(samples: Sample[], next: Sample): Sample[] {
  const last = samples[samples.length - 1];
  if (last && Math.abs(last.lng - next.lng) + Math.abs(last.lat - next.lat) < 1e-9 && Math.abs(turn(last.heading, next.heading)) < 0.5) return samples;
  const out = last && next.t - last.t > MAX_SLIDE_MS ? [next] : [...samples, next];
  return out.length > MAX_SAMPLES ? out.slice(out.length - MAX_SAMPLES) : out;
}

export function positionAt(samples: Sample[], t: number): { lng: number; lat: number; heading: number } | null {
  if (samples.length === 0) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (t <= first.t) return { lng: first.lng, lat: first.lat, heading: first.heading };
  if (t >= last.t) return { lng: last.lng, lat: last.lat, heading: last.heading };
  for (let i = 1; i < samples.length; i++) {
    const b = samples[i]!;
    if (t <= b.t) {
      const a = samples[i - 1]!;
      const k = (t - a.t) / (b.t - a.t || 1);
      return { lng: a.lng + (b.lng - a.lng) * k, lat: a.lat + (b.lat - a.lat) * k, heading: (a.heading + turn(a.heading, b.heading) * k + 360) % 360 };
    }
  }
  return { lng: last.lng, lat: last.lat, heading: last.heading };
}
