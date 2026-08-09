/**
 * The event queue must impose a *total* order. Ties broken arbitrarily would
 * make a run reproducible on one machine and not another, which is the worst
 * kind of determinism bug: it passes CI and fails in the demo.
 */

import { describe, expect, it } from 'vitest';

import { EventQueue, Priority } from '../src/core/queue.js';

describe('EventQueue', () => {
  it('pops events in time order regardless of push order', () => {
    const queue = new EventQueue();
    for (const at of [500, 100, 900, 300, 700]) {
      queue.push({ at, type: 'T', priority: Priority.World, payload: at });
    }

    const order: number[] = [];
    while (!queue.isEmpty) order.push((queue.pop() as { payload: number }).payload);

    expect(order).toEqual([100, 300, 500, 700, 900]);
  });

  it('breaks ties on priority, then on insertion order', () => {
    const queue = new EventQueue();
    queue.push({ at: 100, type: 'third', priority: Priority.Observation, payload: 'third' });
    queue.push({ at: 100, type: 'second-b', priority: Priority.Actor, payload: 'second-b' });
    queue.push({ at: 100, type: 'first', priority: Priority.World, payload: 'first' });
    queue.push({ at: 100, type: 'second-a', priority: Priority.Actor, payload: 'second-a' });

    const order: string[] = [];
    while (!queue.isEmpty) order.push((queue.pop() as { payload: string }).payload);

    // World before Actor before Observation; within Actor, insertion order.
    expect(order).toEqual(['first', 'second-b', 'second-a', 'third']);
  });

  it('is stable across many equal-time events', () => {
    const build = () => {
      const queue = new EventQueue();
      for (let index = 0; index < 200; index += 1) {
        queue.push({ at: 1000, type: 'T', priority: Priority.Actor, payload: index });
      }
      const order: number[] = [];
      while (!queue.isEmpty) order.push((queue.pop() as { payload: number }).payload);
      return order;
    };

    expect(build()).toEqual(build());
    expect(build()).toEqual(Array.from({ length: 200 }, (_unused, index) => index));
  });

  it('refuses to schedule into the past', () => {
    const queue = new EventQueue();
    expect(() => queue.push({ at: 50, type: 'late', priority: Priority.World, payload: null }, 100)).toThrow(
      /before the current simulation time/,
    );
  });

  it('rejects a non-finite time rather than corrupting the heap', () => {
    const queue = new EventQueue();
    expect(() => queue.push({ at: Number.NaN, type: 'bad', priority: Priority.World, payload: null })).toThrow(
      /non-finite time/,
    );
  });

  it('removes matching events and keeps the rest ordered', () => {
    const queue = new EventQueue();
    for (const at of [100, 200, 300, 400, 500]) {
      queue.push({ at, type: at % 200 === 0 ? 'drop' : 'keep', priority: Priority.World, payload: at });
    }

    expect(queue.removeWhere((event) => event.type === 'drop')).toBe(2);

    const order: number[] = [];
    while (!queue.isEmpty) order.push((queue.pop() as { payload: number }).payload);
    expect(order).toEqual([100, 300, 500]);
  });

  it('reports size and emptiness accurately', () => {
    const queue = new EventQueue();
    expect(queue.isEmpty).toBe(true);
    expect(queue.peek()).toBeUndefined();
    expect(queue.pop()).toBeUndefined();

    queue.push({ at: 1, type: 'T', priority: Priority.World, payload: null });
    expect(queue.size).toBe(1);
    expect(queue.peek()?.at).toBe(1);
    expect(queue.isEmpty).toBe(false);
  });
});
