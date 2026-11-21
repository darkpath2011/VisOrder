/**
 * leaderboard-shared.ts holds client-safe leaderboard types and metric formatters.
 * Server fetch lives in leaderboard.ts so Client Components never import next/headers
 * through the Supabase server client.
 */

/** Which public ranking board is shown in the homepage tabs. */
export type LeaderboardBoardId = "schulte" | "aim" | "weekly";

/** One ranked athlete row returned by the leaderboard RPCs. */
export type LeaderboardEntry = {
  /** 1-based rank within the board. */
  rank: number;
  /** URL slug from GitHub username (or fallback id fragment). */
  handle: string;
  /** GitHub login / name when available; otherwise a generic athlete label. */
  displayName: string;
  /** Board-specific metric: ms for Schulte, score for aim, session count for weekly. */
  metricValue: number;
  /** ISO timestamp of the attempt or last activity used for the metric. */
  completedAt: string | null;
};

/** Snapshot of all homepage boards fetched in one server pass. */
export type LeaderboardSnapshot = {
  schulte: LeaderboardEntry[];
  aim: LeaderboardEntry[];
  weekly: LeaderboardEntry[];
};

/**
 * formatSchulteMetric formats a duration in milliseconds as seconds.
 */
export function formatSchulteMetric(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * formatAimMetric formats an aim high score as a rounded integer.
 */
export function formatAimMetric(score: number): string {
  return Math.round(score).toLocaleString("en-US");
}

/**
 * formatWeeklyMetric formats a seven-day session count.
 */
export function formatWeeklyMetric(count: number): string {
  return `${Math.round(count)} 次`;
}
