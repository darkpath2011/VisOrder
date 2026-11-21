/**
 * page.tsx is the VisOrder home: brand band above a balanced copy/board pair,
 * then a streamed public leaderboard. The hero stays static so first paint is
 * not blocked by ranking RPCs; ranks resolve inside Suspense below the fold.
 */

import { Suspense } from "react";
import Link from "next/link";
import { HeroGrid } from "@/components/HeroGrid";
import { HomeLeaderboard } from "@/components/HomeLeaderboard";
import { SiteHeader } from "@/components/SiteHeader";
import { fetchLeaderboardSnapshot } from "@/lib/leaderboard";
import { TRAINING_CATALOG } from "@/lib/trainings";

/**
 * LeaderboardFallback shows a quiet placeholder while ranking RPCs resolve.
 */
function LeaderboardFallback() {
  return (
    <section className="home-lb" id="leaderboard" aria-label="排行榜加载中">
      <div className="home-lb__inner">
        <header className="home-lb__head">
          <div className="home-lb__titles">
            <p className="home-lb__eyebrow">Leaderboard</p>
            <h2>排行榜</h2>
            <p className="home-lb__lede">正在同步公开成绩…</p>
          </div>
        </header>
        <div className="home-lb__panel home-lb__panel--loading" />
      </div>
    </section>
  );
}

/**
 * HomeLeaderboardSection fetches ranking boards on the server, then hands them
 * to the client tab UI. Kept as its own async child so the hero can prerender.
 */
async function HomeLeaderboardSection() {
  const boards = await fetchLeaderboardSnapshot(10);
  return <HomeLeaderboard boards={boards} />;
}

/**
 * Home renders a single first-viewport composition, then streams the leaderboard.
 */
export default function Home() {
  return (
    <>
      <SiteHeader emphasizeTrain />
      <section className="hero" aria-label="VisOrder 介绍">
        <div className="hero__inner">
          <div className="hero__top">
            <p className="hero__brand">VisOrder</p>
            <p className="hero__meta">每天 5–10 分钟 · 坚持 2–4 周</p>
          </div>

          <div className="hero__main">
            <div className="hero__copy">
              <h1 className="hero__headline">把视线练得更快、更稳、更可控</h1>
              <ol className="hero__drills">
                {TRAINING_CATALOG.map((item, index) => (
                  <li key={item.id}>
                    <span className="hero__drills-index" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="hero__drills-title">{item.title}</span>
                  </li>
                ))}
              </ol>
              <div className="hero__actions">
                <Link href="/train" className="btn btn--primary">
                  开始训练
                </Link>
                <Link href="/#leaderboard" className="btn btn--ghost">
                  排行榜
                </Link>
              </div>
            </div>

            <div className="hero__visual">
              <HeroGrid />
            </div>
          </div>
        </div>
      </section>

      <Suspense fallback={<LeaderboardFallback />}>
        <HomeLeaderboardSection />
      </Suspense>
    </>
  );
}
