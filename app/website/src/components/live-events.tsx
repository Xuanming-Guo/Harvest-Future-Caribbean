"use client";

import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { HarvestDomainEventEnvelope } from "@harvest/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { currentToken, productApiUrl } from "@/lib/api";
import { formatDate, titleCase } from "@/lib/format";

const CURSOR_KEY = "harvest.last-event-id";

export function useLiveEvents(simulationRunId?: string) {
  const [events, setEvents] = useState<HarvestDomainEventEnvelope[]>([]);
  const [connected, setConnected] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const controller = new AbortController();
    const token = currentToken();
    if (!token) return () => controller.abort();
    const cursor = window.sessionStorage.getItem(CURSOR_KEY);
    const url = new URL("/v1/events/stream", productApiUrl);
    if (simulationRunId) url.searchParams.set("simulationRunId", simulationRunId);

    void fetchEventSource(url.toString(), {
      signal: controller.signal,
      openWhenHidden: true,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cursor ? { "Last-Event-ID": cursor } : {}),
      },
      async onopen(response) {
        if (response.status === 409) {
          window.sessionStorage.removeItem(CURSOR_KEY);
          await queryClient.invalidateQueries();
          throw new Error("Event cursor refreshed");
        }
        if (!response.ok) throw new Error(`Event stream returned ${response.status}`);
        setConnected(true);
      },
      onmessage(message) {
        if (!message.data) return;
        const event = JSON.parse(message.data) as HarvestDomainEventEnvelope;
        window.sessionStorage.setItem(CURSOR_KEY, message.id);
        setEvents((current) => [event, ...current.filter((item) => item.eventId !== event.eventId)].slice(0, 40));
        void queryClient.invalidateQueries();
      },
      onclose() { setConnected(false); },
      onerror() { setConnected(false); },
    });
    return () => controller.abort();
  }, [queryClient, simulationRunId]);

  return { events, connected };
}

export function EventFeed({ events, compact = false }: { events: HarvestDomainEventEnvelope[]; compact?: boolean }) {
  if (!events.length) return <div className="empty-state"><strong>Waiting for live activity</strong><span>New Product API events will appear here.</span></div>;
  return <div className={`event-feed ${compact ? "event-feed-compact" : ""}`}>{events.map((event) => <article key={event.eventId} className={`event-row event-${event.eventType.toLowerCase().replaceAll("_", "-")}`}><span className="event-marker" /><div><strong>{titleCase(event.eventType)}</strong><p>{eventSummary(event)}</p><small>{formatDate(event.simulationTime ?? event.occurredAt)} · {titleCase(event.provenance)}</small></div><Link href={`/agents/traces/${event.traceId}`} aria-label={`Open trace for ${event.eventType}`}><ArrowUpRight size={17} /></Link></article>)}</div>;
}

function eventSummary(event: HarvestDomainEventEnvelope) {
  const payload = event.payload as unknown as Record<string, unknown>;
  const crop = typeof payload.cropType === "string" ? ` · ${titleCase(payload.cropType)}` : "";
  const status = typeof payload.status === "string" ? ` · ${titleCase(payload.status)}` : "";
  return `Observable state updated${crop}${status}`;
}
