import type { ApiSchema } from "@harvest/shared";

import { estimationMethodLabel } from "@/lib/format";

/**
 * Read-only statement of which harvest-estimation method produced a forecast,
 * and the version of it.
 *
 * A participant cannot change this: the method is chosen per simulation run in
 * the control room. It is shown because `provenance` reads `MODEL_PREDICTED`
 * for both methods, so without this line a rule-based fixture estimate would
 * be indistinguishable from a learned-model prediction.
 */
export function ForecastMethod({ prediction }: { prediction: ApiSchema<"YieldPredictionEvidence"> }): React.JSX.Element {
  return (
    <div className="split">
      <span>Estimated by</span>
      <strong>{estimationMethodLabel(prediction.estimationMode)} ({prediction.modelVersion})</strong>
    </div>
  );
}
