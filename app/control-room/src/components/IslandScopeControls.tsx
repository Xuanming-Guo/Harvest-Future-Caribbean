"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface IslandOption {
  islandId: string;
  name: string;
}

interface IslandScopeControlsProps {
  islands: IslandOption[];
  mode: "SELECTED" | "ALL";
  selectedIslandIds: string[];
  onModeChange: (mode: "SELECTED" | "ALL") => void;
  onSelectedIslandIdsChange: (islandIds: string[]) => void;
}

function Chevron() {
  return <svg className="custom-menu-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>;
}

function Checkmark() {
  return <svg className="custom-menu-checkmark" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 2.7 2.7 6.3-6.3" /></svg>;
}

/**
 * Purpose-built menu controls keep the launch toolbar compact when the
 * regional catalogue grows. The popovers are buttons and listboxes rather
 * than native selects, so their visual chrome remains part of Harvest.
 */
export default function IslandScopeControls({ islands, mode, selectedIslandIds, onModeChange, onSelectedIslandIdsChange }: IslandScopeControlsProps) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [islandsOpen, setIslandsOpen] = useState(false);
  const scopeRoot = useRef<HTMLDivElement>(null);
  const islandsRoot = useRef<HTMLDivElement>(null);
  const scopeListId = useId();
  const islandsListId = useId();

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!scopeRoot.current?.contains(event.target as Node)) setScopeOpen(false);
      if (!islandsRoot.current?.contains(event.target as Node)) setIslandsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScopeOpen(false);
        setIslandsOpen(false);
      }
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const selectedCount = selectedIslandIds.length;

  return <>
    <div className="custom-menu" ref={scopeRoot}>
      <span className="custom-menu-label">Island scope</span>
      <button type="button" className="custom-menu-trigger" aria-haspopup="listbox" aria-controls={scopeListId} aria-expanded={scopeOpen} onClick={() => setScopeOpen((open) => !open)}>
        {mode === "ALL" ? "Whole Caribbean" : "Selected islands"}<Chevron />
      </button>
      {scopeOpen && <div id={scopeListId} className="custom-menu-popover" role="listbox" aria-label="Island scope">
        <button type="button" role="option" aria-selected={mode === "SELECTED"} className={mode === "SELECTED" ? "custom-menu-option is-selected" : "custom-menu-option"} onClick={() => { onModeChange("SELECTED"); setScopeOpen(false); }}><span>Selected islands</span>{mode === "SELECTED" && <Checkmark />}</button>
        <button type="button" role="option" aria-selected={mode === "ALL"} className={mode === "ALL" ? "custom-menu-option is-selected" : "custom-menu-option"} onClick={() => { onModeChange("ALL"); setScopeOpen(false); }}><span>Whole Caribbean</span>{mode === "ALL" && <Checkmark />}</button>
      </div>}
    </div>
    {mode === "SELECTED" && <div className="custom-menu island-menu" ref={islandsRoot}>
      <span className="custom-menu-label">Islands</span>
      <button type="button" className="custom-menu-trigger" aria-haspopup="listbox" aria-controls={islandsListId} aria-expanded={islandsOpen} onClick={() => setIslandsOpen((open) => !open)}>
        {selectedCount === 1 ? islands.find((island) => island.islandId === selectedIslandIds[0])?.name ?? "Select islands" : `${selectedCount} islands selected`}<Chevron />
      </button>
      {islandsOpen && <div id={islandsListId} className="custom-menu-popover custom-menu-popover-scroll" role="listbox" aria-label="Islands" aria-multiselectable="true">
        {islands.map((island) => {
          const selected = selectedIslandIds.includes(island.islandId);
          const onlySelection = selected && selectedCount === 1;
          return <button key={island.islandId} type="button" role="option" aria-selected={selected} className={selected ? "custom-menu-option is-selected" : "custom-menu-option"} onClick={() => {
            if (onlySelection) return;
            onSelectedIslandIdsChange(selected ? selectedIslandIds.filter((id) => id !== island.islandId) : [...selectedIslandIds, island.islandId]);
          }}><span>{island.name}</span>{selected && <Checkmark />}</button>;
        })}
      </div>}
    </div>}
  </>;
}
