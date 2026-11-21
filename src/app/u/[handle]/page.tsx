/**
 * u/[handle]/page.tsx shows a public athlete profile: aggregate bests and drill
 * counts only. Raw session logs stay private behind RLS; this page streams the
 * athlete_profile RPC inside Suspense so chrome can render without blocking.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import {
  fetchAthleteProfile,
  type AthleteProfile,
} from "@/lib/leaderboard";
import {
  formatAimMetric,
  formatSchulteMetric,
  formatWeeklyMetric,
} from "@/lib/leaderboard-shared";

type AthletePageProps = {
  params: Promise<{ handle: string }>;
};

/**
 * formatAccuracy formats an optional [0,1] accuracy as a percent string.
 */
function formatAccuracy(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

/**
 * formatWhen formats an ISO timestamp for the profile meta line.
 */
function formatWhen(iso: string | null): string {
  if (!iso) return "暂无活动";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "暂无活动";
  return `最近活动 ${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * generateMetadata uses the URL handle so the page does not block on a second RPC.
 */
export async function generateMetadata({
  params,
}: AthletePageProps): Promise<Metadata> {
  const { handle } = await params;
  const safe = handle.trim() || "选手";
  return {
    title: `${safe} — VisOrder`,
    description: `${safe} 的公开训练成绩与练习统计。`,
  };
}

/**
 * AthleteStat is one compact KPI tile on the profile header strip.
 */
function AthleteStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="athlete-stat">
      <p className="athlete-stat__label">{label}</p>
      <p className="athlete-stat__value">{value}</p>
    </div>
  );
}

/**
 * AthleteProfileView renders the public aggregates for one athlete.
 */
function AthleteProfileView({ profile }: { profile: AthleteProfile }) {
  return (
    <div className="athlete">
      <header className="athlete__head">
        <p className="athlete__eyebrow">Athlete</p>
        <h1>{profile.displayName}</h1>
        <p className="athlete__meta">
          @{profile.handle} · {formatWhen(profile.lastActiveAt)}
        </p>
      </header>

      <section className="athlete-stats" aria-label="公开成绩">
        <AthleteStat
          label="舒尔特最快"
          value={
            profile.bestSchulteMs === null
              ? "—"
              : formatSchulteMetric(profile.bestSchulteMs)
          }
        />
        <AthleteStat
          label="瞄准最高分"
          value={
            profile.bestAimScore === null
              ? "—"
              : formatAimMetric(profile.bestAimScore)
          }
        />
        <AthleteStat
          label="本周练习"
          value={formatWeeklyMetric(profile.weeklySessions)}
        />
        <AthleteStat
          label="认知 / 瞄准"
          value={`${profile.totalDrills} / ${profile.totalAim}`}
        />
      </section>

      <section className="athlete-panel">
        <div className="athlete-panel__head">
          <h2>认知分项</h2>
          <p>只展示次数与最佳用时，不含逐局明细。</p>
        </div>
        {profile.drillBreakdown.length === 0 ? (
          <p className="athlete-empty">还没有公开的认知练习记录。</p>
        ) : (
          <div className="dash-table-wrap">
            <table className="dash-table">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>次数</th>
                  <th>最佳</th>
                  <th>均准确率</th>
                </tr>
              </thead>
              <tbody>
                {profile.drillBreakdown.map((row) => (
                  <tr key={row.trainingId}>
                    <td>{row.title}</td>
                    <td>{row.count}</td>
                    <td>
                      {row.bestDurationMs === null
                        ? "—"
                        : formatSchulteMetric(row.bestDurationMs)}
                    </td>
                    <td>{formatAccuracy(row.avgAccuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="athlete__actions">
        <Link href="/#leaderboard" className="btn btn--ghost">
          返回排行榜
        </Link>
        <Link href="/train" className="btn btn--primary">
          开始训练
        </Link>
      </div>
    </div>
  );
}

/**
 * AthleteBody loads one public profile by handle, or 404 when unknown.
 */
async function AthleteBody({ handle }: { handle: string }) {
  const profile = await fetchAthleteProfile(handle);
  if (!profile) {
    notFound();
  }
  return <AthleteProfileView profile={profile} />;
}

/**
 * AthleteFallback keeps page chrome stable while the profile RPC resolves.
 */
function AthleteFallback() {
  return (
    <div className="athlete">
      <header className="athlete__head">
        <p className="athlete__eyebrow">Athlete</p>
        <h1>加载中…</h1>
      </header>
      <div className="home-lb__panel home-lb__panel--loading" />
    </div>
  );
}

/**
 * AthletePage streams profile content so navigation chrome is never blocked.
 */
export default async function AthletePage({ params }: AthletePageProps) {
  const { handle } = await params;

  return (
    <>
      <SiteHeader />
      <main className="athlete-page">
        <Suspense fallback={<AthleteFallback />}>
          <AthleteBody handle={handle} />
        </Suspense>
      </main>
    </>
  );
}
