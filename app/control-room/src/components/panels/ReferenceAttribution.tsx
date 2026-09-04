import type { MaritimeAttribution, ReferenceDataSource } from "@harvest/simulation";

/**
 * Source and licence lines for the public reference data on the globe.
 *
 * Two groups, kept apart rather than merged: the places snapshot is
 * OpenStreetMap under ODbL, while the ports, ferry links and exchange rates
 * come from ferry operators, port authorities and central banks under their own
 * terms. Running them together would attribute one publisher's data to another,
 * and the maritime licences are not open-data licences at all.
 */
export default function ReferenceAttribution({
  sources,
  maritime = [],
  maritimeNote,
}: {
  sources: ReferenceDataSource[];
  maritime?: MaritimeAttribution[];
  maritimeNote?: string;
}): React.JSX.Element | null {
  if (!sources.length && !maritime.length) return null;
  return (
    <aside className="reference-attribution" aria-label="Reference place attribution">
      {sources.length > 0 && (
        <>
          Place references: {sources.map((source, index) => (
            <span key={source.sourceId}>
              {index > 0 && " · "}
              <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.attribution}</a>
              {" · "}
              <a href={source.licenceUrl} target="_blank" rel="noreferrer">{source.licenceName}</a>
            </span>
          ))}
        </>
      )}
      {maritime.length > 0 && (
        <>
          {sources.length > 0 && <br />}
          Ports, sailings and rates: {maritime.map((attribution, index) => (
            <span key={`${attribution.publisher}-${attribution.retrievedAt}`}>
              {index > 0 && " · "}
              <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">{attribution.publisher}</a>
              {` · ${attribution.licence} · retrieved ${attribution.retrievedAt}`}
            </span>
          ))}
          {maritimeNote && <span className="reference-attribution-note"> {maritimeNote}</span>}
        </>
      )}
    </aside>
  );
}
