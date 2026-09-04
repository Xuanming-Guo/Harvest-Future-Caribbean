"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { titleCase } from "@/lib/format";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function Card({ children, className = "", ...props }: React.ComponentPropsWithoutRef<"section">) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <div className="section-title"><h2>{title}</h2>{detail && <span>{detail}</span>}</div>;
}

export function Metric({ label, value, detail, icon: Icon, tone = "green" }: { label: string; value: React.ReactNode; detail?: string; icon?: LucideIcon; tone?: string }) {
  return <Card className="metric"><div className={`metric-icon tone-${tone}`}>{Icon && <Icon size={19} />}</div><div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div></Card>;
}

export function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const inferred = typeof children === "string" ? children.toLowerCase().replaceAll("_", "-") : "neutral";
  return <span className={`badge badge-${tone ?? inferred}`}>{typeof children === "string" ? titleCase(children) : children}</span>;
}

export function LoadingState({ label = "Loading your Harvest workspace..." }: { label?: string }) {
  return <div className="state-panel"><span className="spinner" />{label}</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  return <div className="state-panel error"><strong>We could not load this page.</strong><span>{error instanceof Error ? error.message : "Harvest is temporarily unavailable."}</span></div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{detail}</span></div>;
}

/**
 * One collapsible workspace section. Built from a plain button rather than
 * `details`/`summary` so the closed row can carry its own outcome (a count, a
 * badge) in the Harvest visual language instead of native disclosure chrome.
 *
 * `defaultOpen` can turn true after the first render, which is how a section
 * opens itself once it becomes the recommended one. It never closes a section
 * the reader opened.
 */
export function Disclosure({
  id,
  title,
  summary,
  icon: Icon,
  primary = false,
  defaultOpen = false,
  children,
  ...rest
}: {
  id: string;
  title: string;
  summary: string;
  icon?: LucideIcon;
  primary?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
  /** Lets a caller hang a tutorial or action-preview hook on the whole section. */
} & Omit<React.ComponentPropsWithoutRef<"section">, "id" | "title" | "children">) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  return (
    <section className={`workspace-section${primary ? " workspace-section-primary" : ""}`} id={id} {...rest}>
      <h2 className="workspace-section-heading">
        <button
          type="button"
          id={`${id}-summary`}
          className="disclosure-summary"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="disclosure-step">{Icon && <Icon size={21} aria-hidden="true" />}</span>
          <span>
            <span className="disclosure-title">{title}</span>
            <span className="disclosure-detail">{summary}</span>
          </span>
          <ChevronDown className="disclosure-chevron" size={20} aria-hidden="true" />
        </button>
      </h2>
      <div id={`${id}-panel`} className="disclosure-panel" role="region" aria-labelledby={`${id}-summary`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Second-level disclosure for detail a first-time farmer does not need first. */
export function MoreDetail({ id, label = "More detail", children }: { id: string; label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="more-detail">
      <button
        type="button"
        className="more-detail-toggle"
        aria-expanded={open}
        aria-controls={`${id}-detail`}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide detail" : label}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <div id={`${id}-detail`} className="more-detail-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
