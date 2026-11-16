const colors = new Set(["rose", "blue", "ink"]);

/** Both drawing activities store bounded, normalized points and colors instead of rendered image data. */
export function readPlayDrawing(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 16) return null;
  let points = 0;
  for (const stroke of raw) {
    if (!colors.has(stroke?.color) || !Array.isArray(stroke.points) || !stroke.points.length) return null;
    points += stroke.points.length;
    if (points > 480 || stroke.points.some((point) => !Array.isArray(point) || point.length !== 2 ||
      point.some((value) => !Number.isInteger(value) || value < 0 || value > 255))) return null;
  }
  return raw.map(({ color, points }) => ({ color, points }));
}
