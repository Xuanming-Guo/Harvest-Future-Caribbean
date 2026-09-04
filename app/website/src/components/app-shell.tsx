"use client";

import {
  ClipboardCheck,
  Compass,
  LayoutGrid,
  Leaf,
  LogOut,
  Map as MapIcon,
  Menu,
  PackageCheck,
  ShoppingBasket,
  Sprout,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { withPreviewFlag } from "@/lib/action-preview";
import { roleHome, type ProductRole } from "@/lib/api";
import { ActionPreviewController } from "./action-preview";
import { ConnectionStatus } from "./offline";
import { OnboardingGuide } from "./onboarding-guide";
import { useSession } from "./providers";

const navigation = {
  FARMER: [
    ["/farmer", "My farm", Sprout],
    ["/map", "Map", MapIcon],
    ["/farmer/farm", "Farm map", LayoutGrid],
    ["/orders", "Orders", PackageCheck],
  ],
  BUYER: [
    ["/buyer", "Overview", Leaf],
    ["/map", "Map", MapIcon],
    ["/marketplace", "Marketplace", ShoppingBasket],
    ["/orders", "Orders", PackageCheck],
  ],
  TRANSPORTER: [
    ["/map", "Map", MapIcon],
    ["/transporter", "Delivery jobs", Truck],
  ],
  COORDINATOR: [
    ["/coordinator", "Coordination tasks", ClipboardCheck],
    ["/map", "Map", MapIcon],
    ["/orders", "Orders", PackageCheck],
  ],
} as const;

function mayVisit(role: ProductRole, pathname: string) {
  if (pathname === "/") return true;
  if (pathname === "/map") return true;
  if (pathname.startsWith("/orders/")) return role !== "TRANSPORTER";
  if (pathname.startsWith("/crops/")) return role === "FARMER" || role === "COORDINATOR";
  if (pathname.startsWith("/missions/")) return role === "TRANSPORTER" || role === "BUYER" || role === "FARMER" || role === "COORDINATOR";
  return {
    FARMER: ["/farmer", "/map", "/orders"],
    BUYER: ["/buyer", "/map", "/marketplace", "/orders"],
    TRANSPORTER: ["/map", "/transporter"],
    COORDINATOR: ["/coordinator", "/map", "/orders"],
  }[role].some((prefix) => pathname.startsWith(prefix));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { actor, ready, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [tutorialRequest, setTutorialRequest] = useState(0);

  useEffect(() => {
    if (!ready || pathname === "/") return;
    if (!actor) router.replace("/");
    else if (!mayVisit(actor.role, pathname)) router.replace(withPreviewFlag(roleHome(actor.role), window.location.search));
  }, [actor, pathname, ready, router]);

  if (pathname === "/") return <>{children}</>;
  if (!ready || !actor || !mayVisit(actor.role, pathname)) {
    return <div className="full-page-state"><span className="spinner" />Opening your workspace...</div>;
  }

  const links = navigation[actor.role];
  return (
    <div className="app-frame">
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-mark"><Leaf size={22} /></span>
          <div><strong>Harvest</strong><small>Saint Lucia</small></div>
        </div>
        <nav aria-label="Main navigation">
          {links.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href || (href !== roleHome(actor.role) && pathname.startsWith(href)) ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              <Icon size={19} /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-context">
          <p className="eyebrow">Need help?</p>
          <strong>Learn your workspace</strong>
          <span>Replay the short guide for your role whenever you need it.</span>
          <button className="sidebar-tutorial-button" onClick={() => { setOpen(false); setTutorialRequest((value) => value + 1); }}>
            <Compass size={16} />Take the tutorial
          </button>
        </div>
      </aside>
      <div className="main-column">
        {actor.readOnly && (
          <div className="simulation-replay-banner" role="status">
            Synthetic simulation replay · read-only · run {actor.simulationRunId?.slice(0, 8)}
          </div>
        )}
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
            {open ? <X /> : <Menu />}
          </button>
          <ConnectionStatus />
          <div className="profile-summary">
            <span className="avatar">{actor.name.slice(0, 1)}</span>
            <div><strong>{actor.name}</strong><small>{actor.role.toLowerCase()}</small></div>
          </div>
          <button className="button button-quiet" onClick={() => { signOut(); router.replace("/"); }}>
            <LogOut size={17} />Sign out
          </button>
        </header>
        <fieldset className="workspace-fieldset" disabled={Boolean(actor.readOnly)}><main className={pathname === "/map" ? "map-main" : undefined}>{children}</main></fieldset>
      </div>
      {!actor.readOnly && <OnboardingGuide actor={actor} restartSignal={tutorialRequest} />}
      {actor.readOnly && <ActionPreviewController actor={actor} />}
    </div>
  );
}
