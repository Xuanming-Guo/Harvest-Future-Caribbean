"use client";

import type { ApiSchema } from "@harvest/shared";
import { BookOpen, CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { useId, useState } from "react";

import { Badge, Card, SectionTitle } from "@/components/ui";
import { formatDate, titleCase } from "@/lib/format";

export function CropStandardCard({ standard }: { standard: ApiSchema<"CropStandard"> }) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const guidanceId = useId();

  return (
    <Card className="crop-standard-card">
      <SectionTitle title="What buyers expect" detail={`${standard.publisherName} v${standard.version}`} />
      <div className="crop-standard-meta">
        <Badge>{standard.status}</Badge>
        <Badge tone="amber">Reference material</Badge>
        <span>{standard.geography}</span>
        <span>Reviewed {formatDate(standard.reviewedAt, false)}</span>
      </div>
      <a className="text-link crop-standard-source" href={standard.source.url} target="_blank" rel="noreferrer">
        {standard.source.title}<ExternalLink size={14} />
      </a>
      <ul className="crop-standard-checklist">
        {standard.checklist.map((item) => (
          <li key={item.key}>
            <CheckCircle2 size={18} />
            <span><strong>{titleCase(item.key)}</strong><small>{item.requirement}</small></span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="crop-standard-toggle"
        aria-expanded={guidanceOpen}
        aria-controls={guidanceId}
        onClick={() => setGuidanceOpen((open) => !open)}
      >
        <BookOpen size={18} />
        <span>Growing and harvest guidance</span>
        <ChevronDown className={guidanceOpen ? "open" : ""} size={18} />
      </button>
      <div className="crop-standard-guidance" id={guidanceId} hidden={!guidanceOpen}>
        {standard.guidance.map((item) => (
          <article key={item.topic}>
            <strong>{titleCase(item.topic)}</strong>
            <p>{item.text}</p>
            <a className="text-link" href={item.source.url} target="_blank" rel="noreferrer">
              {item.source.title}<ExternalLink size={13} />
            </a>
          </article>
        ))}
      </div>
    </Card>
  );
}
