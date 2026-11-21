/**
 * sessionLog.ts appends per-aim-session metrics tagged with the sens/DPI in effect.
 * Best-score storage alone cannot fit S*(G); these rows supply L1 longitudinal data
 * and the drift monitor baseline after calibration. Persistence is local-first: every
 * finished round is written to localStorage immediately, then upserted to aim_sessions
 * when a user is signed in so devices converge without mixing into cognitive drill scores.
 */

import type { VisOrderEventSource } from "@/lib/visorder-events";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cm360FromSens } from "../core/gain";
import { findProfile } from "./profiles";
import type { SensitivitySettings } from "./settings";

/** One finished aim round with the Control-Display context used while playing. */
export type AimSessionLogEntry = {
  /** Client-generated UUID used as the idempotent sync key (maps to client_id). */
  id: string;
  source: Extract<VisOrderEventSource, "aim">;
  modeId: string;
  profileId: string;
  sensitivity: number;
  dpi: number | null;
  /** Null when DPI was unset at play time. */
  cm360: number | null;
  score: number;
  hits: number;
  shots: number;
  accuracy: number;
  avgKillTime: number | null;
  completedAt: number;
};

/** Soft cap keeps local longitudinal history useful without unbounded growth. */
const KEY = "aim-trainer-web.session-log";
/** Soft cap keeps local longitudinal history useful without unbounded growth. */
const MAX_ENTRIES = 200;
/** Cloud table matching supabase/migrations aim_sessions. */
const TABLE = "aim_sessions";

/** Row shape returned from public.aim_sessions selects. */
type CloudAimSessionRow = {
  client_id: string;
  source: string;
  mode_id: string;
  profile_id: string;
  sensitivity: number;
  dpi: number | null;
  cm360: number | null;
  score: number;
  hits: number;
  shots: number;
  accuracy: number;
  avg_kill_time: number | null;
  completed_at: string;
};

/**
 * newId returns a UUID, or a time-based token when crypto.randomUUID is missing.
 */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `aim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * isEntry validates persisted objects before they enter the in-memory list.
 */
function isEntry(value: unknown): value is AimSessionLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    c.source === "aim" &&
    typeof c.modeId === "string" &&
    typeof c.profileId === "string" &&
    typeof c.sensitivity === "number" &&
    typeof c.score === "number" &&
    typeof c.completedAt === "number"
  );
}

/**
 * writeEntries replaces the local aim session log, trimming to MAX_ENTRIES.
 */
function writeEntries(entries: AimSessionLogEntry[]): AimSessionLogEntry[] {
  const next = entries.slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore quota failures; gameplay continues with the in-memory return value.
  }
  return next;
}

/**
 * readAimSessionLog returns recent aim rounds newest-last (append order).
 */
export function readAimSessionLog(): AimSessionLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

/**
 * Payload for one finished round; sens/DPI default from settings.
 * Optional sensitivity/cm360 override records a live probe gain that differs
 * from saved settings so longitudinal fits see the true Control-Display gain.
 */
export type AimSessionLogInput = {
  modeId: string;
  score: number;
  hits: number;
  shots: number;
  accuracy: number;
  avgKillTime: number | null;
  completedAt: number;
  settings: SensitivitySettings;
  /** When set, logged instead of settings.sensitivity (route-C probe rounds). */
  sensitivityOverride?: number;
  /** When set, logged instead of computing from settings (route-C probe rounds). */
  cm360Override?: number | null;
};

/**
 * toCloudPayload maps a local aim log entry into the aim_sessions upsert body.
 */
function toCloudPayload(entry: AimSessionLogEntry, userId: string) {
  return {
    user_id: userId,
    client_id: entry.id,
    source: entry.source,
    mode_id: entry.modeId,
    profile_id: entry.profileId,
    sensitivity: entry.sensitivity,
    dpi: entry.dpi,
    cm360: entry.cm360,
    score: entry.score,
    hits: entry.hits,
    shots: entry.shots,
    accuracy: entry.accuracy,
    avg_kill_time: entry.avgKillTime,
    completed_at: new Date(entry.completedAt).toISOString(),
  };
}

/**
 * fromCloudRow converts an aim_sessions row back into AimSessionLogEntry.
 * Non-aim source values are rejected so this table cannot absorb other event kinds.
 */
function fromCloudRow(row: CloudAimSessionRow): AimSessionLogEntry | null {
  if (row.source !== "aim") return null;
  return {
    id: row.client_id,
    source: "aim",
    modeId: row.mode_id,
    profileId: row.profile_id,
    sensitivity: row.sensitivity,
    dpi: row.dpi,
    cm360: row.cm360,
    score: row.score,
    hits: row.hits,
    shots: row.shots,
    accuracy: row.accuracy,
    avgKillTime: row.avg_kill_time,
    completedAt: new Date(row.completed_at).getTime(),
  };
}

/**
 * mergeEntriesById unions local and remote rows keyed by client id.
 * When both sides share an id, the newer completedAt wins so edits stay consistent.
 */
function mergeEntriesById(
  local: AimSessionLogEntry[],
  remote: AimSessionLogEntry[],
): AimSessionLogEntry[] {
  const byId = new Map<string, AimSessionLogEntry>();
  for (const entry of [...local, ...remote]) {
    const existing = byId.get(entry.id);
    if (!existing || entry.completedAt >= existing.completedAt) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => a.completedAt - b.completedAt);
}

/**
 * pushAimSessionToCloud upserts one local aim round for the signed-in user.
 * No-ops when logged out; swallows network errors so practice stays uninterrupted.
 */
export async function pushAimSessionToCloud(
  entry: AimSessionLogEntry,
): Promise<void> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from(TABLE)
      .upsert(toCloudPayload(entry, user.id), { onConflict: "user_id,client_id" });
    if (error) {
      console.warn("aim-session-log: cloud push failed", error.message);
    }
  } catch (error) {
    console.warn("aim-session-log: cloud push unavailable", error);
  }
}

/**
 * appendAimSessionLog records one finished round locally, then syncs when signed in.
 * Returns the stored entry so callers can inspect cm360 without re-reading storage.
 */
export function appendAimSessionLog(partial: AimSessionLogInput): AimSessionLogEntry {
  const profile = findProfile(partial.settings.profileId);
  const sensitivity =
    partial.sensitivityOverride ?? partial.settings.sensitivity;
  const cm360 =
    partial.cm360Override !== undefined
      ? partial.cm360Override
      : cm360FromSens(profile, sensitivity, partial.settings.dpi);
  const entry: AimSessionLogEntry = {
    id: newId(),
    source: "aim",
    modeId: partial.modeId,
    profileId: partial.settings.profileId,
    sensitivity,
    dpi: partial.settings.dpi,
    cm360,
    score: partial.score,
    hits: partial.hits,
    shots: partial.shots,
    accuracy: partial.accuracy,
    avgKillTime: partial.avgKillTime,
    completedAt: partial.completedAt,
  };
  writeEntries([...readAimSessionLog(), entry]);
  void pushAimSessionToCloud(entry);
  return entry;
}

/**
 * pullAndMergeAimSessions downloads cloud aim logs, merges with local, and backfills.
 * Call after sign-in and on /aim mount when logged in; returns local-only when offline.
 */
export async function pullAndMergeAimSessions(): Promise<AimSessionLogEntry[]> {
  const local = readAimSessionLog();
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return local;

    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "client_id,source,mode_id,profile_id,sensitivity,dpi,cm360,score,hits,shots,accuracy,avg_kill_time,completed_at",
      )
      .order("completed_at", { ascending: true });

    if (error) {
      console.warn("aim-session-log: cloud pull failed", error.message);
      return local;
    }

    const remote: AimSessionLogEntry[] = [];
    for (const row of (data ?? []) as CloudAimSessionRow[]) {
      const parsed = fromCloudRow(row);
      if (parsed) remote.push(parsed);
    }

    const merged = writeEntries(mergeEntriesById(local, remote));
    const remoteIds = new Set(remote.map((entry) => entry.id));
    const localOnly = merged.filter((entry) => !remoteIds.has(entry.id));
    if (localOnly.length > 0) {
      const payload = localOnly.map((entry) => toCloudPayload(entry, user.id));
      const { error: upsertError } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: "user_id,client_id" });
      if (upsertError) {
        console.warn("aim-session-log: cloud backfill failed", upsertError.message);
      }
    }
    return merged;
  } catch (error) {
    console.warn("aim-session-log: merge unavailable", error);
    return local;
  }
}
