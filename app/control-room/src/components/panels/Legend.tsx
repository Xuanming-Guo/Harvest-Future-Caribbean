"use client";

/**
 * The crop-stage colour ramp and marker vocabulary used across the globe and
 * the panels. Renders only its inner content — `page.tsx` supplies the
 * surrounding panel chrome (see the "Map key" section), which also hosts the
 * "view island" button that belongs to the page, not this component.
 *
 * Colours are read off `globals.css`'s status ramp rather than hard-coded
 * here a second time; the `status-*` classes are the single source of truth,
 * so a palette change there does not require finding this file too.
 */

const ENTRIES: Array<{ className: string; label: string }> = [
  { className: "status-growing", label: "Growing" },
  { className: "status-maturing", label: "Maturing" },
  { className: "status-ready", label: "Ready to harvest" },
  { className: "status-harvested", label: "Harvested" },
  { className: "status-spoiled", label: "Spoiled" },
  { className: "status-delayed", label: "Delayed" },
];

export default function Legend(): React.JSX.Element {
  return (
    <ul className="legend" style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {ENTRIES.map((entry) => (
        <li className="legend-item" key={entry.className}>
          <span className={`status-dot ${entry.className}`} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
