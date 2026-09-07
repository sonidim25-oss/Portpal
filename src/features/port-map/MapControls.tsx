import type { PortFilter } from "../../app/types";
import { IconButton, SearchInput, SegmentedControl } from "../../components/ui/controls";

export function MapControls({ search, category, zoom, canGroup, grouped, onSearch, onCategory, onGrouped, onZoom, onFit }: {
  search: string; category: PortFilter; zoom: number; canGroup: boolean; grouped: boolean;
  onSearch(value: string): void; onCategory(value: PortFilter): void; onGrouped(value: boolean): void;
  onZoom(delta: number): void; onFit(): void;
}) {
  return <div className="port-map__controls">
    <SegmentedControl ariaLabel="Port category" value={category} onChange={onCategory} options={[
      { value: "all", label: "All" }, { value: "dev", label: "Dev" },
      { value: "system", label: "System" }, { value: "other", label: "Other" },
    ]} />
    <label className="port-map__check"><input type="checkbox" aria-label="Show external" checked disabled />Show external</label>
    <label className="port-map__check"><input type="checkbox" aria-label="Group by project" checked={grouped} disabled={!canGroup} onChange={(e) => onGrouped(e.target.checked)} />Group by project</label>
    <SearchInput label="Search port map" placeholder="Search ports, processes, projects..." value={search} onChange={onSearch} />
    <div className="port-map__zoom" role="group" aria-label="Map zoom">
      <IconButton label="Zoom out" onClick={() => onZoom(-.1)}>−</IconButton>
      <output aria-label="Zoom percentage">{Math.round(zoom * 100)}%</output>
      <IconButton label="Zoom in" onClick={() => onZoom(.1)}>+</IconButton>
      <IconButton label="Fit map to view" onClick={onFit}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg></IconButton>
    </div>
  </div>;
}
