import type {
  AgentTrace,
  Approval,
  BuyerDemand,
  CropBatch,
  CropObservationIntake,
  CropStandard,
  DeliveryAcceptance,
  DeliveryMission,
  DeliveryUpdate,
  Listing,
  OperationalException,
  Order,
  TraceStep,
  Vehicle,
  VerificationTask,
  YieldPrediction,
} from "@prisma/client";

import { derivePaymentStatus, PAYMENT_DAY_MS, type PaymentStatus } from "./payments.js";

export const quantity = (value: number) => ({ value, unit: "kg" as const });
export const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

const DAY_MS = PAYMENT_DAY_MS;

export interface OrderPaymentDto {
  status: PaymentStatus;
  amount?: { amount: number; currency: string };
  dueAt?: string;
  paidAt?: string;
  reference?: string;
  daysOutstanding?: number;
}

/**
 * Payment status is derived on every read rather than stored, so no scheduled
 * job can leave a farmer looking at a stale "not due" while the term has in
 * fact expired. Only `paidAt` is recorded, and only because a buyer stating it
 * paid is an observation Harvest cannot infer. Harvest tracks payment; it does
 * not move money.
 */
export function orderPaymentDto(
  order: Pick<Order, "lifecycleStatus" | "paymentTermsDays" | "paymentAmount" | "paymentCurrency" | "paidAt" | "paymentReference">,
  acceptedAt: Date | null,
  now: Date,
): OrderPaymentDto | undefined {
  // Nothing is owed until a commitment prices the order, and a cancelled
  // commitment releases the obligation with it.
  if (order.paymentAmount === null || order.lifecycleStatus === "CANCELLED") return undefined;
  const dueAt = acceptedAt ? new Date(acceptedAt.getTime() + order.paymentTermsDays * DAY_MS) : null;
  const settledAt = order.paidAt ?? now;
  const status = derivePaymentStatus(order, acceptedAt, now);
  return {
    status,
    amount: { amount: order.paymentAmount, currency: order.paymentCurrency ?? "XCD" },
    ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    ...(order.paidAt ? { paidAt: order.paidAt.toISOString() } : {}),
    ...(order.paymentReference ? { reference: order.paymentReference } : {}),
    ...(acceptedAt
      ? { daysOutstanding: Math.max(0, Math.floor((settledAt.getTime() - acceptedAt.getTime()) / DAY_MS)) }
      : {}),
  };
}

/** Latest actionable rejection shown to the farmer who owns the batch. */
export interface BatchDecision {
  source: "VERIFICATION" | "DELIVERY";
  decidedAt: Date;
  reasonCode: string | null;
  nextAction: string | null;
  note: string | null;
}

export function cropBatchDto(row: CropBatch, verificationStatus = "UNVERIFIED", latestDecision?: BatchDecision) {
  return {
    cropBatchId: row.id,
    farmId: row.farmId,
    cropType: row.cropType,
    status: row.status,
    ...(row.latestObservationId ? { latestObservationId: row.latestObservationId } : {}),
    ...(row.latestPredictionId ? { latestPredictionId: row.latestPredictionId } : {}),
    availableToPromise: quantity(row.availableToPromise),
    provenance: row.provenance,
    verificationStatus,
    ...(latestDecision
      ? {
          latestDecision: {
            source: latestDecision.source,
            decidedAt: latestDecision.decidedAt.toISOString(),
            ...(latestDecision.reasonCode ? { reasonCode: latestDecision.reasonCode } : {}),
            ...(latestDecision.nextAction ? { nextAction: latestDecision.nextAction } : {}),
            ...(latestDecision.note ? { note: latestDecision.note } : {}),
          },
        }
      : {}),
  };
}

export function cropStandardDto(row: CropStandard, publisherName: string) {
  return {
    standardId: row.id,
    cropType: row.cropType,
    publisherActorId: row.publisherActorId,
    publisherName,
    version: row.version,
    status: row.status,
    reviewedAt: row.reviewedAt.toISOString(),
    geography: row.geography,
    source: row.source,
    checklist: row.checklist,
    images: row.images,
    guidance: row.guidance,
  };
}

export function cropObservationIntakeDto(row: CropObservationIntake) {
  return {
    intakeId: row.id,
    cropBatchId: row.cropBatchId,
    observedAt: row.observedAt.toISOString(),
    sourceType: row.sourceType,
    status: row.status,
    draft: {
      suggestedCropStage: row.suggestedCropStage,
      ...(row.suggestedQuantity !== null ? { suggestedEstimatedQuantity: quantity(row.suggestedQuantity) } : {}),
      ...(row.suggestedNotes ? { suggestedNotes: row.suggestedNotes } : {}),
      fieldConfidence: row.fieldConfidence,
      confidence: row.confidence,
      warnings: row.warnings,
    },
    promptId: row.promptId,
    adapter: row.adapter,
    provenance: row.provenance,
    traceId: row.traceId,
    createdAt: row.createdAt.toISOString(),
    ...(row.confirmedObservationId ? { confirmedObservationId: row.confirmedObservationId } : {}),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
  };
}

export function listingDto(row: Listing) {
  return {
    listingId: row.id,
    cropBatchId: row.cropBatchId,
    farmerId: row.farmerId,
    cropType: row.cropType,
    quantity: quantity(row.quantity),
    unitPrice: { amount: row.unitPrice, currency: row.currency },
    availableFrom: dateOnly(row.availableFrom),
    availableUntil: dateOnly(row.availableUntil),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function demandDto(row: BuyerDemand) {
  return {
    demandId: row.id,
    buyerId: row.buyerId,
    cropType: row.cropType,
    quantity: quantity(row.quantity),
    neededBy: row.neededBy.toISOString(),
    deliveryLocation: { latitude: row.latitude, longitude: row.longitude },
    ...(row.maxUnitPrice !== null
      ? { maxUnitPrice: { amount: row.maxUnitPrice, currency: row.currency ?? "XCD" } }
      : {}),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function orderDto(row: Order, payment?: OrderPaymentDto) {
  return {
    orderId: row.id,
    buyerId: row.buyerId,
    cropType: row.cropType,
    requestedQuantity: quantity(row.requestedQuantity),
    committedQuantity: quantity(row.committedQuantity),
    acceptedQuantity: quantity(row.acceptedQuantity),
    minimumAcceptableFraction: row.minimumAcceptableFraction,
    paymentTermsDays: row.paymentTermsDays,
    ...(payment ? { payment } : {}),
    neededBy: row.neededBy.toISOString(),
    lifecycleStatus: row.lifecycleStatus,
    atRisk: row.atRisk,
    activeExceptionIds: row.activeExceptionIds as string[],
    ...(row.cropStandardId ? { cropStandardId: row.cropStandardId } : {}),
    ...(row.traceId ? { traceId: row.traceId } : {}),
    ...(row.outcomeCause ? { outcomeCause: row.outcomeCause } : {}),
    ...(row.outcomeNote ? { outcomeNote: row.outcomeNote } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function approvalDto(row: Approval, context?: Record<string, unknown>) {
  return {
    approvalId: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    requestedFromActorId: row.requestedFromActorId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    ...(row.nextAction ? { nextAction: row.nextAction } : {}),
    ...(context ? { context } : {}),
  };
}

export function missionDto(row: DeliveryMission) {
  return {
    missionId: row.id,
    orderId: row.orderId,
    status: row.status,
    ...(row.transporterId ? { transporterId: row.transporterId } : {}),
    ...(row.vehicleId ? { vehicleId: row.vehicleId } : {}),
    quantity: quantity(row.quantity),
    deadline: row.deadline.toISOString(),
    stops: row.stops,
    currentStopSequence: row.currentStopSequence,
    ...(row.estimatedDistanceKm !== null ? { estimatedDistanceKm: row.estimatedDistanceKm } : {}),
    ...(row.estimatedDurationMinutes !== null ? { estimatedDurationMinutes: row.estimatedDurationMinutes } : {}),
    ...(row.estimatedArrival ? { estimatedArrival: row.estimatedArrival.toISOString() } : {}),
  };
}

export function deliveryUpdateDto(row: DeliveryUpdate) {
  const position = row.position && row.position !== null ? row.position : undefined;
  return {
    updateId: row.id,
    missionId: row.missionId,
    updateType: row.updateType,
    recordedAt: row.recordedAt.toISOString(),
    ...(position ? { position } : {}),
    ...(row.quantity !== null ? { quantity: quantity(row.quantity) } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.stopSequence !== null ? { stopSequence: row.stopSequence } : {}),
  };
}

export function exceptionDto(row: OperationalException) {
  return {
    exceptionId: row.id,
    exceptionType: row.exceptionType,
    severity: row.severity,
    affectedEntityIds: row.affectedEntityIds,
    description: row.description,
    status: row.status,
    provenance: row.provenance,
    reportedAt: row.reportedAt.toISOString(),
    ...(row.traceId ? { traceId: row.traceId } : {}),
  };
}

export function exceptionDetailDto(
  row: OperationalException,
  approvalSummary?: Record<string, unknown>,
) {
  return {
    ...exceptionDto(row),
    ...(row.recoveryAction && row.recoverySummary && row.recoveryChanges
      ? {
          recoveryProposal: {
            action: row.recoveryAction,
            summary: row.recoverySummary,
            changes: row.recoveryChanges,
          },
        }
      : {}),
    ...(approvalSummary ? { approvalSummary } : {}),
  };
}

export function verificationTaskDto(row: VerificationTask) {
  return {
    taskId: row.id,
    farmId: row.farmId,
    cropBatchId: row.cropBatchId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    taskType: row.taskType,
    status: row.status,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    ...(row.resolvedBy ? { resolvedBy: row.resolvedBy } : {}),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    ...(row.nextAction ? { nextAction: row.nextAction } : {}),
  };
}

export function vehicleDto(row: Vehicle) {
  return {
    vehicleId: row.id,
    label: row.label,
    ...(row.registrationNumber ? { registrationNumber: row.registrationNumber } : {}),
    ...(row.capacityKg !== null ? { capacity: quantity(row.capacityKg) } : {}),
    status: row.status,
  };
}

export function deliveryAcceptanceDto(row: DeliveryAcceptance) {
  return {
    deliveryId: row.id,
    orderId: row.orderId,
    outcome: row.outcome,
    acceptedQuantity: quantity(row.acceptedQuantity),
    rejectedQuantity: quantity(row.rejectedQuantity),
    lineOutcomes: row.lineOutcomes,
    ...(row.note ? { note: row.note } : {}),
    ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}),
    ...(row.nextAction ? { nextAction: row.nextAction } : {}),
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt.toISOString(),
  };
}

export function predictionDto(row: YieldPrediction) {
  return {
    predictionId: row.id,
    requestId: row.requestId,
    cropBatchId: row.cropBatchId,
    modelVersion: row.modelVersion,
    // provenance stays MODEL_PREDICTED for both methods, so this is the field
    // that keeps a fixture estimate from reading as learned-model output.
    estimationMode: row.estimationMode,
    q10MarketableYield: quantity(row.q10),
    q50MarketableYield: quantity(row.q50),
    q90MarketableYield: quantity(row.q90),
    harvestWindow: { start: dateOnly(row.harvestStart), end: dateOnly(row.harvestEnd) },
    readiness: row.readiness,
    confidence: row.confidence,
    warnings: row.warnings,
    featureSnapshot: row.featureSnapshot,
    provenance: row.provenance,
    generatedAt: row.generatedAt.toISOString(),
    ...(row.actualQuantity !== null
      ? { actualOutcome: quantity(row.actualQuantity) }
      : {}),
    ...(row.absoluteError !== null
      ? { evaluation: { absoluteError: quantity(row.absoluteError), intervalCovered: row.actualQuantity !== null && row.actualQuantity >= row.q10 && row.actualQuantity <= row.q90 } }
      : {}),
  };
}

export function traceDto(trace: AgentTrace, steps: TraceStep[]) {
  return {
    traceId: trace.id,
    subjectType: trace.subjectType,
    subjectId: trace.subjectId,
    status: trace.status,
    workflowType: trace.workflowType,
    stage: trace.stage,
    summary: trace.summary,
    ...(trace.parentTraceId ? { parentTraceId: trace.parentTraceId } : {}),
    createdAt: trace.createdAt.toISOString(),
    updatedAt: trace.updatedAt.toISOString(),
    steps: steps.map((step) => ({
      recordedAt: step.recordedAt.toISOString(),
      kind: step.kind,
      summary: step.summary,
      ...(step.confidence !== null ? { confidence: step.confidence } : {}),
      ...(step.agentName ? { agentName: step.agentName } : {}),
      ...(step.toolName ? { toolName: step.toolName } : {}),
      ...(step.provenance ? { provenance: step.provenance } : {}),
      ...(step.promptId ? { promptId: step.promptId } : {}),
      ...(step.adapter ? { adapter: step.adapter } : {}),
      ...(step.durationMs !== null ? { durationMs: step.durationMs } : {}),
    })),
  };
}

export const pageInfo = { hasNextPage: false };
