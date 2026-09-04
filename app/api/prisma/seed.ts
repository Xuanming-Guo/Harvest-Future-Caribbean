import { PrismaClient, Provenance } from "@prisma/client";
import { RandomSource, WeatherModel } from "@harvest/simulation";

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
  buyerApproval: "21212121-2121-4121-8121-212121212121",
  farmerOneApproval: "21212121-2121-4121-8121-212121212122",
  farmerTwoApproval: "21212121-2121-4121-8121-212121212123",
  trace: "c0000000-0000-4000-8000-000000000001",
  vehicle: "d0000000-0000-4000-8000-000000000001",
  verificationOne: "f0000000-0000-4000-8000-000000000001",
  verificationTwo: "f0000000-0000-4000-8000-000000000002",
  cucumberStandard: "57575757-5757-4757-8757-575757575701",
  dasheenStandard: "57575757-5757-4757-8757-575757575702",
  historicOrder: "20202020-2020-4020-8020-202020202021",
  historicAllocation: "22222222-2222-4222-8222-222222222223",
  historicBuyerApproval: "21212121-2121-4121-8121-212121212124",
  historicFarmerApproval: "21212121-2121-4121-8121-212121212125",
  historicMission: "23232323-2323-4323-8323-232323232324",
  historicAcceptance: "28282828-2828-4828-8828-282828282829",
};

const at = (value: string) => new Date(value);
const retrievedAt = "2026-09-03";
const cardiGreenhouseUrl = "https://www.cardi.org/wp-content/uploads/2020/01/TROPICAL-GREENHOUSE-GROWERS-MANUAL.pdf";
const cardiDasheenUrl = "https://www.cardi.org/wp-content/uploads/2011/02/Commercial-Dasheen-Production-and-Postharvest-protocol-for-OECS.pdf";
const faoGapUrl = "https://www.fao.org/4/i3284e/i3284e.pdf";
const faoPackhouseUrl = "https://www.fao.org/4/i2678e/i2678e00.pdf";
const uneceCucumberUrl = "https://unece.org/trade/wp7/FFV-Standards";

async function main() {
  // Development seed data is disposable. Clear derived workflow state first so
  // every local start and integration-test run begins from the same scenario.
  await prisma.$transaction([
    prisma.deliveryAcceptance.deleteMany(),
    prisma.deliveryUpdate.deleteMany(),
    prisma.deliveryMission.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.verificationTask.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.approval.deleteMany(),
    prisma.allocationLine.deleteMany(),
    prisma.allocation.deleteMany(),
    prisma.operationalException.deleteMany(),
    prisma.idempotencyRecord.deleteMany(),
    prisma.cropObservationIntake.deleteMany(),
    prisma.traceStep.deleteMany(),
    prisma.domainEvent.deleteMany(),
    prisma.weatherObservation.deleteMany(),
    prisma.simulationActorMapping.deleteMany(),
    prisma.pairedRun.deleteMany(),
    prisma.simulationRun.deleteMany(),
    prisma.agentTrace.deleteMany(),
    prisma.order.deleteMany(),
    prisma.cropStandard.deleteMany(),
    prisma.buyerDemand.deleteMany(),
    prisma.listing.deleteMany(),
    prisma.yieldPrediction.deleteMany(),
    prisma.cropObservation.deleteMany(),
    prisma.cropBatch.deleteMany(),
    prisma.farmPermission.deleteMany(),
    prisma.farm.deleteMany(),
    prisma.actor.deleteMany(),
  ]);

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
  await prisma.actor.update({
    where: { id: ids.buyer },
    data: { defaultLatitude: 14.0101, defaultLongitude: -60.9875, serviceZone: "Castries" },
  });

  // These published buyer standards are stakeholder/reference material for the
  // demo. Their guidance is paraphrased only from the linked public documents.
  await prisma.cropStandard.createMany({
    data: [
      {
        id: ids.cucumberStandard,
        cropType: "CUCUMBER",
        publisherActorId: ids.buyer,
        version: 1,
        status: "PUBLISHED",
        reviewedAt: at("2026-09-03T12:00:00Z"),
        geography: "Saint Lucia buyer reference; adapt to local field conditions with an agricultural adviser",
        source: {
          title: "UNECE Standard FFV-15 — Cucumbers (2017)",
          url: uneceCucumberUrl,
          licence: "© United Nations; linked for reference under UN terms of use",
          retrievedAt,
        },
        checklist: [
          { key: "VARIETY", requirement: "Supply fresh slicing varieties of Cucumis sativus L. and keep each package uniform by variety." },
          { key: "SIZE_AND_GRADE", requirement: "Keep cucumbers reasonably uniform in size within each package and identify the agreed buyer grade and size range." },
          { key: "MATURITY_AND_APPEARANCE", requirement: "Fruit should be firm, fresh, sufficiently developed with soft seeds, and green without visible yellowing." },
          { key: "PERMITTED_DEFECTS", requirement: "Only slight shape or colouring defects that do not affect the flesh, keeping quality, or presentation are acceptable; decay is not acceptable." },
          { key: "CLEANING", requirement: "Cucumbers should be clean, practically free of visible foreign matter, and free of abnormal external moisture." },
          { key: "PACKAGING", requirement: "Use clean protective packaging, keep contents uniform in quality and size, and avoid handling damage." },
        ],
        images: [],
        guidance: [
          {
            topic: "HARVEST_WINDOW",
            text: "CARDI reports about 50–70 days from seeding to the first cucumber harvest, with timing dependent on variety and growing conditions.",
            source: { title: "CARDI Tropical Greenhouse Growers Manual", url: cardiGreenhouseUrl, retrievedAt },
          },
          {
            topic: "PEST_AND_DISEASE_SIGNS",
            text: "Check for thrips-related fruit crooking, yellow angular leaf spots, white powdery growth on leaves or stems, mosaic symptoms, and grey mould or stem rot.",
            source: { title: "CARDI Tropical Greenhouse Growers Manual", url: cardiGreenhouseUrl, retrievedAt },
          },
          {
            topic: "GOOD_AGRICULTURAL_PRACTICE",
            text: "Plan harvest and packing together, train harvest workers, use clean sharp tools, handle fruit gently, and move harvested produce promptly into shade.",
            source: { title: "FAO Good Agricultural Practices for Greenhouse Vegetable Crops", url: faoGapUrl, retrievedAt },
          },
          {
            topic: "HARVEST_READINESS",
            text: "Harvest near full size while seeds remain soft; firmness, gloss, uniform shape, dark green colour, and no yellowing are practical readiness checks.",
            source: { title: "FAO Good Agricultural Practices for Greenhouse Vegetable Crops", url: faoGapUrl, retrievedAt },
          },
          {
            topic: "SORTING_GRADING_CLEANING_STORAGE",
            text: "Field-sort out produce with mechanical damage, pest damage, decay, or severe misshaping; grade to the buyer's size and quality criteria and keep produce shaded while it moves to packing.",
            source: { title: "FAO Good Practice in the Design, Management and Operation of a Fresh Produce Packing-House", url: faoPackhouseUrl, retrievedAt },
          },
        ],
      },
      {
        id: ids.dasheenStandard,
        cropType: "DASHEEN",
        publisherActorId: ids.buyer,
        version: 1,
        status: "PUBLISHED",
        reviewedAt: at("2026-09-03T12:00:00Z"),
        geography: "Saint Lucia and the OECS; stakeholder/reference material for buyer review",
        source: {
          title: "CARDI Commercial Dasheen Production and Post-Harvest Protocol for the OECS",
          url: cardiDasheenUrl,
          licence: "Copyright CARDI; linked and paraphrased as reference material",
          retrievedAt,
        },
        checklist: [
          { key: "VARIETY", requirement: "Any dasheen variety may be supplied when it meets the agreed corm specifications." },
          { key: "SIZE_AND_GRADE", requirement: "Corms should weigh 0.9–4.5 kg; separate undersized, malformed, soft, insect-damaged, mechanically damaged, or diseased corms." },
          { key: "MATURITY_AND_APPEARANCE", requirement: "Supply mature, rounded, symmetrical corms with moist white flesh and no internal breakdown or discolouration." },
          { key: "PERMITTED_DEFECTS", requirement: "Small cormel attachment scars and a trimmed tail are acceptable; other cuts, softening, surface mould, and multi-headed deformation are not." },
          { key: "CLEANING", requirement: "Remove roots, dead tissue, loose soil, and visible field debris without bruising or cutting the corm." },
          { key: "PACKAGING", requirement: "Use rigid field crates before packing; final export packs are typically 18–20 kg and should carry packer, producer, origin, size, grade, and net-weight details." },
        ],
        images: [],
        guidance: [
          {
            topic: "HARVEST_WINDOW",
            text: "CARDI reports harvest at about 7–8 months in drier areas and 9–10 months in wetter areas; local rainfall and the agro-ecological zone affect timing.",
            source: { title: "CARDI Commercial Dasheen Production and Post-Harvest Protocol for the OECS", url: cardiDasheenUrl, retrievedAt },
          },
          {
            topic: "PEST_AND_DISEASE_SIGNS",
            text: "Inspect corms for beetle holes and tunnels, and watch harvested corms for wounds, browning, fungal growth, softening, or soft rot that can indicate post-harvest infection.",
            source: { title: "CARDI Commercial Dasheen Production and Post-Harvest Protocol for the OECS", url: cardiDasheenUrl, retrievedAt },
          },
          {
            topic: "GOOD_AGRICULTURAL_PRACTICE",
            text: "Select vigorous planting material, match planting and spacing to soil and rainfall conditions, maintain ground cover where suitable, and use cultural monitoring to reduce crop damage.",
            source: { title: "CARDI Commercial Dasheen Production and Post-Harvest Protocol for the OECS", url: cardiDasheenUrl, retrievedAt },
          },
          {
            topic: "HARVEST_READINESS",
            text: "Most leaves beginning to senesce and the main corm becoming visible as it pushes toward the soil surface are practical maturity signs; sample plants before harvesting the lot.",
            source: { title: "CARDI Commercial Dasheen Production and Post-Harvest Protocol for the OECS", url: cardiDasheenUrl, retrievedAt },
          },
          {
            topic: "SORTING_GRADING_CLEANING_STORAGE",
            text: "Remove cormels and loose soil, reject undersized, malformed, damaged, soft, insect-damaged, or diseased corms, and move accepted corms in rigid crates. CARDI reports storage at 12–13°C and 80–90% relative humidity for up to 3–4 weeks.",
            source: { title: "CARDI Commercial Dasheen Production and Post-Harvest Protocol for the OECS", url: cardiDasheenUrl, retrievedAt },
          },
        ],
      },
    ],
  });

  await prisma.farm.upsert({
    where: { id: ids.farmOne },
    update: { name: "Roseau Valley Farm", farmerId: ids.farmerOne, latitude: 13.953, longitude: -61.005, productionZone: "Roseau Valley" },
    create: { id: ids.farmOne, name: "Roseau Valley Farm", farmerId: ids.farmerOne, latitude: 13.953, longitude: -61.005, productionZone: "Roseau Valley" },
  });
  await prisma.farm.upsert({
    where: { id: ids.farmTwo },
    update: { name: "Mabouya Growers", farmerId: ids.farmerTwo, latitude: 13.941, longitude: -60.918, productionZone: "Mabouya Valley" },
    create: { id: ids.farmTwo, name: "Mabouya Growers", farmerId: ids.farmerTwo, latitude: 13.941, longitude: -60.918, productionZone: "Mabouya Valley" },
  });

  for (const { farmId, actorId, role } of [
    { farmId: ids.farmOne, actorId: ids.farmerOne, role: "FARMER" },
    { farmId: ids.farmTwo, actorId: ids.farmerTwo, role: "FARMER" },
    { farmId: ids.farmOne, actorId: ids.coordinator, role: "COORDINATOR" },
    { farmId: ids.farmTwo, actorId: ids.coordinator, role: "COORDINATOR" },
  ] as const) {
    await prisma.farmPermission.upsert({
      where: { farmId_actorId: { farmId, actorId } },
      update: { role },
      create: { farmId, actorId, role },
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

  await prisma.verificationTask.createMany({
    data: [
      { id: ids.verificationOne, farmId: ids.farmOne, cropBatchId: ids.batchOne, subjectType: "CROP_OBSERVATION", subjectId: ids.observationOne, taskType: "VERIFY_OBSERVATION", status: "OPEN", summary: "Verify Ana's rain-damage and quantity update.", createdAt: at("2026-09-04T08:02:30Z") },
      { id: ids.verificationTwo, farmId: ids.farmTwo, cropBatchId: ids.batchTwo, subjectType: "CROP_OBSERVATION", subjectId: ids.observationTwo, taskType: "VERIFY_OBSERVATION", status: "VERIFIED", summary: "Verify Marcus's safe cucumber quantity.", createdAt: at("2026-09-04T08:02:30Z"), resolvedBy: ids.coordinator, resolvedAt: at("2026-09-04T08:06:00Z"), note: "Quantity and crop stage confirmed." },
    ],
  });

  await prisma.vehicle.create({
    data: { id: ids.vehicle, transporterId: ids.transporter, label: "Daniel's refrigerated van", registrationNumber: "SLU-TRK-01", capacityKg: 350, status: "AVAILABLE" },
  });

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
        estimationMode: "DETERMINISTIC_FALLBACK",
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
    update: { lifecycleStatus: "AWAITING_APPROVAL", atRisk: false, activeExceptionIds: [], cropStandardId: ids.cucumberStandard, traceId: ids.trace },
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
      cropStandardId: ids.cucumberStandard,
      traceId: ids.trace,
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
  await prisma.approval.deleteMany({ where: { subjectType: "ALLOCATION", subjectId: ids.allocation } });
  await prisma.approval.createMany({
    data: [
      { id: ids.buyerApproval, subjectType: "ALLOCATION", subjectId: ids.allocation, requestedFromActorId: ids.buyer, status: "PENDING", requestedAt: at("2026-09-04T08:13:00Z") },
      { id: ids.farmerOneApproval, subjectType: "ALLOCATION", subjectId: ids.allocation, requestedFromActorId: ids.farmerOne, status: "PENDING", requestedAt: at("2026-09-04T08:13:00Z") },
      { id: ids.farmerTwoApproval, subjectType: "ALLOCATION", subjectId: ids.allocation, requestedFromActorId: ids.farmerTwo, status: "PENDING", requestedAt: at("2026-09-04T08:13:00Z") },
    ],
  });

  // Synthetic history: one finished delivery from the previous week that was
  // only partly accepted, so the demo opens with a real actionable reason and
  // a next action the farmer can follow. Every row here is disposable seed data.
  await prisma.order.upsert({
    where: { id: ids.historicOrder },
    update: { lifecycleStatus: "PARTIALLY_FULFILLED", acceptedQuantity: 9, outcomeCause: "DELIVERY_REJECTED", outcomeNote: "3 kg of 12 kg rejected at delivery (SIZE_OR_GRADE): three kilograms were below the agreed size." },
    create: {
      id: ids.historicOrder,
      buyerId: ids.buyer,
      cropType: "CUCUMBER",
      requestedQuantity: 12,
      acceptedQuantity: 9,
      neededBy: at("2026-08-28T15:00:00Z"),
      latitude: 14.0101,
      longitude: -60.9875,
      listingIds: [ids.listingOne],
      lifecycleStatus: "PARTIALLY_FULFILLED",
      atRisk: false,
      activeExceptionIds: [],
      outcomeCause: "DELIVERY_REJECTED",
      outcomeNote: "3 kg of 12 kg rejected at delivery (SIZE_OR_GRADE): three kilograms were below the agreed size.",
      createdAt: at("2026-08-27T08:00:00Z"),
    },
  });
  await prisma.allocation.upsert({
    where: { id: ids.historicAllocation },
    update: { status: "APPROVED" },
    create: { id: ids.historicAllocation, orderId: ids.historicOrder, status: "APPROVED", createdAt: at("2026-08-27T08:05:00Z") },
  });
  await prisma.allocationLine.deleteMany({ where: { allocationId: ids.historicAllocation } });
  await prisma.allocationLine.create({
    data: { allocationId: ids.historicAllocation, cropBatchId: ids.batchOne, listingId: ids.listingOne, quantity: 12 },
  });
  await prisma.approval.createMany({
    data: [
      { id: ids.historicBuyerApproval, subjectType: "ALLOCATION", subjectId: ids.historicAllocation, requestedFromActorId: ids.buyer, status: "APPROVED", requestedAt: at("2026-08-27T08:05:00Z"), decidedBy: ids.buyer, decidedAt: at("2026-08-27T08:20:00Z"), reason: "Quantity and collection window confirmed." },
      { id: ids.historicFarmerApproval, subjectType: "ALLOCATION", subjectId: ids.historicAllocation, requestedFromActorId: ids.farmerOne, status: "APPROVED", requestedAt: at("2026-08-27T08:05:00Z"), decidedBy: ids.farmerOne, decidedAt: at("2026-08-27T08:25:00Z"), reason: "Twelve kilograms can be picked safely." },
    ],
  });
  await prisma.deliveryMission.create({
    data: {
      id: ids.historicMission,
      orderId: ids.historicOrder,
      status: "DELIVERED",
      transporterId: ids.transporter,
      vehicleId: ids.vehicle,
      quantity: 12,
      deadline: at("2026-08-28T15:00:00Z"),
      currentStopSequence: 2,
      stops: [
        { sequence: 1, kind: "PICKUP", farmId: ids.farmOne, cropBatchIds: [ids.batchOne], quantity: { value: 12, unit: "kg" }, location: { latitude: 13.953, longitude: -61.005 } },
        { sequence: 2, kind: "DROPOFF", quantity: { value: 12, unit: "kg" }, location: { latitude: 14.0101, longitude: -60.9875 } },
      ],
      estimatedDistanceKm: 18.4,
      estimatedDurationMinutes: 41,
      estimatedArrival: at("2026-08-28T13:40:00Z"),
    },
  });
  await prisma.deliveryUpdate.createMany({
    data: [
      { id: "29292929-2929-4929-8929-292929292921", missionId: ids.historicMission, updateType: "ARRIVED", recordedAt: at("2026-08-28T12:30:00Z"), stopSequence: 1, note: "Arrived at Roseau Valley Farm." },
      { id: "29292929-2929-4929-8929-292929292922", missionId: ids.historicMission, updateType: "PICKED_UP", recordedAt: at("2026-08-28T12:45:00Z"), stopSequence: 1, quantity: 12 },
      { id: "29292929-2929-4929-8929-292929292923", missionId: ids.historicMission, updateType: "ARRIVED", recordedAt: at("2026-08-28T13:35:00Z"), stopSequence: 2, note: "Arrived at the hotel loading bay." },
      { id: "29292929-2929-4929-8929-292929292924", missionId: ids.historicMission, updateType: "DELIVERED", recordedAt: at("2026-08-28T13:45:00Z"), stopSequence: 2, quantity: 12 },
    ],
  });
  await prisma.deliveryAcceptance.create({
    data: {
      id: ids.historicAcceptance,
      orderId: ids.historicOrder,
      outcome: "PARTIALLY_ACCEPTED",
      acceptedQuantity: 9,
      rejectedQuantity: 3,
      note: "Three kilograms were below the agreed size.",
      reasonCode: "SIZE_OR_GRADE",
      nextAction: "Grade cucumbers to at least 15 cm before the next pickup and keep smaller fruit for the local market.",
      acceptedBy: ids.buyer,
      acceptedAt: at("2026-08-28T14:05:00Z"),
      lineOutcomes: [
        {
          cropBatchId: ids.batchOne,
          acceptedQuantity: { value: 9, unit: "kg" },
          rejectedQuantity: { value: 3, unit: "kg" },
          reasonCode: "SIZE_OR_GRADE",
          nextAction: "Grade cucumbers to at least 15 cm before the next pickup and keep smaller fruit for the local market.",
        },
      ],
    },
  });

  await prisma.agentTrace.upsert({
    where: { id: ids.trace },
    update: { status: "AWAITING_APPROVAL", workflowType: "ORDER_FULFILMENT", stage: "ALLOCATION_PROPOSED" },
    create: {
      id: ids.trace,
      subjectType: "ORDER",
      subjectId: ids.order,
      status: "AWAITING_APPROVAL",
      workflowType: "ORDER_FULFILMENT",
      stage: "ALLOCATION_PROPOSED",
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

  await seedIslandWeather();

  const eventBase = {
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

/**
 * A week of realised weather for the development island, and the forecast each
 * of those days issued.
 *
 * Built with the simulation's own `WeatherModel` rather than by hand, so the
 * seeded world and a saved run are the same weather implementation and cannot
 * drift apart. Days after `LAST_SEEDED_DAY` are generated because a forecast
 * needs something to approximate, and are then deliberately not stored: the
 * table holds only days that have occurred, which is what makes it structurally
 * unable to leak future weather to a participant.
 *
 * Everything written here is SYNTHETIC. No live weather service is contacted.
 */
async function seedIslandWeather() {
  const ISLAND_ID = "saint-lucia";
  const FIRST_SEEDED_DAY = "2026-08-29";
  const LAST_SEEDED_DAY = "2026-09-04";
  const GENERATED_DAYS = 12;

  const startsAt = Date.parse(`${FIRST_SEEDED_DAY}T00:00:00Z`);
  const random = new RandomSource(20260904);
  const rainStream = random.stream("seed:weather:rain");
  const rainfall = new Map<string, number>();
  for (let day = 0; day < GENERATED_DAYS; day += 1) {
    const date = new Date(startsAt + day * 86_400_000).toISOString().slice(0, 10);
    rainfall.set(date, Number(Math.max(0, rainStream.normal(12, 8)).toFixed(2)));
  }

  const model = new WeatherModel({
    islandIds: [ISLAND_ID],
    startsAt,
    days: GENERATED_DAYS,
    rainfallMm: (_islandId, date) => rainfall.get(date) ?? 0,
    realisedStream: random.stream("seed:weather:realised"),
    forecastStream: random.stream("seed:weather:forecast"),
  });

  const rows = model.dates
    .filter((date) => date <= LAST_SEEDED_DAY)
    .map((date) => {
      const realised = model.truthOn(ISLAND_ID, date);
      if (!realised) return null;
      return {
        islandId: ISLAND_ID,
        observedOn: at(`${date}T00:00:00Z`),
        condition: realised.condition,
        rainMm: realised.rainMm,
        windKph: realised.windKph,
        windFromDegrees: realised.windFromDegrees,
        cloudCoverFraction: realised.cloudCoverFraction,
        tempBand: realised.tempBand,
        provenance: Provenance.SYNTHETIC,
        forecast: model.forecastIssuedOn(ISLAND_ID, date).map((day) => ({ ...day, provenance: Provenance.MODEL_PREDICTED })),
        forecastProvenance: Provenance.MODEL_PREDICTED,
        simulationRunId: null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  await prisma.weatherObservation.createMany({ data: rows, skipDuplicates: true });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
