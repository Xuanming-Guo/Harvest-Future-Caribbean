/**
 * The discrete-event queue.
 *
 * The engine advances by jumping to the next scheduled event rather than
 * ticking a fixed interval, so a three-week scenario costs only as much as the
 * events in it.
 *
 * Ordering must be a *total* order. A heap keyed on time alone leaves ties
 * broken by whatever order the heap happens to sift them into, which is stable
 * for a given build but not something to rely on; two events at the same
 * instant could then swap places and change the outcome. Every entry therefore
 * carries a monotonic sequence number, and ties fall back to priority and then
 * to insertion order.
 */

import { formatInstant } from './time.js';

/** Lower runs first when two events share an instant. */
export enum Priority {
  /** World-state changes that later handlers in the same instant should see. */
  World = 0,
  /** Actor behaviour and policy decisions. */
  Actor = 1,
  /** Bookkeeping, metric capture, and end-of-instant sweeps. */
  Observation = 2,
}

export interface ScheduledEvent<TPayload = unknown> {
  /** Simulation time in epoch milliseconds. */
  readonly at: number;
  readonly type: string;
  readonly priority: Priority;
  readonly payload: TPayload;
  /** Assigned on push; the final tie-breaker. */
  readonly sequence: number;
}

/** Ordering predicate: is `a` strictly earlier in the queue than `b`? */
function isBefore(a: ScheduledEvent, b: ScheduledEvent): boolean {
  if (a.at !== b.at) return a.at < b.at;
  if (a.priority !== b.priority) return a.priority < b.priority;
  return a.sequence < b.sequence;
}

/**
 * A binary min-heap.
 *
 * Deliberately hand-rolled: the alternative is sorting an array on every push,
 * which turns a long scenario quadratic, and a dependency for thirty lines of
 * well-understood code is a poor trade in a hackathon repository.
 */
export class EventQueue {
  private readonly heap: ScheduledEvent[] = [];
  private nextSequence = 0;

  get size(): number {
    return this.heap.length;
  }

  get isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /**
   * Schedules an event. Returns the assigned sequence number.
   *
   * Scheduling into the past is rejected rather than silently clamped: it
   * always means a handler computed a negative delay, and a clamp would hide
   * that behind plausible-looking output.
   */
  push<TPayload>(event: Omit<ScheduledEvent<TPayload>, 'sequence'>, notBefore?: number): number {
    if (!Number.isFinite(event.at)) {
      throw new RangeError(`Event '${event.type}' was scheduled at a non-finite time.`);
    }
    if (notBefore !== undefined && event.at < notBefore) {
      throw new RangeError(
        `Event '${event.type}' was scheduled for ${formatInstant(event.at)}, ` +
          `which is before the current simulation time ${formatInstant(notBefore)}.`,
      );
    }

    const sequence = this.nextSequence;
    this.nextSequence += 1;

    const entry: ScheduledEvent<TPayload> = { ...event, sequence };
    this.heap.push(entry as ScheduledEvent);
    this.siftUp(this.heap.length - 1);
    return sequence;
  }

  /** The next event without removing it. */
  peek(): ScheduledEvent | undefined {
    return this.heap[0];
  }

  /** Removes and returns the next event. */
  pop(): ScheduledEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0] as ScheduledEvent;
    const last = this.heap.pop() as ScheduledEvent;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /**
   * Drops every queued event matching a predicate, returning how many went.
   *
   * Used when a disruption cancels work that was already on the schedule, for
   * example pickups belonging to a cancelled order.
   */
  removeWhere(predicate: (event: ScheduledEvent) => boolean): number {
    const survivors = this.heap.filter((event) => !predicate(event));
    const removed = this.heap.length - survivors.length;
    if (removed === 0) return 0;

    // Rebuild rather than repair in place: re-heapifying a filtered array is
    // simpler to reason about than a sequence of sift operations, and this runs
    // rarely enough that the cost does not matter.
    this.heap.length = 0;
    for (const event of survivors) {
      this.heap.push(event);
      this.siftUp(this.heap.length - 1);
    }
    return removed;
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!isBefore(this.heap[index] as ScheduledEvent, this.heap[parent] as ScheduledEvent)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.heap.length && isBefore(this.heap[left] as ScheduledEvent, this.heap[smallest] as ScheduledEvent)) {
        smallest = left;
      }
      if (right < this.heap.length && isBefore(this.heap[right] as ScheduledEvent, this.heap[smallest] as ScheduledEvent)) {
        smallest = right;
      }
      if (smallest === index) break;

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(left: number, right: number): void {
    const temporary = this.heap[left] as ScheduledEvent;
    this.heap[left] = this.heap[right] as ScheduledEvent;
    this.heap[right] = temporary;
  }
}
