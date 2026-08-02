"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudRain, Gauge, Pause, Play, RotateCcw, SkipBack } from "lucide-react";

import { EventFeed, useLiveEvents } from "@/components/live-events";
import { useSession } from "@/components/providers";
import { ErrorState, LoadingState, PageHeader, SectionTitle } from "@/components/ui";
import { WorldMap } from "@/components/world-map";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { DEMO_RUN_ID } from "@/lib/scenario";

export default function SimulationPage() {
  const { ready, actor } = useSession();
  const queryClient = useQueryClient();
  const run = useQuery({ queryKey: ["simulation-run", DEMO_RUN_ID], queryFn: () => api.simulationRun(DEMO_RUN_ID), enabled: ready, refetchInterval: 2_000 });
  const world = useQuery({ queryKey: ["simulation-world", DEMO_RUN_ID], queryFn: () => api.simulationWorld(DEMO_RUN_ID), enabled: ready, refetchInterval: 2_000 });
  const { events, connected } = useLiveEvents(DEMO_RUN_ID);
  const command = useMutation({ mutationFn: ({ value, speed }: { value: "START" | "PAUSE" | "RESET" | "REWIND" | "INJECT" | "SPEED"; speed?: number }) => apiCommand(value, speed), onSuccess: () => void queryClient.invalidateQueries() });
  const mayControl = ["OPERATIONS", "COORDINATOR", "ADMIN"].includes(actor?.role ?? "");
  const error = run.error ?? world.error;

  async function apiCommand(value: "START" | "PAUSE" | "RESET" | "REWIND" | "INJECT" | "SPEED", speed?: number) {
    if (value === "SPEED") return api.commandSimulation(DEMO_RUN_ID, { command: "SPEED", speed: speed ?? 8 });
    if (value === "REWIND") return api.commandSimulation(DEMO_RUN_ID, { command: "REWIND", targetTime: "2026-09-04T08:00:00Z" });
    if (value === "INJECT") {
      const affectedEntityIds = ["20202020-2020-4020-8020-202020202020"];
      const receipt = await api.commandSimulation(DEMO_RUN_ID, { command: "INJECT", injection: { type: "ROAD", scheduledFor: new Date().toISOString(), affectedEntityIds, publicDescription: "Road closure near the planned pickup route." } });
      await api.createException({ exceptionType: "DELAY", severity: "HIGH", affectedEntityIds, description: "Road closure observed on the planned pickup route.", provenance: "SYNTHETIC" });
      return receipt;
    }
    return api.commandSimulation(DEMO_RUN_ID, { command: value });
  }

  return <>
    <PageHeader eyebrow="Observable world" title="Simulation control room" description="Control and inspect only what Harvest actors can observe. Hidden crop truth and future disruptions remain inside the simulation boundary." />
    {error ? <ErrorState error={error} /> : !run.data || !world.data ? <LoadingState label="Loading observable simulation world…" /> : <section className="card simulation-shell">
      <div className="simulation-toolbar">
        <button className="button button-secondary button-small" disabled={!mayControl || command.isPending} onClick={() => command.mutate({value:"START"})}><Play size={14}/>Play</button>
        <button className="button button-secondary button-small" disabled={!mayControl || command.isPending} onClick={() => command.mutate({value:"PAUSE"})}><Pause size={14}/>Pause</button>
        {[2,8,30].map((speed) => <button key={speed} className={`button button-secondary button-small ${run.data.speed === speed ? "active" : ""}`} disabled={!mayControl || command.isPending} onClick={() => command.mutate({value:"SPEED", speed})}><Gauge size={13}/>{speed}×</button>)}
        <button className="button button-secondary button-small" disabled={!mayControl || command.isPending} onClick={() => command.mutate({value:"INJECT"})}><CloudRain size={14}/>Inject road event</button>
        <button className="button button-secondary button-small" disabled={!mayControl || command.isPending} onClick={() => command.mutate({value:"REWIND"})}><SkipBack size={14}/>Rewind</button>
        <button className="button button-secondary button-small" disabled={!mayControl || command.isPending} onClick={() => command.mutate({value:"RESET"})}><RotateCcw size={14}/>Reset</button>
        <div className="simulation-time"><strong>{formatDate(run.data.currentTime)}</strong><small>{run.data.status} · {run.data.speed}× · {connected ? "events live" : "reconnecting"}</small></div>
      </div>
      {!mayControl && <p className="form-message error" style={{margin:12}}>Switch to Operations or Coordinator to control the run.</p>}
      {command.error && <p className="form-message error" style={{margin:12}}>{command.error.message}</p>}
      <div className="simulation-content"><WorldMap world={world.data}/><aside className="simulation-feed"><SectionTitle title="Action stream" detail={`${events.length} observable events`}/><EventFeed events={events}/></aside></div>
    </section>}
  </>;
}
