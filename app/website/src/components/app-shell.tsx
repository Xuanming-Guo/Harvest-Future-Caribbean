"use client";

import {
  Activity,
  BarChart3,
  Boxes,
  Database,
  FlaskConical,
  Leaf,
  Menu,
  Network,
  ShoppingBasket,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useSession } from "./providers";

const navigation = [
  ["/operations", "Operations", Activity],
  ["/marketplace", "Marketplace", ShoppingBasket],
  ["/simulation", "Simulation", Network],
  ["/benchmark", "Benchmark", BarChart3],
  ["/model-lab", "Model Lab", FlaskConical],
  ["/data", "Data", Database],
] as const;

const personas = [
  ["operations-demo", "Operations"],
  ["buyer-hotel", "Hotel buyer"],
  ["farmer-ana", "Farmer Ana"],
  ["farmer-marcus", "Farmer Marcus"],
  ["transporter-daniel", "Transporter"],
  ["coordinator-maya", "Coordinator"],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { actor, ready, switchPersona } = useSession();
  const [open, setOpen] = useState(false);

  return <div className="app-frame">
    <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
      <div className="brand"><span className="brand-mark"><Leaf size={22} /></span><div><strong>Harvest</strong><small>Food coordination</small></div></div>
      <nav aria-label="Main navigation">
        {navigation.map(([href, label, Icon]) => <Link key={href} href={href} className={pathname.startsWith(href) ? "active" : ""} onClick={() => setOpen(false)}><Icon size={19} /><span>{label}</span></Link>)}
      </nav>
      <div className="sidebar-context">
        <p className="eyebrow">Counterfactual demo</p>
        <strong>Saint Lucia · Seed 8675309</strong>
        <span>All scenario records are synthetic and contract-backed.</span>
      </div>
    </aside>
    <div className="main-column">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">{open ? <X /> : <Menu />}</button>
        <div className="environment"><span className="status-dot" /><div><strong>Local Product API</strong><small>PostgreSQL-backed · synthetic data</small></div></div>
        <div className="persona"><Boxes size={17} /><label><span>View as</span><select aria-label="Development persona" disabled={!ready} value={actor?.authSubject ?? "operations-demo"} onChange={(event) => void switchPersona(event.target.value)}>{personas.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      </header>
      <main>{children}</main>
    </div>
  </div>;
}
