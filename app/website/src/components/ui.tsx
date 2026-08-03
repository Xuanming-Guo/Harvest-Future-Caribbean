import type { LucideIcon } from "lucide-react";

import { titleCase } from "@/lib/format";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
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
