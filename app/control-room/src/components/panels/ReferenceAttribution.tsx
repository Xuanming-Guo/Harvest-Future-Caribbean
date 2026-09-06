"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { MaritimeAttribution, ReferenceDataSource } from "@harvest/simulation";

/**
 * Source and licence lines for the public reference data on the globe.
 *
 * Collapsed to a single line by default. The full paragraph is four or five
 * lines of publishers, licences and retrieval dates, and it sits over the
 * bottom of the globe — which is the part of the scene someone is watching
 * while a sailing or a delivery plays. Collapsing is not removing: ODbL
 * requires the OpenStreetMap credit wherever the data is drawn, so the credit
 * itself is never behind the toggle, only the apparatus around it. The panel
 * drops nothing, and the synthetic-outcomes caveat is one click away.
 *
 * Two groups, kept apart rather than merged: the places snapshot is
 * OpenStreetMap under ODbL, while the ports, ferry links and exchange rates
 * come from ferry operators, port authorities and central banks under their own
 * terms. Running them together would attribute one publisher's data to another,
 * and the maritime licences are not open-data licences at all.
 */

/** Rotates a quarter turn when the panel is open, so the glyph is never stale. */
function Caret(): React.JSX.Element {
  return (
    <svg className="reference-attribution-caret" viewBox="0 0 8 8" aria-hidden="true">
      <path d="M2 0.5 6.5 4 2 7.5Z" />
    </svg>
  );
}

export default function ReferenceAttribution({
  sources,
  maritime = [],
  maritimeNote,
  recordedWeather = false,
}: {
  sources: ReferenceDataSource[];
  maritime?: MaritimeAttribution[];
  maritimeNote?: string;
  /**
   * True when this run's realised weather includes recorded `PUBLIC_REFERENCE`
   * days. Named on the collapsed line because a viewer reading a storm off the
   * globe should be able to tell a recorded day from a generated one without
   * opening anything.
   */
  recordedWeather?: boolean;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Escape and an outside click both close it, matching the island-scope menus.
  // Escape returns focus to the toggle; a keyboard user who opened the panel
  // would otherwise be left on a control that no longer exists on screen.
  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExpanded(false);
      toggle.current?.focus();
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  if (!sources.length && !maritime.length) return null;

  // Which datasets are in the scene, in words. No URLs, no dates, no licence
  // names: those are the panel's job, and repeating them here would rebuild the
  // paragraph this line exists to replace. Deduplicated because two snapshots
  // of the same publisher carry one credit, not two.
  const datasets = [
    ...new Set(sources.map((source) => source.attribution)),
    ...(recordedWeather ? ["recorded weather"] : []),
    ...(maritime.length > 0 ? ["ferry & FX references"] : []),
  ];

  return (
    <aside className="reference-attribution" aria-label="Reference place attribution" ref={root}>
      {/*
        * Kept mounted and hidden rather than unmounted, so `aria-controls`
        * always resolves to a real element. `hidden` keeps it out of the
        * accessibility tree while collapsed, which is the honest state.
        */}
      <div className="reference-attribution-panel" id={panelId} hidden={!expanded}>
        {sources.length > 0 && (
          <p className="reference-attribution-group">
            Place references: {sources.map((source, index) => (
              <span key={source.sourceId}>
                {index > 0 && " · "}
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.attribution}</a>
                {" · "}
                <a href={source.licenceUrl} target="_blank" rel="noreferrer">{source.licenceName}</a>
              </span>
            ))}
          </p>
        )}
        {maritime.length > 0 && (
          <p className="reference-attribution-group">
            Ports, sailings and rates: {maritime.map((attribution, index) => (
              <span key={`${attribution.publisher}-${attribution.retrievedAt}`}>
                {index > 0 && " · "}
                <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">{attribution.publisher}</a>
                {` · ${attribution.licence} · retrieved ${attribution.retrievedAt}`}
              </span>
            ))}
            {maritimeNote && <span className="reference-attribution-note"> {maritimeNote}</span>}
          </p>
        )}
        {recordedWeather && (
          <p className="reference-attribution-group">
            Recorded weather: days labelled PUBLIC_REFERENCE are read from a committed reference
            dataset on disk, never a live service. The orders, deliveries and outcomes around them
            stay synthetic.
          </p>
        )}
      </div>
      <p className="reference-attribution-summary">
        <span>{datasets.join(" · ")}</span>
        {" · "}
        <button
          type="button"
          className="reference-attribution-toggle"
          aria-expanded={expanded}
          aria-controls={panelId}
          ref={toggle}
          onClick={() => setExpanded((open) => !open)}
        >
          Sources<Caret />
        </button>
      </p>
    </aside>
  );
}
