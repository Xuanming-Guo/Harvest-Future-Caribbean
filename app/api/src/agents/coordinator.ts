import type { Approval } from "@prisma/client";

import { approveAllocation, produceFixturePrediction, proposeAllocation, rejectApproval } from "../workflows.js";
import type { CropObservationPromptInput, RecoveryExplanationPromptInput } from "./prompts.js";
import { createAgentTextAdapter } from "./text-adapter.js";

export function createAgentCoordinator() {
  const textAdapter = createAgentTextAdapter();

  return {
    textAdapterName: textAdapter.name,
    draftCropObservation: (input: CropObservationPromptInput) => textAdapter.extractCropObservation(input),
    refreshCropIntelligence: produceFixturePrediction,
    matchOrder: proposeAllocation,
    decideApproval: (approvalId: string, actorId: string, decision: "APPROVE" | "REJECT", reason?: string): Promise<Approval> =>
      decision === "APPROVE"
        ? approveAllocation(approvalId, actorId, reason)
        : rejectApproval(approvalId, actorId, reason),
    explainDelayRecovery: (input: RecoveryExplanationPromptInput) => textAdapter.explainRecovery(input),
  };
}
