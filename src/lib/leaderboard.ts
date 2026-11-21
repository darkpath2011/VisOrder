/**
 * leaderboard.ts fetches public VisOrder ranking boards and athlete profiles via
 * cookie-free Supabase RPCs. Import only from Server Components; Client UI uses
 * leaderboard-shared.ts for types and formatters.
 */

import { createSupabasePublicClient } from "@/lib/supabase/public";
import type {
  LeaderboardEntry,
  LeaderboardSnapshot,
} from "@/lib/leaderboard-shared";
import { TRAINING_CATALOG, type TrainingId } from "@/lib/trainings";

export type {
  LeaderboardBoardId,
  LeaderboardEntry,
  LeaderboardSnapshot,
} from "@/lib/leaderboard-shared";

/** Row shape returned by public.leaderboard_* RPCs. */
type CloudLeaderboardRow = {
  rank: number | string;
  handle: string;
  display_name: string;
  metric_value: number;
  completed_at: string | null;
};

/** One drill family rollup inside a public athlete profile. */
export type AthleteDrillStat = {
  trainingId: TrainingId | string;
  title: string;
  count: number;
  bestDurationMs: number | null;
  avgAccuracy: number | null;
};

/** Public athlete profile aggregates (no raw session rows). */
export type AthleteProfile = {
  handle: string;
  displayName: string;
  bestSchulteMs: number | null;
  bestAimScore: number | null;
  weeklySessions: number;
  totalDrills: number;
  totalAim: number;
  drillBreakdown: AthleteDrillStat[];
  lastActiveAt: string | null;
};

/** Raw JSON returned by public.athlete_profile. */
type CloudAthleteProfile = {
  handle: string;
  displayName: string;
  bestSchulteMs: number | null;
  bestAimScore: number | null;
  weeklySessions: number;
  totalDrills: number;
  totalAim: number;
  drillBreakdown: Array<{
    trainingId: string;
    count: number;
    bestDurationMs: number | null;
    avgAccuracy: number | null;
  }>;
  lastActiveAt: string | null;
};

/**
 * parseEntry normalizes one RPC row into the UI LeaderboardEntry shape.
 */
function parseEntry(row: CloudLeaderboardRow): LeaderboardEntry | null {
  const rank = Number(row.rank);
  if (!Number.isFinite(rank) || typeof row.display_name !== "string") {
    return null;
  }
  if (typeof row.handle !== "string" || row.handle.length === 0) {
    return null;
  }
  if (!Number.isFinite(row.metric_value)) {
    return null;
  }
  return {
    rank,
    handle: row.handle,
    displayName: row.display_name,
    metricValue: row.metric_value,
    completedAt: row.completed_at,
  };
}

/**
 * fetchBoard calls one leaderboard RPC and returns parsed rows, or [] on failure.
 */
async function fetchBoard(
  rpcName: "leaderboard_schulte" | "leaderboard_aim" | "leaderboard_weekly",
  limit = 10,
): Promise<LeaderboardEntry[]> {
  try {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.rpc(rpcName, { limit_n: limit });
    if (error) {
      console.warn(`leaderboard: ${rpcName} failed`, error.message);
      return [];
    }
    const entries: LeaderboardEntry[] = [];
    for (const row of (data ?? []) as CloudLeaderboardRow[]) {
      const parsed = parseEntry(row);
      if (parsed) entries.push(parsed);
    }
    return entries;
  } catch (error) {
    console.warn(`leaderboard: ${rpcName} unavailable`, error);
    return [];
  }
}

/**
 * fetchLeaderboardSnapshot loads Schulte, aim, and weekly boards for the homepage.
 * Failures degrade to empty arrays so the marketing page still renders.
 */
export async function fetchLeaderboardSnapshot(
  limit = 10,
): Promise<LeaderboardSnapshot> {
  const [schulte, aim, weekly] = await Promise.all([
    fetchBoard("leaderboard_schulte", limit),
    fetchBoard("leaderboard_aim", limit),
    fetchBoard("leaderboard_weekly", limit),
  ]);
  return { schulte, aim, weekly };
}

/**
 * titleForTraining maps a catalog id to its Chinese title when known.
 */
function titleForTraining(trainingId: string): string {
  const meta = TRAINING_CATALOG.find((item) => item.id === trainingId);
  return meta?.title ?? trainingId;
}

/**
 * fetchAthleteProfile loads one public athlete summary by GitHub handle.
 * Returns null when the handle is unknown or the RPC is unavailable.
 */
export async function fetchAthleteProfile(
  handle: string,
): Promise<AthleteProfile | null> {
  const normalized = handle.trim().toLowerCase();
  if (!normalized) return null;
  try {
    const supabase = createSupabasePublicClient();
    const { data, error } = await supabase.rpc("athlete_profile", {
      p_handle: normalized,
    });
    if (error) {
      console.warn("leaderboard: athlete_profile failed", error.message);
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const row = data as CloudAthleteProfile;
    if (typeof row.handle !== "string" || typeof row.displayName !== "string") {
      return null;
    }
    return {
      handle: row.handle,
      displayName: row.displayName,
      bestSchulteMs:
        typeof row.bestSchulteMs === "number" ? row.bestSchulteMs : null,
      bestAimScore:
        typeof row.bestAimScore === "number" ? row.bestAimScore : null,
      weeklySessions: Number(row.weeklySessions) || 0,
      totalDrills: Number(row.totalDrills) || 0,
      totalAim: Number(row.totalAim) || 0,
      drillBreakdown: (row.drillBreakdown ?? []).map((item) => ({
        trainingId: item.trainingId,
        title: titleForTraining(item.trainingId),
        count: Number(item.count) || 0,
        bestDurationMs:
          typeof item.bestDurationMs === "number" ? item.bestDurationMs : null,
        avgAccuracy:
          typeof item.avgAccuracy === "number" ? item.avgAccuracy : null,
      })),
      lastActiveAt: row.lastActiveAt,
    };
  } catch (error) {
    console.warn("leaderboard: athlete_profile unavailable", error);
    return null;
  }
}
