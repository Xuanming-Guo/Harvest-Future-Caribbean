"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Option = { value: string; label: string; disabled: boolean };
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type !== "option") return optionsFrom(child.props.children);
    return [{ value: String(child.props.value ?? ""), label: Children.toArray(child.props.children).join(""), disabled: !!child.props.disabled }];
  });
}

/** One keyboard-accessible Harvest menu, shared by setup, replay and map tools. */
export default function SelectControl({ value, onValueChange, children, disabled, className = "", style, "aria-label": ariaLabel, id: triggerId }: {
  value: string | number; onValueChange: (value: string) => void; children: ReactNode;
  id?: string; disabled?: boolean; className?: string; style?: CSSProperties; "aria-label"?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<CSSProperties>({});
  const options = optionsFrom(children);
  const selected = options.find((option) => option.value === String(value));
  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const show = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom;
    setPosition({ position: "fixed", width, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      ...(below > 250 ? { top: rect.bottom + 6, maxHeight: Math.min(340, below - 18) } : { bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(120, rect.top - 18) }) });
    setQuery(""); setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    if (options.length > 7) search.current?.focus();
    else menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled), [role="option"]:not(:disabled)')?.focus();
    const outside = (event: MouseEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const resize = () => setOpen(false);
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("mousedown", outside); window.removeEventListener("resize", resize); };
  }, [open, options.length]);
  return <>
    <button id={triggerId} ref={trigger} type="button" className={`harvest-select ${className}`} style={style} disabled={disabled}
      role="combobox" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
      onClick={() => open ? close() : show()} onKeyDown={(event) => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); show(); } }}>
      <span>{selected?.label || "Choose an option"}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={menu} className="harvest-select-menu" style={position} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") { setOpen(false); trigger.current?.focus(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && !(event.target === search.current && ["Home", "End"].includes(event.key))) {
        event.preventDefault();
        const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? [])];
        const current = buttons.findIndex((button) => button === document.activeElement);
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    }}>
      {options.length > 7 && <input ref={search} className="select-search" aria-label={`Search ${ariaLabel ?? "options"}`} placeholder="Search…" value={query} onChange={(event) => setQuery(event.target.value)} />}
      <div id={id} role="listbox" aria-label={ariaLabel}>
        {filtered.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === String(value)} disabled={option.disabled}
          onClick={() => { onValueChange(option.value); close(); }}><span>{option.label}</span>{option.value === String(value) && <span aria-hidden="true">✓</span>}</button>)}
        {!filtered.length && <p className="panel-help">No matching options.</p>}
      </div>
    </div>, document.body)}
  </>;
}
