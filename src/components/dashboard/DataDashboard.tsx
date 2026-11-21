/**
 * DataDashboard.tsx is the client shell for /dashboard: it pulls cloud stores on
 * mount, aggregates them into a DashboardSnapshot, and renders KPI / activity /
 * drill / aim / recommendation panels. Charts stay pure SVG so the page has no
 * chart-library dependency and matches VisOrder's existing teal/ink language.
 */

"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { pullAndMergeAllUserData } from "@/lib/cloud-sync";
import {
  buildDashboardSnapshot,
  formatAccuracy,
  formatCm360,
  formatDurationMs,
  formatWhen,
  type DashboardRange,
  type DashboardSnapshot,
  type DayBucket,
} from "@/lib/dashboard-stats";
import { readAimSessionLog } from "@/lib/aim-trainer/store/sessionLog";
import { readRecommendationHistory } from "@/lib/aim-trainer/store/recommendation";
import {
  DEFAULT_SETTINGS,
  loadSettings,
} from "@/lib/aim-trainer/store/settings";
import { findProfile } from "@/lib/aim-trainer/store/profiles";
import { readSessions, readSuiteRuns } from "@/lib/training-history";

const RANGE_OPTIONS: { id: DashboardRange; label: string }[] = [
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" },
  { id: "all", label: "全部" },
];

/** Friendly aim mode labels for the recent-sessions table. */
const MODE_LABELS: Record<string, string> = {
  gridshot: "网格射击",
  "gridshot-3x3": "网格 3×3",
  sixshot: "六目标",
  "sixshot-beginner": "六目标·初",
  "sens-finder-far-large": "校准·远大",
  "sens-finder-far-small": "校准·远小",
  "sens-finder-near-small": "校准·近小",
};

/**
 * modeLabel maps a stored modeId to a short Chinese label when known.
 */
function modeLabel(modeId: string): string {
  return MODE_LABELS[modeId] ?? modeId;
}

/**
 * emptySnapshot is the SSR-safe placeholder before localStorage is readable.
 * It must stay free of Date.now() / new Date() so Next.js can prerender the
 * Client Component shell without a current-time blocking error.
 */
function emptySnapshot(range: DashboardRange): DashboardSnapshot {
  return {
    range,
    drillCount: 0,
    suiteCount: 0,
    aimCount: 0,
    aimAvgAccuracy: null,
    aimAvgScore: null,
    currentCm360: null,
    latestRecommendation: null,
    days: [],
    drills: [],
    recentAim: [],
    recommendations: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * readLocalSnapshot builds a DashboardSnapshot from current localStorage stores.
 * Call only after mount (effects / handlers); Date.now() is not SSR-safe in render.
 */
function readLocalSnapshot(range: DashboardRange): DashboardSnapshot {
  return buildDashboardSnapshot({
    range,
    sessions: readSessions(),
    suiteRuns: readSuiteRuns(),
    aimLog: readAimSessionLog(),
    recommendations: readRecommendationHistory(),
    settings: loadSettings(),
    now: Date.now(),
  });
}

/**
 * ActivityBars draws stacked cognitive + aim counts per day as vertical bars.
 */
function ActivityBars({ days }: { days: DayBucket[] }) {
  const max = Math.max(1, ...days.map((d) => d.drills + d.aim));
  const showEvery = days.length > 14 ? 5 : days.length > 8 ? 2 : 1;

  if (days.length === 0) {
    return <p className="dash-empty">这段时间还没有练习记录。</p>;
  }

  return (
    <div className="dash-bars" role="img" aria-label="每日练习次数">
      {days.map((day, index) => {
        const total = day.drills + day.aim;
        const height = `${(total / max) * 100}%`;
        const drillShare = total > 0 ? (day.drills / total) * 100 : 0;
        return (
          <div key={day.day} className="dash-bars__col">
            <div className="dash-bars__track">
              <div
                className="dash-bars__stack"
                style={{ height }}
                title={`${day.day} · 认知 ${day.drills} · 瞄准 ${day.aim}`}
              >
                <span
                  className="dash-bars__aim"
                  style={{ height: `${100 - drillShare}%` }}
                />
                <span
                  className="dash-bars__drill"
                  style={{ height: `${drillShare}%` }}
                />
              </div>
            </div>
            {index % showEvery === 0 || index === days.length - 1 ? (
              <span className="dash-bars__label">{day.label}</span>
            ) : (
              <span className="dash-bars__label dash-bars__label--ghost" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * AimSparkline plots recent aim scores as a polyline with a filled underlay.
 */
function AimSparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) {
    return <p className="dash-empty">瞄准局数不足，还画不出趋势线。</p>;
  }

  const width = 320;
  const height = 96;
  const pad = 8;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = Math.max(1, max - min);
  const points = scores.map((score, i) => {
    const x = pad + (i / (scores.length - 1)) * (width - pad * 2);
    const y = height - pad - ((score - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const line = points.join(" ");
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;

  return (
    <svg
      className="dash-spark"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="瞄准得分趋势"
    >
      <polygon className="dash-spark__area" points={area} />
      <polyline className="dash-spark__line" points={line} />
    </svg>
  );
}

/**
 * DataDashboard loads practice history, optionally syncs cloud rows, and renders
 * the KPI strip plus cognitive / aim / recommendation sections for the chosen range.
 */
export function DataDashboard() {
  const [range, setRange] = useState<DashboardRange>("7d");
  const [syncing, setSyncing] = useState(true);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(() =>
    emptySnapshot("7d"),
  );
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    // Hydrate from localStorage after mount (SSR starts with an empty placeholder).
    // startTransition keeps outer Suspense from flashing while this update settles.
    startTransition(() => {
      setSnapshot(readLocalSnapshot(range));
    });
  }, [range]);

  useEffect(() => {
    let active = true;
    setSyncing(true);
    void (async () => {
      await pullAndMergeAllUserData();
      if (!active) return;
      startTransition(() => {
        setSyncedAt(Date.now());
        setSyncing(false);
        // Use the latest range in case the athlete changed the filter during sync.
        setSnapshot(readLocalSnapshot(rangeRef.current));
      });
    })();
    return () => {
      active = false;
    };
  }, []);

  const profile = findProfile(snapshot.settings.profileId);
  const aimScoresChrono = useMemo(() => {
    return [...snapshot.recentAim]
      .sort((a, b) => a.completedAt - b.completedAt)
      .map((e) => e.score);
  }, [snapshot.recentAim]);

  const hasAnyData =
    snapshot.drillCount > 0 ||
    snapshot.aimCount > 0 ||
    snapshot.recommendations.length > 0;

  return (
    <div className="dash">
      <header className="dash__head">
        <div>
          <h1>数据仪表盘</h1>
          <p>
            认知、瞄准、校准分表汇总。登录后自动与云端合并；未登录只看本机记录。
          </p>
        </div>
        <div className="dash__controls">
          <div className="dash-range" role="group" aria-label="时间范围">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={
                  range === option.id
                    ? "dash-range__btn dash-range__btn--active"
                    : "dash-range__btn"
                }
                onClick={() => setRange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="dash__sync" aria-live="polite">
            {syncing
              ? "正在同步…"
              : syncedAt
                ? `已同步 ${formatWhen(syncedAt)}`
                : "仅本机"}
          </p>
        </div>
      </header>

      <section className="dash-kpis" aria-label="关键指标">
        <article className="dash-kpi">
          <p className="dash-kpi__label">认知练习</p>
          <p className="dash-kpi__value">{snapshot.drillCount}</p>
          <p className="dash-kpi__meta">次 · 套件 {snapshot.suiteCount}</p>
        </article>
        <article className="dash-kpi">
          <p className="dash-kpi__label">瞄准局数</p>
          <p className="dash-kpi__value">{snapshot.aimCount}</p>
          <p className="dash-kpi__meta">
            均分 {snapshot.aimAvgScore?.toFixed(0) ?? "—"}
          </p>
        </article>
        <article className="dash-kpi">
          <p className="dash-kpi__label">瞄准命中</p>
          <p className="dash-kpi__value">
            {formatAccuracy(snapshot.aimAvgAccuracy)}
          </p>
          <p className="dash-kpi__meta">区间均值</p>
        </article>
        <article className="dash-kpi">
          <p className="dash-kpi__label">当前 cm/360</p>
          <p className="dash-kpi__value">
            {formatCm360(snapshot.currentCm360).replace(" cm", "")}
          </p>
          <p className="dash-kpi__meta">
            {snapshot.settings.dpi
              ? `${profile.name.split(" ")[0]} · DPI ${snapshot.settings.dpi}`
              : "尚未填写 DPI"}
          </p>
        </article>
      </section>

      {!hasAnyData ? (
        <section className="dash-panel dash-panel--empty">
          <h2>还没有可展示的数据</h2>
          <p>先完成几次认知训练或瞄准局，仪表盘会在这里展开趋势。</p>
          <div className="dash-panel__actions">
            <Link href="/train" className="btn btn--primary">
              去认知训练
            </Link>
            <Link href="/aim" className="btn btn--ghost">
              去瞄准训练
            </Link>
          </div>
        </section>
      ) : (
        <>
          <div className="dash-grid">
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2>每日活动</h2>
                <p className="dash-legend">
                  <span className="dash-legend__drill" /> 认知
                  <span className="dash-legend__aim" /> 瞄准
                </p>
              </div>
              <ActivityBars days={snapshot.days} />
            </section>

            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2>瞄准得分趋势</h2>
                <p className="dash-panel__hint">最近局 · 从旧到新</p>
              </div>
              <AimSparkline scores={aimScoresChrono} />
              {snapshot.latestRecommendation ? (
                <p className="dash-reco-chip">
                  最近推荐{" "}
                  <strong>
                    {formatCm360(snapshot.latestRecommendation.cm360)}
                  </strong>
                  {snapshot.latestRecommendation.verified
                    ? " · 已验证"
                    : " · 未验证"}
                </p>
              ) : (
                <p className="dash-panel__hint">尚未保存灵敏度推荐。</p>
              )}
            </section>
          </div>

          <div className="dash-grid dash-grid--tables">
            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2>认知分项</h2>
              </div>
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>项目</th>
                      <th>次数</th>
                      <th>均时</th>
                      <th>准确率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.drills.map((row) => (
                      <tr key={row.trainingId}>
                        <td>{row.title}</td>
                        <td>{row.count}</td>
                        <td>{formatDurationMs(row.avgDurationMs)}</td>
                        <td>{formatAccuracy(row.avgAccuracy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="dash-panel">
              <div className="dash-panel__head">
                <h2>最近瞄准局</h2>
              </div>
              {snapshot.recentAim.length === 0 ? (
                <p className="dash-empty">这段时间没有瞄准局。</p>
              ) : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>模式</th>
                        <th>得分</th>
                        <th>命中</th>
                        <th>cm/360</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.recentAim.map((row) => (
                        <tr key={row.id}>
                          <td>{formatWhen(row.completedAt)}</td>
                          <td>{modeLabel(row.modeId)}</td>
                          <td>{Math.round(row.score)}</td>
                          <td>{formatAccuracy(row.accuracy)}</td>
                          <td>{formatCm360(row.cm360)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section className="dash-panel">
            <div className="dash-panel__head">
              <h2>校准推荐历史</h2>
              <p className="dash-panel__hint">
                当前感度 {snapshot.settings.sensitivity} · {profile.name}
              </p>
            </div>
            {snapshot.recommendations.length === 0 ? (
              <p className="dash-empty">
                还没有校准记录。可在瞄准训练里跑一轮灵敏度校准。
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>任务族</th>
                      <th>推荐</th>
                      <th>区间</th>
                      <th>DPI</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.recommendations.map((rec) => (
                      <tr key={rec.id}>
                        <td>{formatWhen(rec.createdAt)}</td>
                        <td>{rec.taskFamily}</td>
                        <td>{formatCm360(rec.cm360)}</td>
                        <td>
                          {rec.cm360Low.toFixed(1)}–{rec.cm360High.toFixed(1)}
                        </td>
                        <td>{rec.dpi}</td>
                        <td>{rec.verified ? "已验证" : "未验证"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
