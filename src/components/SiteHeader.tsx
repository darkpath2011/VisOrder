/**
 * SiteHeader.tsx renders the slim top navigation shared by marketing and training routes.
 * Brand text stays quiet in the bar so the hero can own the VisOrder signal on the home page.
 * AuthControls sits in the nav so GitHub sign-in is reachable from every marketing route.
 */

import Link from "next/link";
import { AuthControls } from "@/components/AuthControls";

type SiteHeaderProps = {
  /** When true, emphasize the train CTA as the primary action. */
  emphasizeTrain?: boolean;
};

/**
 * SiteHeader shows the VisOrder wordmark, aim / dashboard entries, auth, and train CTA.
 * Compact links stay visible on tablet; only the very small breakpoint collapses them.
 */
export function SiteHeader({ emphasizeTrain = false }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Link href="/" className="site-header__brand" aria-label="VisOrder home">
        VisOrder
      </Link>
      <nav className="site-header__nav" aria-label="Primary">
        <Link href="/aim" className="site-header__link site-header__link--nav">
          瞄准
        </Link>
        <Link
          href="/dashboard"
          className="site-header__link site-header__link--nav"
        >
          数据
        </Link>
        <Link
          href="/#leaderboard"
          className="site-header__link site-header__link--nav"
        >
          排行
        </Link>
        <AuthControls />
        <Link
          href="/train"
          className={
            emphasizeTrain
              ? "site-header__cta site-header__cta--solid"
              : "site-header__cta"
          }
        >
          开始训练
        </Link>
      </nav>
    </header>
  );
}
