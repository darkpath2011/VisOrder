/**
 * dashboard/page.tsx hosts the VisOrder practice data dashboard.
 * Cognitive drills, aim rounds, and sensitivity recommendations are shown from
 * local-first stores after an optional cloud pull on client mount.
 */

import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { DataDashboard } from "@/components/dashboard/DataDashboard";

export const metadata: Metadata = {
  title: "数据仪表盘 — VisOrder",
  description:
    "查看认知训练、瞄准局日志、灵敏度校准推荐与当前 DPI/感度汇总。",
};

/**
 * DashboardPage composes navigation with the client DataDashboard for practice analytics.
 */
export default function DashboardPage() {
  return (
    <>
      <SiteHeader />
      <main className="dash-page">
        <DataDashboard />
      </main>
    </>
  );
}
