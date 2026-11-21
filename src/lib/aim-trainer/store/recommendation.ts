/**
 * recommendation.ts persists sensitivity calibration outcomes as cm/360 history.
 * Storing physical gain (not in-game sens) lets profile switches convert via yaw+DPI
 * without re-running the experiment; verified flags whether hold-out passed. Writes
 * are local-first into an append-only list, then upserted to sensitivity_recommendations
 * when signed in so recommendation history syncs across devices separately from settings.
 */

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TaskFamily } from "../calib/types";
import { clampDpi } from "../core/gain";

/** One fitted recommendation ready to convert into the active profile's sens. */
export type SensitivityRecommendation = {
  /** Client-generated UUID used as the idempotent sync key (maps to client_id). */
  id: string;
  /** Point estimate in cm/360 (lower = higher gain). */
  cm360: number;
  /** Lower bound of the suggested cm/360 interval. */
  cm360Low: number;
  /** Upper bound of the suggested cm/360 interval. */
  cm360High: number;
  /** Profile id used when the fit ran (for display; apply uses current profile). */
  profileIdAtFit: string;
  /** DPI used during calibration. */
  dpi: number;
  /** Task family the estimate targets. */
  taskFamily: TaskFamily;
  /** Objective score at the recommended gain. */
  sObj: number;
  /** Subjective comfort at the recommended gain. */
  sSub: number;
  /** True when hold-out validation accepted the estimate. */
  verified: boolean;
  /** Unix epoch ms when the recommendation was written. */
  createdAt: number;
  /** Optional confidence in [0, 1] after prior discounts. */
  confidence?: number;
};

/** Soft cap for local recommendation history used by drift / retest UX. */
const KEY = "aim-trainer-web.recommendation";
/** Soft cap for local recommendation history used by drift / retest UX. */
const MAX_HISTORY = 40;
/** Cloud table matching supabase/migrations sensitivity_recommendations. */
const TABLE = "sensitivity_recommendations";

/** Row shape returned from public.sensitivity_recommendations selects. */
type CloudRecommendationRow = {
  client_id: string;
  cm360: number;
  cm360_low: number;
  cm360_high: number;
  profile_id_at_fit: string;
  dpi: number;
  task_family: string;
  s_obj: number;
  s_sub: number;
  verified: boolean;
  confidence: number | null;
  created_at: string;
};

/**
 * newId returns a UUID, or a time-based token when crypto.randomUUID is missing.
 */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `reco-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * isTaskFamily reports whether value is a known calibration task family id.
 */
function isTaskFamily(value: unknown): value is TaskFamily {
  return value === "balanced" || value === "flick" || value === "micro";
}

/**
 * isRecommendation validates persisted payloads before returning them to UI.
 * Legacy single-object saves without id are accepted and repaired on write.
 */
function isRecommendation(value: unknown): value is SensitivityRecommendation {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.cm360 === "number" &&
    typeof c.cm360Low === "number" &&
    typeof c.cm360High === "number" &&
    typeof c.profileIdAtFit === "string" &&
    typeof c.dpi === "number" &&
    isTaskFamily(c.taskFamily) &&
    typeof c.sObj === "number" &&
    typeof c.sSub === "number" &&
    typeof c.verified === "boolean" &&
    typeof c.createdAt === "number"
  );
}

/**
 * normalizeRecommendation clamps DPI and ensures a stable client sync id.
 */
function normalizeRecommendation(
  rec: SensitivityRecommendation,
): SensitivityRecommendation | null {
  const dpi = clampDpi(rec.dpi);
  if (dpi === null) return null;
  return {
    ...rec,
    id: typeof rec.id === "string" && rec.id.length > 0 ? rec.id : newId(),
    dpi,
  };
}

/**
 * writeHistory replaces the local recommendation list, trimming to MAX_HISTORY.
 */
function writeHistory(
  history: SensitivityRecommendation[],
): SensitivityRecommendation[] {
  const next = history.slice(-MAX_HISTORY);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors; in-memory apply still works for the session.
  }
  return next;
}

/**
 * readRecommendationHistory loads append-only calib outcomes, migrating a legacy
 * single-object payload into a one-element list so older local saves keep working.
 */
export function readRecommendationHistory(): SensitivityRecommendation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const history: SensitivityRecommendation[] = [];
    for (const item of rows) {
      if (!isRecommendation(item)) continue;
      const normalized = normalizeRecommendation(item);
      if (normalized) history.push(normalized);
    }
    return history.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/**
 * loadRecommendation reads the latest calibration result, or null when none exists.
 */
export function loadRecommendation(): SensitivityRecommendation | null {
  const history = readRecommendationHistory();
  return history.length > 0 ? history[history.length - 1]! : null;
}

/**
 * toCloudPayload maps a recommendation into the sensitivity_recommendations upsert body.
 */
function toCloudPayload(rec: SensitivityRecommendation, userId: string) {
  return {
    user_id: userId,
    client_id: rec.id,
    cm360: rec.cm360,
    cm360_low: rec.cm360Low,
    cm360_high: rec.cm360High,
    profile_id_at_fit: rec.profileIdAtFit,
    dpi: rec.dpi,
    task_family: rec.taskFamily,
    s_obj: rec.sObj,
    s_sub: rec.sSub,
    verified: rec.verified,
    confidence: typeof rec.confidence === "number" ? rec.confidence : null,
    created_at: new Date(rec.createdAt).toISOString(),
  };
}

/**
 * fromCloudRow converts a sensitivity_recommendations row back into local shape.
 */
function fromCloudRow(
  row: CloudRecommendationRow,
): SensitivityRecommendation | null {
  if (!isTaskFamily(row.task_family)) return null;
  const dpi = clampDpi(row.dpi);
  if (dpi === null) return null;
  return {
    id: row.client_id,
    cm360: row.cm360,
    cm360Low: row.cm360_low,
    cm360High: row.cm360_high,
    profileIdAtFit: row.profile_id_at_fit,
    dpi,
    taskFamily: row.task_family,
    sObj: row.s_obj,
    sSub: row.s_sub,
    verified: row.verified,
    confidence: row.confidence ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * mergeHistoryById unions local and remote recommendations keyed by client id.
 * When both sides share an id, the newer createdAt wins so edits stay consistent.
 */
function mergeHistoryById(
  local: SensitivityRecommendation[],
  remote: SensitivityRecommendation[],
): SensitivityRecommendation[] {
  const byId = new Map<string, SensitivityRecommendation>();
  for (const rec of [...local, ...remote]) {
    const existing = byId.get(rec.id);
    if (!existing || rec.createdAt >= existing.createdAt) {
      byId.set(rec.id, rec);
    }
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * pushRecommendationToCloud upserts one calib outcome for the signed-in user.
 * No-ops when logged out; swallows network errors so apply still feels instant.
 */
export async function pushRecommendationToCloud(
  rec: SensitivityRecommendation,
): Promise<void> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from(TABLE)
      .upsert(toCloudPayload(rec, user.id), { onConflict: "user_id,client_id" });
    if (error) {
      console.warn("recommendation: cloud push failed", error.message);
    }
  } catch (error) {
    console.warn("recommendation: cloud push unavailable", error);
  }
}

/**
 * saveRecommendation appends a fitted outcome locally then syncs when signed in.
 * Accepts payloads without id (UI apply path) and assigns a client sync id.
 */
export function saveRecommendation(
  rec: Omit<SensitivityRecommendation, "id"> & { id?: string },
): SensitivityRecommendation {
  const stored =
    normalizeRecommendation({
      ...rec,
      id: rec.id ?? newId(),
    }) ?? {
      ...rec,
      id: rec.id ?? newId(),
      dpi: rec.dpi,
    };
  const history = readRecommendationHistory().filter((row) => row.id !== stored.id);
  writeHistory([...history, stored]);
  void pushRecommendationToCloud(stored);
  return stored;
}

/**
 * clearRecommendation removes local recommendation history (e.g. after profile reset).
 * Does not delete cloud rows; callers that need a full wipe should use a dedicated sync clear.
 */
export function clearRecommendation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}

/**
 * pullAndMergeRecommendations downloads cloud history, merges with local, and backfills.
 * Call after sign-in and on /aim mount; returns the merged list (latest is last).
 */
export async function pullAndMergeRecommendations(): Promise<
  SensitivityRecommendation[]
> {
  const local = readRecommendationHistory();
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return local;

    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "client_id,cm360,cm360_low,cm360_high,profile_id_at_fit,dpi,task_family,s_obj,s_sub,verified,confidence,created_at",
      )
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("recommendation: cloud pull failed", error.message);
      return local;
    }

    const remote: SensitivityRecommendation[] = [];
    for (const row of (data ?? []) as CloudRecommendationRow[]) {
      const parsed = fromCloudRow(row);
      if (parsed) remote.push(parsed);
    }

    const merged = writeHistory(mergeHistoryById(local, remote));
    const remoteIds = new Set(remote.map((rec) => rec.id));
    const localOnly = merged.filter((rec) => !remoteIds.has(rec.id));
    if (localOnly.length > 0) {
      const payload = localOnly.map((rec) => toCloudPayload(rec, user.id));
      const { error: upsertError } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: "user_id,client_id" });
      if (upsertError) {
        console.warn("recommendation: cloud backfill failed", upsertError.message);
      }
    }
    return merged;
  } catch (error) {
    console.warn("recommendation: merge unavailable", error);
    return local;
  }
}
