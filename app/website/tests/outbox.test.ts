import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiProblem } from "@/lib/api";
import {
  enqueueOutboxItem,
  flushOutbox,
  readOutbox,
  type ListingBody,
  type ObservationBody,
  type OutboxBatchState,
  type OutboxItem,
  type OutboxTransport,
} from "@/lib/outbox";

const farmer = { authSubject: "farmer-ana" };
const replayFarmer = { authSubject: "farmer-ana", readOnly: true };

const CUCUMBER = "10101010-1010-4010-8010-101010101010";
const TOMATO = "20202020-2020-4020-8020-202020202020";
const BASE_OBSERVATION = "30303030-3030-4030-8030-303030303030";
const NEW_OBSERVATION = "40404040-4040-4040-8040-404040404040";

function observation(quantity: number): ObservationBody {
  return {
    cropBatchId: CUCUMBER,
    observedAt: "2026-09-02T09:00:00.000Z",
    cropStage: "HARVEST_READY",
    estimatedQuantity: { value: quantity, unit: "kg" },
    provenance: "OBSERVED",
  };
}

function listing(quantity: number): ListingBody {
  return {
    cropBatchId: CUCUMBER,
    quantity: { value: quantity, unit: "kg" },
    unitPrice: { amount: 7.5, currency: "XCD" },
    availableFrom: "2026-09-03",
    availableUntil: "2026-09-08",
  };
}

function batchState(overrides: Partial<OutboxBatchState> = {}): OutboxBatchState {
  return { status: "HARVEST_READY", latestObservationId: BASE_OBSERVATION, availableToPromise: { value: 30 }, ...overrides };
}

/** A transport whose sends and crop-batch reads are fully controlled by a test. */
function transportWith(send: OutboxTransport["send"], batch: (cropBatchId: string) => OutboxBatchState): OutboxTransport {
  return { send, cropBatch: async (cropBatchId) => batch(cropBatchId) };
}

const lostConnection = () => new TypeError("Failed to fetch");
const sentKeys = (send: { mock: { calls: [OutboxItem][] } }) => send.mock.calls.map(([item]) => item.idempotencyKey);

beforeEach(() => window.localStorage.clear());

describe("offline write queue", () => {
  it("keeps one idempotency key so a retry after reconnecting posts the update exactly once", async () => {
    const send = vi.fn<OutboxTransport["send"]>()
      .mockRejectedValueOnce(lostConnection())
      .mockResolvedValueOnce({ observationId: NEW_OBSERVATION });
    const transport = transportWith(send, () => batchState());
    const queued = enqueueOutboxItem(farmer, {
      kind: "observation",
      cropBatchId: CUCUMBER,
      body: observation(20),
      baseObservationId: BASE_OBSERVATION,
    });

    expect(queued?.status).toBe("saved");
    expect(queued?.path).toBe("/v1/crop-observations");

    await flushOutbox(farmer, transport);
    expect(readOutbox(farmer)[0].status).toBe("waiting");

    await flushOutbox(farmer, transport);
    expect(readOutbox(farmer)[0].status).toBe("synced");

    // A third pass must not resend an update the Product API already stored.
    await flushOutbox(farmer, transport);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sentKeys(send)).toEqual([queued!.idempotencyKey, queued!.idempotencyKey]);
  });

  it("holds a crop update for review when the crop batch moved on while the device was offline", async () => {
    const send = vi.fn<OutboxTransport["send"]>();
    const transport = transportWith(send, () => batchState({ latestObservationId: NEW_OBSERVATION }));
    enqueueOutboxItem(farmer, {
      kind: "observation",
      cropBatchId: CUCUMBER,
      body: observation(20),
      baseObservationId: BASE_OBSERVATION,
    });

    const [item] = await flushOutbox(farmer, transport);
    expect(item.status).toBe("attention");
    expect(item.error).toMatch(/changed after you wrote the update/);
    expect(send).not.toHaveBeenCalled();
  });

  it("holds a marketplace offer for review when the crop can no longer cover it", async () => {
    const send = vi.fn<OutboxTransport["send"]>();
    const soldOut = transportWith(send, () => batchState({ availableToPromise: { value: 6 } }));
    enqueueOutboxItem(farmer, { kind: "listing", cropBatchId: CUCUMBER, body: listing(12) });

    const [tooLarge] = await flushOutbox(farmer, soldOut);
    expect(tooLarge.status).toBe("attention");
    expect(tooLarge.error).toMatch(/Only 6 kg is still safe to promise/);

    window.localStorage.clear();
    const growing = transportWith(send, () => batchState({ status: "GROWING" }));
    enqueueOutboxItem(farmer, { kind: "listing", cropBatchId: CUCUMBER, body: listing(12) });

    const [notReady] = await flushOutbox(farmer, growing);
    expect(notReady.status).toBe("attention");
    expect(notReady.error).toMatch(/now growing/);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends queued writes in the order they were written and stops at the first lost connection", async () => {
    const send = vi.fn<OutboxTransport["send"]>()
      .mockResolvedValueOnce({ observationId: NEW_OBSERVATION })
      .mockRejectedValueOnce(lostConnection());
    const transport = transportWith(send, () => batchState({ latestObservationId: undefined }));
    const first = enqueueOutboxItem(farmer, { kind: "observation", cropBatchId: CUCUMBER, body: observation(20) });
    const second = enqueueOutboxItem(farmer, { kind: "observation", cropBatchId: TOMATO, body: observation(14) });
    const third = enqueueOutboxItem(farmer, { kind: "listing", cropBatchId: TOMATO, body: listing(10) });

    const items = await flushOutbox(farmer, transport);
    expect(items.map((item) => item.id)).toEqual([first!.id, second!.id, third!.id]);
    expect(items.map((item) => item.status)).toEqual(["synced", "waiting", "waiting"]);
    expect(sentKeys(send)).toEqual([first!.idempotencyKey, second!.idempotencyKey]);
  });

  it("moves a later update onto the head its own queued predecessor created", async () => {
    // The Product API moves the crop batch head on when the first update lands.
    let head: string | undefined = BASE_OBSERVATION;
    const send = vi.fn<OutboxTransport["send"]>().mockImplementation(async () => {
      head = NEW_OBSERVATION;
      return { observationId: NEW_OBSERVATION };
    });
    const transport = transportWith(send, () => batchState({ latestObservationId: head }));
    enqueueOutboxItem(farmer, { kind: "observation", cropBatchId: CUCUMBER, body: observation(20), baseObservationId: BASE_OBSERVATION });
    enqueueOutboxItem(farmer, { kind: "observation", cropBatchId: CUCUMBER, body: observation(18), baseObservationId: BASE_OBSERVATION });

    const items = await flushOutbox(farmer, transport);
    expect(items.map((item) => item.status)).toEqual(["synced", "synced"]);
    expect(items[1].baseObservationId).toBe(NEW_OBSERVATION);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("marks a refused write for attention instead of retrying it forever", async () => {
    const send = vi.fn<OutboxTransport["send"]>()
      .mockRejectedValue(new ApiProblem("Estimated quantity must be positive.", 422, "VALIDATION_FAILED"));
    const transport = transportWith(send, () => batchState({ latestObservationId: undefined }));
    enqueueOutboxItem(farmer, { kind: "observation", cropBatchId: CUCUMBER, body: observation(0) });

    const [item] = await flushOutbox(farmer, transport);
    expect(item.status).toBe("attention");
    expect(item.error).toBe("Estimated quantity must be positive.");

    await flushOutbox(farmer, transport);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("never queues or sends a write for a read-only simulation replay", async () => {
    const send = vi.fn<OutboxTransport["send"]>();
    const transport = transportWith(send, () => batchState());

    expect(enqueueOutboxItem(replayFarmer, { kind: "observation", cropBatchId: CUCUMBER, body: observation(20) })).toBeNull();
    expect(enqueueOutboxItem(replayFarmer, { kind: "listing", cropBatchId: CUCUMBER, body: listing(10) })).toBeNull();
    expect(readOutbox(replayFarmer)).toEqual([]);
    expect(window.localStorage.length).toBe(0);

    await expect(flushOutbox(replayFarmer, transport)).resolves.toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps each signed-in identity's queue to itself", async () => {
    const otherFarmer = { authSubject: "farmer-jean" };
    enqueueOutboxItem(farmer, { kind: "observation", cropBatchId: CUCUMBER, body: observation(20) });

    expect(readOutbox(farmer)).toHaveLength(1);
    expect(readOutbox(otherFarmer)).toEqual([]);
  });
});
