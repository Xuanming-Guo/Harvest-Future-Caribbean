import type { ReferenceDataSource } from "@harvest/simulation";

export default function ReferenceAttribution({ sources }: { sources: ReferenceDataSource[] }): React.JSX.Element | null {
  if (!sources.length) return null;
  return (
    <aside className="reference-attribution" aria-label="Reference place attribution">
      Place references: {sources.map((source, index) => (
        <span key={source.sourceId}>
          {index > 0 && " · "}
          <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.attribution}</a>
          {" · "}
          <a href={source.licenceUrl} target="_blank" rel="noreferrer">{source.licenceName}</a>
        </span>
      ))}
    </aside>
  );
}
