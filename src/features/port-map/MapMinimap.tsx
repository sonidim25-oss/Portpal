export type MapPoint = { id: string; x: number; y: number };
export function MapMinimap({ points, viewport }: { points: MapPoint[]; viewport: { x: number; y: number; width: number; height: number } }) {
  if (!points.length) return <svg className="port-map__minimap" aria-label="Port map minimap" viewBox="0 0 160 100" />;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60, minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + 40;
  const sx = (x: number) => (x - minX) / Math.max(maxX - minX, 1) * 160;
  const sy = (y: number) => (y - minY) / Math.max(maxY - minY, 1) * 100;
  return <svg className="port-map__minimap" aria-label="Port map minimap" viewBox="0 0 160 100">
    {points.map(p => <rect key={p.id} x={sx(p.x) - 5} y={sy(p.y) - 3} width="10" height="6" rx="1" />)}
    <rect className="port-map__minimap-viewport" x={sx(viewport.x)} y={sy(viewport.y)} width={Math.max(8, viewport.width / Math.max(maxX-minX,1)*160)} height={Math.max(8, viewport.height / Math.max(maxY-minY,1)*100)} />
  </svg>;
}
