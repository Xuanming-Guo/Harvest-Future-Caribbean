"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Clock3, MapPin, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

const demoVehicleId = "d0000000-0000-4000-8000-000000000001";

export default function TransporterHome() {
  const queryClient = useQueryClient();
  const missions = useQuery({ queryKey: ["missions"], queryFn: () => api.missions() });
  const accept = useMutation({
    mutationFn: (missionId: string) => api.acceptMission(missionId, demoVehicleId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["missions"] }),
  });

  if (missions.error) return <ErrorState error={missions.error} />;
  if (!missions.data) return <LoadingState label="Loading delivery jobs..." />;
  const available = missions.data.items.filter((mission) => mission.status === "AVAILABLE");
  const mine = missions.data.items.filter((mission) => mission.status !== "AVAILABLE" && mission.status !== "CANCELLED");

  return (
    <>
      <PageHeader eyebrow="Delivery jobs" title="Move local food with confidence" description="Accept available jobs, follow the pickup sequence and report progress or problems as they happen." />
      <div className="metric-grid">
        <Metric label="Available jobs" value={available.length} detail="Ready to accept" icon={PackageCheck} />
        <Metric label="My active jobs" value={mine.filter((mission) => mission.status !== "DELIVERED").length} detail="Currently assigned" icon={Truck} tone="blue" />
        <Metric label="Completed" value={mine.filter((mission) => mission.status === "DELIVERED").length} detail="Delivered" icon={Clock3} tone="amber" />
      </div>
      <div className="dashboard-grid">
        <Card>
          <SectionTitle title="Available near you" detail={`${available.length} jobs`} />
          {!available.length ? <EmptyState title="No jobs waiting" detail="New approved orders will appear automatically." /> : <div className="mission-list">{available.map((mission) => (
            <article className="mission-card" key={mission.missionId}>
              <div><Badge>{mission.status}</Badge><h3>{mission.quantity.value} kg delivery</h3><p><MapPin size={15} />{mission.stops.length} stops - due {formatDate(mission.deadline)}</p></div>
              <button className="button" disabled={accept.isPending} onClick={() => accept.mutate(mission.missionId)}>Accept job</button>
            </article>
          ))}</div>}
        </Card>
        <Card>
          <SectionTitle title="My jobs" detail={`${mine.length} assigned`} />
          {!mine.length ? <EmptyState title="No active deliveries" detail="Accept an available job to begin." /> : <div className="mission-list">{mine.map((mission) => (
            <Link href={`/missions/${mission.missionId}`} className="mission-card" key={mission.missionId}>
              <div><Badge>{mission.status}</Badge><h3>{mission.quantity.value} kg delivery</h3><p>Due {formatDate(mission.deadline)}</p></div><ArrowRight size={18} />
            </Link>
          ))}</div>}
        </Card>
      </div>
      {accept.error && <p className="form-error">{accept.error.message}</p>}
    </>
  );
}
