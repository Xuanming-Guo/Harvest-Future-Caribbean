import type { Approval } from "@prisma/client";

import type { DecisionReason } from "../http.js";
import { approveAllocation, produceFixturePrediction, proposeAllocation, rejectApproval, rematchWaitingOrders } from "../workflows.js";
import type { CropObservationPromptInput, RecoveryExplanationPromptInput } from "./prompts.js";
import { createAgentTextAdapter } from "./text-adapter.js";

export function createAgentCoordinator() {
  const textAdapter = createAgentTextAdapter();

  return {
    textAdapterName: textAdapter.name,
    draftCropObservation: (input: CropObservationPromptInput) => textAdapter.extractCropObservation(input),
    refreshCropIntelligence: produceFixturePrediction,
    matchOrder: proposeAllocation,
    rematchWaitingOrders,
    decideApproval: (approvalId: string, actorId: string, decision: "APPROVE" | "REJECT", reason?: string, decisionReason?: DecisionReason): Promise<Approval> =>
      decision === "APPROVE"
        ? approveAllocation(approvalId, actorId, reason, decisionReason)
        : rejectApproval(approvalId, actorId, reason, decisionReason),
    explainDelayRecovery: (input: RecoveryExplanationPromptInput) => textAdapter.explainRecovery(input),
  };
}
