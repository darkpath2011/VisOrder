/**
 * dashboard-stats.ts aggregates VisOrder local-first stores into dashboard view models.
 * Cognitive drills, suite runs, aim rounds, and sensitivity recommendations stay in
 * separate source lists so the UI can chart them without mixing drill scores into
 * sens estimates. All timestamps are Unix epoch milliseconds; day keys use local
 * calendar dates so "this week" matches what the athlete sees on their device.
 */

import type { AimSessionLogEntry } from "@/lib/aim-trainer/store/sessionLog";
import type { SensitivityRecommendation } from "@/lib/aim-trainer/store/recommendation";
import type { SensitivitySettings } from "@/lib/aim-trainer/store/settings";
import { cm360FromSens } from "@/lib/aim-trainer/core/gain";
import { findProfile } from "@/lib/aim-trainer/store/profiles";
import type { SessionRecord, SuiteRun } from "@/lib/training-history";
import { TRAINING_CATALOG, type TrainingId } from "@/lib/trainings";

/** Supported lookback windows for activity charts and KPI filters. */
export type DashboardRange = "7d" | "30d" | "all";

/** One local calendar day of cognitive + aim activity for bar charts. */
export type DayBucket = {
  /** Local YYYY-MM-DD key used for sorting and labels. */
  day: string;
  /** Short Chinese weekday or month/day label for the x-axis. */
  label: string;
  /** Finished cognitive drills that day. */
  drills: number;
  /** Finished aim rounds that day. */
  aim: number;
};

/** Per-catalog-drill rollup inside the selected range. */
export type DrillStat = {
  trainingId: TrainingId;
  title: string;
  count: number;
  /** Mean duration in ms when count > 0; otherwise null. */
  avgDurationMs: number | null;
  /** Mean accuracy in [0, 1] when any attempt recorded accuracy; otherwise null. */
  avgAccuracy: number | null;
};

/** Dashboard KPIs and series derived from the four practice data stores. */
export type DashboardSnapshot = {
  range: DashboardRange;
  /** Cognitive drill attempts in range. */
  drillCount: number;
  /** Multi-drill suite completions in range. */
  suiteCount: number;
  /** Aim rounds in range. */
  aimCount: number;
  /** Mean aim accuracy in [0, 1] when aimCount > 0. */
  aimAvgAccuracy: number | null;
  /** Mean aim score when aimCount > 0. */
  aimAvgScore: number | null;
  /** Current settings cm/360 when DPI is set; otherwise null. */
  currentCm360: number | null;
  /** Latest recommendation, if any (not range-filtered). */
  latestRecommendation: SensitivityRecommendation | null;
  /** Day buckets covering the chart window (padded empty days for 7d/30d). */
  days: DayBucket[];
  /** Per-drill rollups in catalog order. */
  drills: DrillStat[];
  /** Recent aim rounds newest-first for the session table. */
  recentAim: AimSessionLogEntry[];
  /** Recommendation history newest-first. */
  recommendations: SensitivityRecommendation[];
  /** Active control settings snapshot. */
  settings: SensitivitySettings;
};

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * rangeStartMs returns the inclusive lower bound for the lookback window.
 * "all" returns 0 so every stored row participates. Callers must pass `now`
 * (do not default to Date.now here) so Client Component SSR never reads wall
 * clock during prerender.
 */
export function rangeStartMs(range: DashboardRange, now: number): number {
  if (range === "7d") return now - 7 * MS_DAY;
  if (range === "30d") return now - 30 * MS_DAY;
  return 0;
}

/**
 * dayKey formats a timestamp as a local YYYY-MM-DD calendar key.
 */
function dayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * dayLabel returns a short axis label; 7d uses weekday, longer windows use M/D.
 */
function dayLabel(day: string, range: DashboardRange): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  if (range === "7d") {
    const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
    return `周${weekdays[date.getDay()]}`;
  }
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

/**
 * mean returns the arithmetic mean, or null when values is empty.
 */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * inRange reports whether completedAt is on or after the range lower bound.
 */
function inRange(completedAt: number, start: number): boolean {
  return completedAt >= start;
}

/**
 * buildDayBuckets pads every local calendar day in the chart window so empty
 * days still appear as zero-height bars instead of gaps in the series.
 */
function buildDayBuckets(
  range: DashboardRange,
  drills: SessionRecord[],
  aim: AimSessionLogEntry[],
  now: number,
): DayBucket[] {
  const start = rangeStartMs(range, now);
  const drillByDay = new Map<string, number>();
  const aimByDay = new Map<string, number>();
  for (const session of drills) {
    if (!inRange(session.completedAt, start)) continue;
    const key = dayKey(session.completedAt);
    drillByDay.set(key, (drillByDay.get(key) ?? 0) + 1);
  }
  for (const entry of aim) {
    if (!inRange(entry.completedAt, start)) continue;
    const key = dayKey(entry.completedAt);
    aimByDay.set(key, (aimByDay.get(key) ?? 0) + 1);
  }

  const days: DayBucket[] = [];
  if (range === "all") {
    const keys = new Set([...drillByDay.keys(), ...aimByDay.keys()]);
    const sorted = [...keys].sort();
    for (const key of sorted) {
      days.push({
        day: key,
        label: dayLabel(key, range),
        drills: drillByDay.get(key) ?? 0,
        aim: aimByDay.get(key) ?? 0,
      });
    }
    return days;
  }

  const dayCount = range === "7d" ? 7 : 30;
  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const ts = now - i * MS_DAY;
    const key = dayKey(ts);
    days.push({
      day: key,
      label: dayLabel(key, range),
      drills: drillByDay.get(key) ?? 0,
      aim: aimByDay.get(key) ?? 0,
    });
  }
  return days;
}

/**
 * buildDrillStats rolls up each catalog drill inside the selected range.
 */
function buildDrillStats(
  sessions: SessionRecord[],
  start: number,
): DrillStat[] {
  return TRAINING_CATALOG.map((meta) => {
    const rows = sessions.filter(
      (s) => s.trainingId === meta.id && inRange(s.completedAt, start),
    );
    const accuracies = rows
      .map((s) => s.accuracy)
      .filter((v): v is number => typeof v === "number");
    return {
      trainingId: meta.id,
      title: meta.title,
      count: rows.length,
      avgDurationMs: mean(rows.map((s) => s.durationMs)),
      avgAccuracy: mean(accuracies),
    };
  });
}

/**
 * buildDashboardSnapshot composes KPI and chart series from the practice stores.
 * Call after pull/merge so local lists already reflect cloud state when signed in.
 * `now` is required so SSR placeholders can avoid Date.now(); pass Date.now()
 * only from client effects or event handlers, never during first render.
 */
export function buildDashboardSnapshot(input: {
  range: DashboardRange;
  sessions: SessionRecord[];
  suiteRuns: SuiteRun[];
  aimLog: AimSessionLogEntry[];
  recommendations: SensitivityRecommendation[];
  settings: SensitivitySettings;
  /** Wall-clock ms used for range filters and day-bucket padding. */
  now: number;
}): DashboardSnapshot {
  const now = input.now;
  const start = rangeStartMs(input.range, now);
  const sessionsInRange = input.sessions.filter((s) =>
    inRange(s.completedAt, start),
  );
  const suitesInRange = input.suiteRuns.filter((s) =>
    inRange(s.completedAt, start),
  );
  const aimInRange = input.aimLog.filter((e) => inRange(e.completedAt, start));
  const profile = findProfile(input.settings.profileId);
  const sortedRecs = [...input.recommendations].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  return {
    range: input.range,
    drillCount: sessionsInRange.length,
    suiteCount: suitesInRange.length,
    aimCount: aimInRange.length,
    aimAvgAccuracy: mean(aimInRange.map((e) => e.accuracy)),
    aimAvgScore: mean(aimInRange.map((e) => e.score)),
    currentCm360: cm360FromSens(
      profile,
      input.settings.sensitivity,
      input.settings.dpi,
    ),
    latestRecommendation: sortedRecs[0] ?? null,
    days: buildDayBuckets(
      input.range,
      input.sessions,
      input.aimLog,
      now,
    ),
    drills: buildDrillStats(input.sessions, start),
    recentAim: [...aimInRange].sort((a, b) => b.completedAt - a.completedAt).slice(0, 12),
    recommendations: sortedRecs.slice(0, 12),
    settings: input.settings,
  };
}

/**
 * formatDurationMs formats a mean duration as seconds with one decimal place.
 */
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * formatAccuracy formats a [0,1] ratio as a percent string.
 */
export function formatAccuracy(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}

/**
 * formatCm360 formats a cm/360 value for display, or an em dash when unset.
 */
export function formatCm360(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} cm`;
}

/**
 * formatWhen formats a timestamp as a compact local date-time for tables.
 */
export function formatWhen(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}
