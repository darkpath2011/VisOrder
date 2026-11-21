/**
 * training-history.ts owns local-first attention-training session persistence and
 * optional Supabase sync. Every finished drill is written to localStorage first so
 * offline practice never blocks; when a user is signed in, the same row is upserted
 * by (user_id, client_id) so reloads and devices converge without duplicates.
 * Suite runs live in a separate suite_runs table (and local key) so multi-drill
 * summaries feed cognitive prior / fatigue gating without mixing into drill scores.
 */

import type { TrainingRecord } from "./schulte";
import type { DrillResult, TrainingId } from "./trainings";
import { createSupabaseBrowserClient } from "./supabase/client";

/** localStorage key for v2 session rows that include trainingId and client sync ids. */
const HISTORY_KEY = "visorder.training.history.v2";

/** Legacy Schulte-only key migrated once into HISTORY_KEY on first read. */
const LEGACY_HISTORY_KEY = "visorder.training.history.v1";

/** Soft cap keeps local progress useful without unbounded storage growth. */
const MAX_RECORDS = 120;

/** localStorage key for finished multi-drill suite summaries used by sens prior. */
const SUITE_KEY = "visorder.training.suite-runs.v1";

/** Soft cap for suite-run history. */
const MAX_SUITE_RUNS = 40;

/** Cloud table name matching supabase/migrations training_sessions. */
const TABLE = "training_sessions";

/** Cloud table name matching supabase/migrations suite_runs. */
const SUITE_TABLE = "suite_runs";

/**
 * SessionRecord is one finished drill attempt with a stable client_id for sync.
 * completedAt is Unix epoch milliseconds; accuracy stays in [0, 1] when present.
 */
export type SessionRecord = {
  /** Client-generated UUID used as the idempotent sync key (maps to client_id). */
  id: string;
  /** Catalog drill that produced this attempt. */
  trainingId: TrainingId;
  /** Unix epoch milliseconds when the attempt finished. */
  completedAt: number;
  /** Elapsed milliseconds for the attempt. */
  durationMs: number;
  /** Schulte grid edge length when trainingId is schulte. */
  size?: number;
  /** Optional accuracy ratio in [0, 1]. */
  accuracy?: number;
  /** Optional human-readable score line. */
  detail?: string;
};

/** Row shape returned from public.training_sessions selects. */
type CloudSessionRow = {
  client_id: string;
  training_id: string;
  completed_at: string;
  duration_ms: number;
  size: number | null;
  accuracy: number | null;
  detail: string | null;
};

/**
 * SuiteRun is one finished multi-drill queue persisted for cognitive priors.
 * Results mirror DrillResult; client id enables idempotent suite_runs upserts.
 */
export type SuiteRun = {
  id: string;
  completedAt: number;
  results: DrillResult[];
};

/** Row shape returned from public.suite_runs selects. */
type CloudSuiteRow = {
  client_id: string;
  completed_at: string;
  results: unknown;
};

/**
 * newSessionId returns a UUID for local rows; falls back to a time-based token
 * when crypto.randomUUID is unavailable in older embedded browsers.
 */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * isTrainingId reports whether value is a known VisOrder catalog drill id.
 */
function isTrainingId(value: unknown): value is TrainingId {
  return (
    value === "schulte" ||
    value === "stroop" ||
    value === "number-size" ||
    value === "sequence" ||
    value === "reverse-cue" ||
    value === "gestalt"
  );
}

/**
 * isSessionRecord validates persisted objects before they enter the in-memory list.
 */
function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    isTrainingId(candidate.trainingId) &&
    typeof candidate.completedAt === "number" &&
    typeof candidate.durationMs === "number"
  );
}

/**
 * migrateLegacyHistory converts v1 Schulte-only rows into SessionRecord entries.
 * Runs once when v2 is empty so existing local progress is not discarded.
 */
function migrateLegacyHistory(): SessionRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const migrated: SessionRecord[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const row = item as Record<string, unknown>;
      if (
        typeof row.completedAt !== "number" ||
        typeof row.durationMs !== "number" ||
        typeof row.size !== "number"
      ) {
        continue;
      }
      migrated.push({
        id: newSessionId(),
        trainingId: "schulte",
        completedAt: row.completedAt,
        durationMs: row.durationMs,
        size: row.size,
      });
    }
    if (migrated.length > 0) {
      writeSessions(migrated);
      window.localStorage.removeItem(LEGACY_HISTORY_KEY);
    }
    return migrated;
  } catch {
    return [];
  }
}

/**
 * writeSessions replaces the local history list, trimming to MAX_RECORDS.
 */
function writeSessions(sessions: SessionRecord[]): SessionRecord[] {
  const next = sessions.slice(-MAX_RECORDS);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

/**
 * readSessions loads local session history, migrating legacy Schulte rows when needed.
 * Returns an empty list during SSR or when stored JSON is missing or corrupt.
 */
export function readSessions(): SessionRecord[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) {
      return migrateLegacyHistory();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return migrateLegacyHistory();
    }
    return parsed.filter(isSessionRecord);
  } catch {
    return [];
  }
}

/**
 * toSchulteRecords projects SessionRecord rows into the Trainer history shape.
 */
export function toSchulteRecords(sessions: SessionRecord[]): TrainingRecord[] {
  return sessions
    .filter((session) => session.trainingId === "schulte")
    .map((session) => ({
      completedAt: session.completedAt,
      durationMs: session.durationMs,
      size: session.size ?? 5,
    }));
}

/**
 * readSchulteHistory returns Schulte-only local rows for the Trainer sidebar.
 */
export function readSchulteHistory(): TrainingRecord[] {
  return toSchulteRecords(readSessions());
}

/**
 * sessionFromDrill builds a SessionRecord from a finished DrillResult payload.
 * Generates a fresh client id so each completion is a distinct syncable row.
 */
export function sessionFromDrill(
  result: DrillResult,
  extras?: { size?: number; completedAt?: number },
): SessionRecord {
  return {
    id: newSessionId(),
    trainingId: result.trainingId,
    completedAt: extras?.completedAt ?? Date.now(),
    durationMs: result.durationMs,
    size: extras?.size,
    accuracy: result.accuracy,
    detail: result.detail,
  };
}

/**
 * appendSessionLocal stores a session on disk and returns the trimmed list.
 * Cloud sync is intentionally separate so UI can update before the network returns.
 */
export function appendSessionLocal(session: SessionRecord): SessionRecord[] {
  return writeSessions([...readSessions(), session]);
}

/**
 * clearSessionsLocal removes all local training history for an explicit user reset.
 */
export function clearSessionsLocal(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(HISTORY_KEY);
  window.localStorage.removeItem(LEGACY_HISTORY_KEY);
}

/**
 * toCloudPayload maps a SessionRecord into the training_sessions insert/upsert body.
 */
function toCloudPayload(session: SessionRecord, userId: string) {
  return {
    user_id: userId,
    client_id: session.id,
    training_id: session.trainingId,
    completed_at: new Date(session.completedAt).toISOString(),
    duration_ms: Math.round(session.durationMs),
    size: typeof session.size === "number" ? session.size : null,
    accuracy: typeof session.accuracy === "number" ? session.accuracy : null,
    detail: session.detail ?? null,
  };
}

/**
 * fromCloudRow converts a training_sessions row back into a SessionRecord.
 * Unknown training_id values are skipped by the caller via isTrainingId.
 */
function fromCloudRow(row: CloudSessionRow): SessionRecord | null {
  if (!isTrainingId(row.training_id)) {
    return null;
  }
  return {
    id: row.client_id,
    trainingId: row.training_id,
    completedAt: new Date(row.completed_at).getTime(),
    durationMs: row.duration_ms,
    size: row.size ?? undefined,
    accuracy: row.accuracy ?? undefined,
    detail: row.detail ?? undefined,
  };
}

/**
 * pushSessionToCloud upserts one local session for the signed-in user.
 * No-ops when logged out; swallows network errors so practice stays uninterrupted.
 */
export async function pushSessionToCloud(session: SessionRecord): Promise<void> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return;
    }
    const { error } = await supabase
      .from(TABLE)
      .upsert(toCloudPayload(session, user.id), { onConflict: "user_id,client_id" });
    if (error) {
      console.warn("training-history: cloud push failed", error.message);
    }
  } catch (error) {
    console.warn("training-history: cloud push unavailable", error);
  }
}

/**
 * recordDrillCompletion writes a drill result locally then syncs when signed in.
 * Returns the updated SessionRecord list for callers that refresh UI from storage.
 */
export function recordDrillCompletion(
  result: DrillResult,
  extras?: { size?: number },
): SessionRecord[] {
  const session = sessionFromDrill(result, extras);
  const next = appendSessionLocal(session);
  void pushSessionToCloud(session);
  return next;
}

/**
 * mergeSessionsById unions local and remote rows keyed by client id.
 * When both sides share an id, the newer completedAt wins so edits stay consistent.
 */
function mergeSessionsById(
  local: SessionRecord[],
  remote: SessionRecord[],
): SessionRecord[] {
  const byId = new Map<string, SessionRecord>();
  for (const session of [...local, ...remote]) {
    const existing = byId.get(session.id);
    if (!existing || session.completedAt >= existing.completedAt) {
      byId.set(session.id, session);
    }
  }
  return [...byId.values()].sort((a, b) => a.completedAt - b.completedAt);
}

/**
 * pullAndMergeSessions downloads the user's cloud history, merges with local, and
 * pushes any local-only rows. Call after sign-in and on /train mount when logged in.
 * Returns the merged local list; returns local-only data when logged out or offline.
 */
export async function pullAndMergeSessions(): Promise<SessionRecord[]> {
  const local = readSessions();
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return local;
    }

    const { data, error } = await supabase
      .from(TABLE)
      .select("client_id,training_id,completed_at,duration_ms,size,accuracy,detail")
      .order("completed_at", { ascending: true });

    if (error) {
      console.warn("training-history: cloud pull failed", error.message);
      return local;
    }

    const remote: SessionRecord[] = [];
    for (const row of (data ?? []) as CloudSessionRow[]) {
      const parsed = fromCloudRow(row);
      if (parsed) {
        remote.push(parsed);
      }
    }

    const merged = writeSessions(mergeSessionsById(local, remote));
    const remoteIds = new Set(remote.map((session) => session.id));
    const localOnly = merged.filter((session) => !remoteIds.has(session.id));
    if (localOnly.length > 0) {
      const payload = localOnly.map((session) => toCloudPayload(session, user.id));
      const { error: upsertError } = await supabase
        .from(TABLE)
        .upsert(payload, { onConflict: "user_id,client_id" });
      if (upsertError) {
        console.warn("training-history: cloud backfill failed", upsertError.message);
      }
    }
    return merged;
  } catch (error) {
    console.warn("training-history: merge unavailable", error);
    return local;
  }
}

/**
 * clearAllHistory clears local rows and deletes the signed-in user's cloud sessions.
 * Cloud delete failures are logged; local clear still completes so reset feels instant.
 */
export async function clearAllHistory(): Promise<void> {
  clearSessionsLocal();
  try {
    localStorage.removeItem(SUITE_KEY);
  } catch {
    // Ignore.
  }
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return;
    }
    const { error } = await supabase.from(TABLE).delete().eq("user_id", user.id);
    if (error) {
      console.warn("training-history: cloud clear failed", error.message);
    }
    const { error: suiteError } = await supabase
      .from(SUITE_TABLE)
      .delete()
      .eq("user_id", user.id);
    if (suiteError) {
      console.warn("training-history: suite cloud clear failed", suiteError.message);
    }
  } catch (error) {
    console.warn("training-history: cloud clear unavailable", error);
  }
}

/**
 * isDrillResult validates suite payload entries before persistence.
 */
function isDrillResult(value: unknown): value is DrillResult {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return isTrainingId(c.trainingId) && typeof c.durationMs === "number";
}

/**
 * isSuiteRun validates persisted suite objects.
 */
function isSuiteRun(value: unknown): value is SuiteRun {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.id === "string" &&
    typeof c.completedAt === "number" &&
    Array.isArray(c.results) &&
    c.results.every(isDrillResult)
  );
}

/**
 * writeSuiteRuns replaces the local suite list, trimming to MAX_SUITE_RUNS.
 */
function writeSuiteRuns(runs: SuiteRun[]): SuiteRun[] {
  const next = runs.slice(-MAX_SUITE_RUNS);
  try {
    localStorage.setItem(SUITE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota errors.
  }
  return next;
}

/**
 * readSuiteRuns returns local suite summaries newest-last.
 */
export function readSuiteRuns(): SuiteRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SUITE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSuiteRun);
  } catch {
    return [];
  }
}

/**
 * toSuiteCloudPayload maps a SuiteRun into the suite_runs upsert body.
 */
function toSuiteCloudPayload(run: SuiteRun, userId: string) {
  return {
    user_id: userId,
    client_id: run.id,
    completed_at: new Date(run.completedAt).toISOString(),
    results: run.results,
  };
}

/**
 * fromSuiteCloudRow converts a suite_runs row back into a SuiteRun.
 */
function fromSuiteCloudRow(row: CloudSuiteRow): SuiteRun | null {
  if (!Array.isArray(row.results) || !row.results.every(isDrillResult)) {
    return null;
  }
  return {
    id: row.client_id,
    completedAt: new Date(row.completed_at).getTime(),
    results: row.results,
  };
}

/**
 * mergeSuiteRunsById unions local and remote suite rows keyed by client id.
 * When both sides share an id, the newer completedAt wins so edits stay consistent.
 */
function mergeSuiteRunsById(local: SuiteRun[], remote: SuiteRun[]): SuiteRun[] {
  const byId = new Map<string, SuiteRun>();
  for (const run of [...local, ...remote]) {
    const existing = byId.get(run.id);
    if (!existing || run.completedAt >= existing.completedAt) {
      byId.set(run.id, run);
    }
  }
  return [...byId.values()].sort((a, b) => a.completedAt - b.completedAt);
}

/**
 * pushSuiteRunToCloud upserts one suite summary for the signed-in user.
 * No-ops when logged out; swallows network errors so hub UX stays uninterrupted.
 */
export async function pushSuiteRunToCloud(run: SuiteRun): Promise<void> {
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from(SUITE_TABLE)
      .upsert(toSuiteCloudPayload(run, user.id), {
        onConflict: "user_id,client_id",
      });
    if (error) {
      console.warn("training-history: suite cloud push failed", error.message);
    }
  } catch (error) {
    console.warn("training-history: suite cloud push unavailable", error);
  }
}

/**
 * recordSuiteRun stores a finished multi-drill summary for prior/gating features.
 * Call when the hub reaches the summary phase with two or more drill results.
 * Local write is immediate; cloud upsert runs when the user is signed in.
 */
export function recordSuiteRun(results: DrillResult[]): SuiteRun | null {
  if (results.length < 2) return null;
  const run: SuiteRun = {
    id: newSessionId(),
    completedAt: Date.now(),
    results: results.map((r) => ({ ...r })),
  };
  writeSuiteRuns([...readSuiteRuns(), run]);
  void pushSuiteRunToCloud(run);
  return run;
}

/**
 * pullAndMergeSuiteRuns downloads cloud suite summaries, merges with local, and
 * backfills local-only rows. Call after sign-in and on /train mount when logged in.
 */
export async function pullAndMergeSuiteRuns(): Promise<SuiteRun[]> {
  const local = readSuiteRuns();
  try {
    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return local;

    const { data, error } = await supabase
      .from(SUITE_TABLE)
      .select("client_id,completed_at,results")
      .order("completed_at", { ascending: true });

    if (error) {
      console.warn("training-history: suite cloud pull failed", error.message);
      return local;
    }

    const remote: SuiteRun[] = [];
    for (const row of (data ?? []) as CloudSuiteRow[]) {
      const parsed = fromSuiteCloudRow(row);
      if (parsed) remote.push(parsed);
    }

    const merged = writeSuiteRuns(mergeSuiteRunsById(local, remote));
    const remoteIds = new Set(remote.map((run) => run.id));
    const localOnly = merged.filter((run) => !remoteIds.has(run.id));
    if (localOnly.length > 0) {
      const payload = localOnly.map((run) => toSuiteCloudPayload(run, user.id));
      const { error: upsertError } = await supabase
        .from(SUITE_TABLE)
        .upsert(payload, { onConflict: "user_id,client_id" });
      if (upsertError) {
        console.warn(
          "training-history: suite cloud backfill failed",
          upsertError.message,
        );
      }
    }
    return merged;
  } catch (error) {
    console.warn("training-history: suite merge unavailable", error);
    return local;
  }
}
