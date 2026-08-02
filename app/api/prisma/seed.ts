import { PrismaClient, Provenance } from "@prisma/client";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://harvest:harvest-local-only@localhost:5432/harvest?schema=public";
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const ids = {
  farmerOne: "a0000000-0000-4000-8000-000000000001",
  farmerTwo: "a0000000-0000-4000-8000-000000000005",
  buyer: "a0000000-0000-4000-8000-000000000002",
  coordinator: "a0000000-0000-4000-8000-000000000003",
  transporter: "a0000000-0000-4000-8000-000000000004",
  operations: "a0000000-0000-4000-8000-000000000006",
  farmOne: "14141414-1414-4414-8414-141414141414",
  farmTwo: "14141414-1414-4414-8414-141414141415",
  batchOne: "11111111-1111-4111-8111-111111111111",
  batchTwo: "11111111-1111-4111-8111-111111111112",
  observationOne: "12121212-1212-4212-8212-121212121212",
  observationTwo: "12121212-1212-4212-8212-121212121213",
  predictionOne: "44444444-4444-4444-8444-444444444444",
  predictionTwo: "44444444-4444-4444-8444-444444444445",
  listingOne: "16161616-1616-4616-8616-161616161616",
  listingTwo: "16161616-1616-4616-8616-161616161617",
  demand: "18181818-1818-4818-8818-181818181818",
  order: "20202020-2020-4020-8020-202020202020",
  allocation: "22222222-2222-4222-8222-222222222222",
  approval: "21212121-2121-4121-8121-212121212121",
  trace: "c0000000-0000-4000-8000-000000000001",
  run: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pair: "30303030-3030-4030-8030-303030303030",
  baselineRun: "31313131-3131-4131-8131-313131313131",
};

const at = (value: string) => new Date(value);

async function main() {
  const actors = [
    [ids.farmerOne, "farmer-ana", "Ana Joseph", "FARMER"],
    [ids.farmerTwo, "farmer-marcus", "Marcus Pierre", "FARMER"],
    [ids.buyer, "buyer-hotel", "Bay Gardens Hotel", "BUYER"],
    [ids.coordinator, "coordinator-maya", "Maya Charles", "COORDINATOR"],
    [ids.transporter, "transporter-daniel", "Daniel Felix", "TRANSPORTER"],
    [ids.operations, "operations-demo", "Harvest Operations", "OPERATIONS"],
  ] as const;

  for (const [id, authSubject, name, role] of actors) {
    await prisma.actor.upsert({
      where: { id },
      update: { authSubject, name, role, isSynthetic: true },
      create: { id, authSubject, name, role, isSynthetic: true },
    });
  }

  await prisma.farm.upsert({
    where: { id: ids.farmOne },
    update: { name: "Roseau Valley Farm", farmerId: ids.farmerOne, latitude: 13.953, longitude: -61.005 },
    create: { id: ids.farmOne, name: "Roseau Valley Farm", farmerId: ids.farmerOne, latitude: 13.953, longitude: -61.005 },
  });
  await prisma.farm.upsert({
    where: { id: ids.farmTwo },
    update: { name: "Mabouya Growers", farmerId: ids.farmerTwo, latitude: 13.941, longitude: -60.918 },
    create: { id: ids.farmTwo, name: "Mabouya Growers", farmerId: ids.farmerTwo, latitude: 13.941, longitude: -60.918 },
  });

  for (const actorId of [ids.farmerOne, ids.coordinator, ids.operations]) {
    await prisma.farmPermission.upsert({
      where: { farmId_actorId: { farmId: ids.farmOne, actorId } },
      update: {},
      create: { farmId: ids.farmOne, actorId, role: actorId === ids.farmerOne ? "FARMER" : actorId === ids.coordinator ? "COORDINATOR" : "OPERATIONS" },
    });
  }

  const batches = [
    {
      id: ids.batchOne,
      farmId: ids.farmOne,
      latestObservationId: ids.observationOne,
      latestPredictionId: ids.predictionOne,
      availableToPromise: 14,
    },
    {
      id: ids.batchTwo,
      farmId: ids.farmTwo,
      latestObservationId: ids.observationTwo,
      latestPredictionId: ids.predictionTwo,
      availableToPromise: 6,
    },
  ];
  for (const batch of batches) {
    await prisma.cropBatch.upsert({
      where: { id: batch.id },
      update: { ...batch, cropType: "CUCUMBER", status: "HARVEST_READY", provenance: Provenance.MODEL_PREDICTED },
      create: { ...batch, cropType: "CUCUMBER", status: "HARVEST_READY", provenance: Provenance.MODEL_PREDICTED },
    });
  }

  const observations = [
    { id: ids.observationOne, cropBatchId: ids.batchOne, actorId: ids.farmerOne, estimatedQuantity: 20, notes: "Rain damage visible; approximately 20 kg marketable." },
    { id: ids.observationTwo, cropBatchId: ids.batchTwo, actorId: ids.farmerTwo, estimatedQuantity: 8, notes: "Six kilograms can be committed safely this week." },
  ];
  for (const observation of observations) {
    await prisma.cropObservation.upsert({
      where: { id: observation.id },
      update: {},
      create: {
        ...observation,
        observedAt: at("2026-09-04T08:00:00Z"),
        recordedAt: at("2026-09-04T08:02:00Z"),
        cropStage: "HARVEST_READY",
        provenance: Provenance.SYNTHETIC,
        traceId: ids.trace,
      },
    });
  }

  const predictions = [
    { id: ids.predictionOne, requestId: "33333333-3333-4333-8333-333333333333", cropBatchId: ids.batchOne, q10: 14, q50: 18, q90: 22, readiness: 0.84, confidence: 0.78, warnings: ["Recent rain damage reported"] },
    { id: ids.predictionTwo, requestId: "33333333-3333-4333-8333-333333333334", cropBatchId: ids.batchTwo, q10: 6, q50: 8, q90: 10, readiness: 0.81, confidence: 0.74, warnings: ["Sparse observation history"] },
  ];
  for (const prediction of predictions) {
    await prisma.yieldPrediction.upsert({
      where: { id: prediction.id },
      update: {},
      create: {
        ...prediction,
        modelVersion: "fixture-yield-v0.1.0",
        harvestStart: at("2026-09-05T00:00:00Z"),
        harvestEnd: at("2026-09-08T00:00:00Z"),
        featureSnapshot: {
          cropStage: "HARVEST_READY",
          observationCount: 1,
          weatherSummary: { rainfall7dMm: 74, temperatureC: 28.2 },
          satelliteSummary: { ndvi: 0.71, observedAt: "2026-09-02" },
        },
        provenance: Provenance.MODEL_PREDICTED,
        generatedAt: at("2026-09-04T08:03:00Z"),
      },
    });
  }

  const listings = [
    { id: ids.listingOne, cropBatchId: ids.batchOne, farmerId: ids.farmerOne, quantity: 14, unitPrice: 7.5 },
    { id: ids.listingTwo, cropBatchId: ids.batchTwo, farmerId: ids.farmerTwo, quantity: 6, unitPrice: 7.25 },
  ];
  for (const listing of listings) {
    await prisma.listing.upsert({
      where: { id: listing.id },
      update: { ...listing, status: "ACTIVE" },
      create: {
        ...listing,
        cropType: "CUCUMBER",
        currency: "XCD",
        availableFrom: at("2026-09-05T00:00:00Z"),
        availableUntil: at("2026-09-08T00:00:00Z"),
        status: "ACTIVE",
        createdAt: at("2026-09-04T08:04:00Z"),
      },
    });
  }

  await prisma.buyerDemand.upsert({
    where: { id: ids.demand },
    update: { status: "MATCHING" },
    create: {
      id: ids.demand,
      buyerId: ids.buyer,
      cropType: "CUCUMBER",
      quantity: 20,
      neededBy: at("2026-09-05T15:00:00Z"),
      latitude: 14.0101,
      longitude: -60.9875,
      maxUnitPrice: 8,
      currency: "XCD",
      status: "MATCHING",
      createdAt: at("2026-09-04T08:10:00Z"),
    },
  });

  await prisma.order.upsert({
    where: { id: ids.order },
    update: { lifecycleStatus: "AWAITING_APPROVAL", atRisk: false, activeExceptionIds: [] },
    create: {
      id: ids.order,
      buyerId: ids.buyer,
      cropType: "CUCUMBER",
      requestedQuantity: 20,
      acceptedQuantity: 0,
      neededBy: at("2026-09-05T15:00:00Z"),
      latitude: 14.0101,
      longitude: -60.9875,
      listingIds: [ids.listingOne, ids.listingTwo],
      lifecycleStatus: "AWAITING_APPROVAL",
      atRisk: false,
      activeExceptionIds: [],
      createdAt: at("2026-09-04T08:12:00Z"),
    },
  });
  await prisma.allocation.upsert({
    where: { id: ids.allocation },
    update: { status: "PROPOSED" },
    create: { id: ids.allocation, orderId: ids.order, status: "PROPOSED", createdAt: at("2026-09-04T08:13:00Z") },
  });
  await prisma.allocationLine.deleteMany({ where: { allocationId: ids.allocation } });
  await prisma.allocationLine.createMany({
    data: [
      { allocationId: ids.allocation, cropBatchId: ids.batchOne, listingId: ids.listingOne, quantity: 14 },
      { allocationId: ids.allocation, cropBatchId: ids.batchTwo, listingId: ids.listingTwo, quantity: 6 },
    ],
  });
  await prisma.approval.upsert({
    where: { id: ids.approval },
    update: { status: "PENDING", decidedBy: null, decidedAt: null, reason: null },
    create: { id: ids.approval, subjectType: "ALLOCATION", subjectId: ids.allocation, status: "PENDING", requestedAt: at("2026-09-04T08:13:00Z") },
  });

  await prisma.agentTrace.upsert({
    where: { id: ids.trace },
    update: { status: "AWAITING_APPROVAL" },
    create: {
      id: ids.trace,
      subjectType: "ORDER",
      subjectId: ids.order,
      status: "AWAITING_APPROVAL",
      summary: "Combined two conservative cucumber commitments to cover the hotel order without exceeding available-to-promise supply.",
    },
  });
  await prisma.traceStep.deleteMany({ where: { traceId: ids.trace } });
  await prisma.traceStep.createMany({
    data: [
      { traceId: ids.trace, recordedAt: at("2026-09-04T08:12:00Z"), kind: "INPUT", summary: "Hotel requested 20 kg of cucumber by 15:00." },
      { traceId: ids.trace, recordedAt: at("2026-09-04T08:12:10Z"), kind: "EVIDENCE", summary: "Farm ATP values were 14 kg and 6 kg; both windows meet the deadline.", confidence: 0.78 },
      { traceId: ids.trace, recordedAt: at("2026-09-04T08:12:20Z"), kind: "TOOL_CALL", summary: "Read active cucumber listings and validated remaining ATP." },
      { traceId: ids.trace, recordedAt: at("2026-09-04T08:13:00Z"), kind: "DECISION", summary: "Proposed a 14 kg + 6 kg multi-farm allocation.", confidence: 0.94 },
      { traceId: ids.trace, recordedAt: at("2026-09-04T08:13:01Z"), kind: "APPROVAL", summary: "Paused before commitment for explicit human approval." },
    ],
  });

  const world = {
    actors: [
      { actorId: ids.farmerOne, role: "FARMER", position: { latitude: 13.953, longitude: -61.005 }, activity: "Preparing 14 kg" },
      { actorId: ids.farmerTwo, role: "FARMER", position: { latitude: 13.941, longitude: -60.918 }, activity: "Preparing 6 kg" },
      { actorId: ids.buyer, role: "BUYER", position: { latitude: 14.0101, longitude: -60.9875 }, activity: "Awaiting order" },
      { actorId: ids.transporter, role: "TRANSPORTER", position: { latitude: 13.998, longitude: -60.986 }, activity: "Available" },
    ],
    routes: [],
    disruptions: [],
  };
  await prisma.simulationRun.upsert({
    where: { id: ids.run },
    update: { status: "PAUSED", speed: 8, currentTime: at("2026-09-04T08:13:00Z"), world },
    create: { id: ids.run, scenarioId: "saint-lucia-demo-v1", policy: "HARVEST", seed: 8675309n, speed: 8, status: "PAUSED", currentTime: at("2026-09-04T08:13:00Z"), createdAt: at("2026-09-04T08:00:00Z"), world },
  });
  await prisma.simulationRun.upsert({
    where: { id: ids.baselineRun },
    update: {},
    create: { id: ids.baselineRun, scenarioId: "saint-lucia-demo-v1", policy: "BASELINE", seed: 8675309n, speed: 8, status: "COMPLETED", currentTime: at("2026-09-05T18:00:00Z"), createdAt: at("2026-09-04T08:00:00Z"), world },
  });
  await prisma.pairedRun.upsert({
    where: { id: ids.pair },
    update: {},
    create: {
      id: ids.pair,
      scenarioId: "saint-lucia-demo-v1",
      seed: 8675309n,
      baselineRunId: ids.baselineRun,
      harvestRunId: ids.run,
      status: "COMPLETED",
      result: {
        baseline: { localProcurementRate: 0.44, fulfilmentRate: 0.68, wasteQuantity: { value: 17, unit: "kg" } },
        harvest: { localProcurementRate: 0.7, fulfilmentRate: 0.91, wasteQuantity: { value: 8, unit: "kg" } },
      },
    },
  });

  const eventBase = {
    simulationTime: at("2026-09-04T08:13:00Z"),
    simulationRunId: ids.run,
    traceId: ids.trace,
    correlationId: "d0000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    provenance: Provenance.SYNTHETIC,
  };
  await prisma.domainEvent.createMany({
    skipDuplicates: true,
    data: [
      { ...eventBase, id: "e0000000-0000-4000-8000-000000000001", eventType: "CROP_OBSERVATION_SUBMITTED", occurredAt: at("2026-09-04T08:02:00Z"), actorId: ids.farmerOne, entityId: ids.batchOne, causationId: null, payload: { observationId: ids.observationOne, cropBatchId: ids.batchOne, observedAt: "2026-09-04T08:00:00Z", cropStage: "HARVEST_READY" } },
      { ...eventBase, id: "e0000000-0000-4000-8000-000000000002", eventType: "FORECAST_PRODUCED", occurredAt: at("2026-09-04T08:03:00Z"), actorId: ids.farmerOne, entityId: ids.batchOne, causationId: "e0000000-0000-4000-8000-000000000001", provenance: Provenance.MODEL_PREDICTED, payload: { predictionId: ids.predictionOne, cropBatchId: ids.batchOne, q10MarketableYield: { value: 14, unit: "kg" }, availableToPromise: { value: 14, unit: "kg" } } },
      { ...eventBase, id: "e0000000-0000-4000-8000-000000000003", eventType: "LISTING_PUBLISHED", occurredAt: at("2026-09-04T08:04:00Z"), actorId: ids.farmerOne, entityId: ids.listingOne, causationId: "e0000000-0000-4000-8000-000000000002", payload: { listingId: ids.listingOne, cropBatchId: ids.batchOne, quantity: { value: 14, unit: "kg" }, availableFrom: "2026-09-05" } },
      { ...eventBase, id: "e0000000-0000-4000-8000-000000000004", eventType: "BUYER_DEMAND_CREATED", occurredAt: at("2026-09-04T08:10:00Z"), actorId: ids.buyer, entityId: ids.demand, causationId: null, payload: { demandId: ids.demand, cropType: "CUCUMBER", quantity: { value: 20, unit: "kg" }, neededBy: "2026-09-05T15:00:00Z" } },
      { ...eventBase, id: "e0000000-0000-4000-8000-000000000005", eventType: "ORDER_REQUESTED", occurredAt: at("2026-09-04T08:12:00Z"), actorId: ids.buyer, entityId: ids.order, causationId: null, payload: { orderId: ids.order, cropType: "CUCUMBER", requestedQuantity: { value: 20, unit: "kg" }, status: "REQUESTED" } },
      { ...eventBase, id: "e0000000-0000-4000-8000-000000000006", eventType: "ALLOCATION_PROPOSED", occurredAt: at("2026-09-04T08:13:00Z"), actorId: ids.coordinator, entityId: ids.allocation, causationId: "e0000000-0000-4000-8000-000000000005", provenance: Provenance.INFERRED, payload: { allocationId: ids.allocation, orderId: ids.order, lines: [{ cropBatchId: ids.batchOne, quantity: { value: 14, unit: "kg" } }, { cropBatchId: ids.batchTwo, quantity: { value: 6, unit: "kg" } }] } },
    ],
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
