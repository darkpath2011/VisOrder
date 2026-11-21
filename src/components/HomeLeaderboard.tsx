/**
 * HomeLeaderboard.tsx renders the homepage ranking section beneath the hero.
 * Three boards share one list chrome; each athlete name links to /u/[handle]
 * for a public aggregate profile. Tabs switch locally over SSR snapshot data.
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import {
  formatAimMetric,
  formatSchulteMetric,
  formatWeeklyMetric,
  type LeaderboardBoardId,
  type LeaderboardEntry,
  type LeaderboardSnapshot,
} from "@/lib/leaderboard-shared";

type HomeLeaderboardProps = {
  /** Server-fetched boards for Schulte, aim, and weekly activity. */
  boards: LeaderboardSnapshot;
};

const TABS: {
  id: LeaderboardBoardId;
  label: string;
  hint: string;
  ctaHref: string;
  ctaLabel: string;
  format: (value: number) => string;
}[] = [
  {
    id: "schulte",
    label: "舒尔特",
    hint: "个人最快完成时间（越低越好）",
    ctaHref: "/train",
    ctaLabel: "去刷纪录",
    format: formatSchulteMetric,
  },
  {
    id: "aim",
    label: "瞄准",
    hint: "网格 / 六目标个人最高分",
    ctaHref: "/aim",
    ctaLabel: "去瞄准",
    format: formatAimMetric,
  },
  {
    id: "weekly",
    label: "本周活跃",
    hint: "近 7 天认知 + 瞄准练习次数",
    ctaHref: "/dashboard",
    ctaLabel: "看我的数据",
    format: formatWeeklyMetric,
  },
];

/**
 * medalClass returns a modifier for the top-three rank pills.
 */
function medalClass(rank: number): string {
  if (rank === 1) return "home-lb__rank home-lb__rank--gold";
  if (rank === 2) return "home-lb__rank home-lb__rank--silver";
  if (rank === 3) return "home-lb__rank home-lb__rank--bronze";
  return "home-lb__rank";
}

/**
 * BoardList renders ranked rows as links into athlete profiles, or an empty CTA.
 */
function BoardList({
  entries,
  format,
  emptyHint,
  ctaHref,
  ctaLabel,
}: {
  entries: LeaderboardEntry[];
  format: (value: number) => string;
  emptyHint: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="home-lb__empty">
        <p>{emptyHint}</p>
        <Link href={ctaHref} className="btn btn--primary">
          {ctaLabel}
        </Link>
      </div>
    );
  }

  return (
    <ol className="home-lb__list">
      {entries.map((entry) => (
        <li key={`${entry.rank}-${entry.handle}`}>
          <Link
            href={`/u/${encodeURIComponent(entry.handle)}`}
            className="home-lb__row"
          >
            <span
              className={medalClass(entry.rank)}
              aria-label={`第 ${entry.rank} 名`}
            >
              {entry.rank}
            </span>
            <span className="home-lb__name" title={entry.displayName}>
              {entry.displayName}
            </span>
            <span className="home-lb__metric">{format(entry.metricValue)}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

/**
 * HomeLeaderboard shows public ranks with local tab switching over SSR data.
 */
export function HomeLeaderboard({ boards }: HomeLeaderboardProps) {
  const [active, setActive] = useState<LeaderboardBoardId>("schulte");
  const tab = TABS.find((item) => item.id === active) ?? TABS[0]!;
  const entries = boards[active];

  return (
    <section className="home-lb" id="leaderboard" aria-label="排行榜">
      <div className="home-lb__inner">
        <header className="home-lb__head">
          <div className="home-lb__titles">
            <p className="home-lb__eyebrow">Leaderboard</p>
            <h2>排行榜</h2>
            <p className="home-lb__lede">
              点击选手查看公开成绩。登录同步后计入，不公开完整练习明细。
            </p>
          </div>
          <div className="home-lb__tabs" role="tablist" aria-label="排行榜分类">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active === item.id}
                className={
                  active === item.id
                    ? "home-lb__tab home-lb__tab--active"
                    : "home-lb__tab"
                }
                onClick={() => setActive(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <div className="home-lb__panel" role="tabpanel">
          <p className="home-lb__hint">{tab.hint}</p>
          <BoardList
            entries={entries}
            format={tab.format}
            emptyHint={`还没有${tab.label}上榜数据。登录后完成练习就会出现在这里。`}
            ctaHref={tab.ctaHref}
            ctaLabel={tab.ctaLabel}
          />
        </div>
      </div>
    </section>
  );
}
