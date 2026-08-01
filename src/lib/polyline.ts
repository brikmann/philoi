// Google's encoded-polyline algorithm — Strava's `map.summary_polyline` is in this format.
// Hand-rolled rather than pulling in a dependency: it's ~30 lines, and this feature is
// deliberately JS-only/OTA-shippable (§17b: "no new native modules, no rebuild"), so adding a
// package that might drag native code along is exactly what we're avoiding.

export type LatLng = { lat: number; lng: number };

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    // Each coordinate is a zig-zag-encoded delta from the previous one, split into 5-bit chunks
    // with the high bit marking "another chunk follows."
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < encoded.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/** Projects a decoded track into an SVG viewBox of `width`×`height`, preserving aspect ratio and
 * centering it — so a long east-west ride doesn't come out stretched into a square. Returns an
 * SVG path `d` string, or null if there's nothing drawable (fewer than two distinct points). */
export function polylineToSvgPath(points: LatLng[], width: number, height: number, padding = 8): string | null {
  if (points.length < 2) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  // A treadmill run or a GPS glitch can land every point on effectively one spot — nothing
  // meaningful to draw, and dividing by the zero span below would produce NaN coordinates.
  if (spanLat === 0 && spanLng === 0) return null;

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  // One shared scale for both axes is what keeps the shape honest; at this latitude-agnostic
  // zoom level (a single activity) skipping a proper Mercator projection is imperceptible.
  const scale = Math.min(spanLng > 0 ? innerWidth / spanLng : Infinity, spanLat > 0 ? innerHeight / spanLat : Infinity);
  const offsetX = padding + (innerWidth - spanLng * scale) / 2;
  const offsetY = padding + (innerHeight - spanLat * scale) / 2;

  return points
    .map((p, i) => {
      const x = offsetX + (p.lng - minLng) * scale;
      // Flipped: SVG y grows downward, latitude grows northward.
      const y = offsetY + (maxLat - p.lat) * scale;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}
