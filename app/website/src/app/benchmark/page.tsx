"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Leaf, PackageCheck, Trash2 } from "lucide-react";

import { useSession } from "@/components/providers";
import { Card, ErrorState, LoadingState, Metric, PageHeader, SectionTitle } from "@/components/ui";
import { api } from "@/lib/api";
import { formatPercent } from "@/lib/format";
import { DEMO_PAIR_ID } from "@/lib/scenario";

export default function BenchmarkPage() {
  const { ready, actor } = useSession();
  const queryClient = useQueryClient();
  const pair = useQuery({ queryKey: ["pair", DEMO_PAIR_ID], queryFn: () => api.pair(DEMO_PAIR_ID), enabled: ready });
  const create = useMutation({ mutationFn: api.createPair, onSuccess: () => void queryClient.invalidateQueries() });
  if (pair.error) return <ErrorState error={pair.error} />;
  if (!pair.data) return <LoadingState label="Loading paired counterfactual result…" />;
  const result = pair.data.result;
  if (!result) return null;
  const mayRun = ["OPERATIONS", "COORDINATOR", "ADMIN"].includes(actor?.role ?? "");
  return <>
    <PageHeader eyebrow="Same world · same seed" title="Baseline versus Harvest" description="A paired synthetic counterfactual comparison. These results are simulation evidence, not measured deployed impact." actions={<button className="button" disabled={!mayRun || create.isPending} onClick={() => create.mutate()}><BarChart3 size={15}/>{create.isPending ? "Running…" : "Run another pair"}</button>} />
    <div className="grid metrics-grid">
      <Metric label="Local procurement" value={formatPercent(result.harvest.localProcurementRate)} detail={`Baseline ${formatPercent(result.baseline.localProcurementRate)}`} icon={Leaf}/>
      <Metric label="Fulfilment" value={formatPercent(result.harvest.fulfilmentRate)} detail={`Baseline ${formatPercent(result.baseline.fulfilmentRate)}`} icon={PackageCheck} tone="blue"/>
      <Metric label="Harvest waste" value={`${result.harvest.wasteQuantity.value} kg`} detail={`Baseline ${result.baseline.wasteQuantity.value} kg`} icon={Trash2} tone="amber"/>
      <Metric label="Seed" value={pair.data.seed} detail={pair.data.scenarioId} icon={BarChart3} tone="purple"/>
    </div>
    <div className="grid two-column" style={{marginTop:18}}>
      <Card><SectionTitle title="Outcome comparison" detail="Aggregate contract metrics"/><div className="benchmark-bars">{[
        ["Local procurement", result.baseline.localProcurementRate, result.harvest.localProcurementRate],
        ["Fulfilment", result.baseline.fulfilmentRate, result.harvest.fulfilmentRate],
        ["Waste avoided", 0, Math.max(0, 1 - result.harvest.wasteQuantity.value / result.baseline.wasteQuantity.value)],
      ].map(([label, baseline, harvest]) => <div className="stack" key={label as string}><div className="bar-row"><span>{label as string} · baseline</span><div className="bar-track"><div className="bar-fill baseline" style={{width:`${Number(baseline)*100}%`}}/></div><strong>{formatPercent(Number(baseline))}</strong></div><div className="bar-row"><span>{label as string} · Harvest</span><div className="bar-track"><div className="bar-fill" style={{width:`${Number(harvest)*100}%`}}/></div><strong>{formatPercent(Number(harvest))}</strong></div></div>)}</div></Card>
      <Card><SectionTitle title="Interpretation" detail="Honest evidence"/><div className="stack"><p className="form-message">Both policies receive identical initial conditions, seed, hidden crop outcomes and disruptions.</p><p className="muted small">The comparison measures simulated coordination behaviour. It does not establish real customer satisfaction, adoption or deployed economic impact.</p><div className="split"><span className="small muted">Pair status</span><strong>{pair.data.status}</strong></div><div className="split"><span className="small muted">Baseline run</span><code>{pair.data.baselineRunId.slice(0,8)}</code></div><div className="split"><span className="small muted">Harvest run</span><code>{pair.data.harvestRunId.slice(0,8)}</code></div></div></Card>
    </div>
  </>;
}
