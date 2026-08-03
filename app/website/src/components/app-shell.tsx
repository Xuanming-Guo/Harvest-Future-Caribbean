"use client";

import {
  ClipboardCheck,
  Leaf,
  LogOut,
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

import { roleHome, type ProductRole } from "@/lib/api";
import { useSession } from "./providers";

const navigation = {
  FARMER: [
    ["/farmer", "My farm", Sprout],
    ["/orders", "Orders", PackageCheck],
  ],
  BUYER: [
    ["/buyer", "Overview", Leaf],
    ["/marketplace", "Marketplace", ShoppingBasket],
    ["/orders", "Orders", PackageCheck],
  ],
  TRANSPORTER: [
    ["/transporter", "Delivery jobs", Truck],
  ],
  COORDINATOR: [
    ["/coordinator", "Coordination tasks", ClipboardCheck],
    ["/orders", "Orders", PackageCheck],
  ],
} as const;

function mayVisit(role: ProductRole, pathname: string) {
  if (pathname === "/") return true;
  if (pathname.startsWith("/orders/")) return role !== "TRANSPORTER";
  if (pathname.startsWith("/crops/")) return role === "FARMER" || role === "COORDINATOR";
  if (pathname.startsWith("/missions/")) return role === "TRANSPORTER" || role === "BUYER" || role === "FARMER" || role === "COORDINATOR";
  return {
    FARMER: ["/farmer", "/orders"],
    BUYER: ["/buyer", "/marketplace", "/orders"],
    TRANSPORTER: ["/transporter"],
    COORDINATOR: ["/coordinator", "/orders"],
  }[role].some((prefix) => pathname.startsWith(prefix));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { actor, ready, signOut } = useSession();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!ready || pathname === "/") return;
    if (!actor) router.replace("/");
    else if (!mayVisit(actor.role, pathname)) router.replace(roleHome(actor.role));
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
          <strong>Harvest coordination team</strong>
          <span>Use your task page to report missing information or delivery problems.</span>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
            {open ? <X /> : <Menu />}
          </button>
          <div className="profile-summary">
            <span className="avatar">{actor.name.slice(0, 1)}</span>
            <div><strong>{actor.name}</strong><small>{actor.role.toLowerCase()}</small></div>
          </div>
          <button className="button button-quiet" onClick={() => { signOut(); router.replace("/"); }}>
            <LogOut size={17} />Sign out
          </button>
        </header>
        <main>{children}</main>
      </div>
    </div>
  );
}
