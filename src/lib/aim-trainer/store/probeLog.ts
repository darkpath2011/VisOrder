/**
 * probeLog.ts persists route-C daily ±5% gain probe outcomes locally.
 * Entries stay device-local for now (no cloud table); they drive UI badges and
 * optional adopt CTAs after onlineProbe evaluation. Soft-capped so longitudinal
 * refinement history cannot grow without bound.
 */

import type { ProbeKind, ProbeVerdict } from "../calib/onlineProbe";
import type { TaskFamily } from "../calib/types";

/** One finished daily probe round with its verdict. */
export type ProbeLogEntry = {
  id: string;
  kind: ProbeKind;
  cm360: number;
  modeId: string;
  proxy: number;
  verdict: ProbeVerdict;
  taskFamily: TaskFamily;
  completedAt: number;
};

const KEY = "aim-trainer-web.probe-log";
/** Soft cap for local probe history used by UI and debugging. */
const MAX_ENTRIES = 80;

/**
 * newId returns a UUID, or a time-based token when crypto.randomUUID is missing.
 */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `probe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * isEntry validates persisted probe rows before returning them to callers.
 */
function isEntry(value: unknown): value is ProbeLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    (c.kind === "baseline" || c.kind === "plus" || c.kind === "minus") &&
    typeof c.cm360 === "number" &&
    typeof c.modeId === "string" &&
    typeof c.proxy === "number" &&
    (c.verdict === "agree" ||
      c.verdict === "worse" ||
      c.verdict === "inconclusive") &&
    (c.taskFamily === "balanced" ||
      c.taskFamily === "flick" ||
      c.taskFamily === "micro") &&
    typeof c.completedAt === "number"
  );
}

/**
 * readProbeLog loads local probe history oldest-first; empty when SSR or missing.
 */
export function readProbeLog(): ProbeLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).sort((a, b) => a.completedAt - b.completedAt);
  } catch {
    return [];
  }
}

/**
 * appendProbeLog stores one probe outcome and trims to MAX_ENTRIES.
 */
export function appendProbeLog(
  partial: Omit<ProbeLogEntry, "id"> & { id?: string },
): ProbeLogEntry {
  const entry: ProbeLogEntry = {
    ...partial,
    id: partial.id ?? newId(),
  };
  const next = [...readProbeLog().filter((row) => row.id !== entry.id), entry]
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors; in-session UI can still show the latest entry.
  }
  return entry;
}
