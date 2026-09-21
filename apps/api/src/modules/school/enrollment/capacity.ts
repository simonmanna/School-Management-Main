/**
 * Capacity rules (ADR-030, brief §11) — pure arithmetic.
 *
 * Capacity is optional. `null` means unlimited, which is a real configuration a
 * school chooses, not a missing value, and it is never a violation.
 *
 * The one trap worth naming: a learner already sitting in the target counts in
 * its occupancy. A section change inside a full class, or a term rollover that
 * keeps everyone where they are, would otherwise be refused for "overfilling" a
 * seat the learner already holds. Callers pass occupancy EXCLUDING the learner.
 */

export interface SeatTarget {
  /** 'class' or 'section', for messages. */
  kind: 'class' | 'section';
  id: string;
  name: string;
  /** Null = unlimited. */
  capacity: number | null;
  /** Learners currently placed there, NOT counting the learner being placed. */
  occupiedByOthers: number;
}

export interface CapacityViolation {
  kind: 'class' | 'section';
  id: string;
  name: string;
  capacity: number;
  occupied: number;
}

/** Whether placing ONE more learner would exceed `target`. */
export function seatViolation(target: SeatTarget): CapacityViolation | null {
  if (target.capacity === null || target.capacity === undefined) return null;
  if (target.occupiedByOthers + 1 <= target.capacity) return null;
  return {
    kind: target.kind,
    id: target.id,
    name: target.name,
    capacity: target.capacity,
    occupied: target.occupiedByOthers,
  };
}

export function describeViolation(v: CapacityViolation, label = 'Stream'): string {
  const what = v.kind === 'class' ? `Class "${v.name}"` : `${label} "${v.name}"`;
  return `${what} is full (${v.occupied}/${v.capacity}).`;
}

export interface BatchTarget {
  kind: 'class' | 'section';
  id: string;
  name: string;
  capacity: number | null;
  /** Occupancy now, excluding every learner in the batch. */
  openNow: number;
  /** How many learners in the batch are headed here. */
  incoming: number;
}

export interface BatchProjection extends BatchTarget {
  after: number;
  overflow: number;
}

/**
 * Project a whole batch against every target it touches.
 *
 * This is the part row-by-row checking gets wrong: in a bulk move of 41 learners
 * into a class of 40 with nobody in it, every single row passes on its own, and
 * the batch still overflows. The preview reports these aggregates so the
 * overflow is visible before anything is written.
 */
export function projectBatch(targets: BatchTarget[]): BatchProjection[] {
  return targets.map((t) => {
    const after = t.openNow + t.incoming;
    const overflow = t.capacity === null || t.capacity === undefined ? 0 : Math.max(0, after - t.capacity);
    return { ...t, after, overflow };
  });
}
