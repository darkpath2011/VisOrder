/**
 * train/page.tsx hosts the VisOrder training hub: pick drills or run the full six-item suite.
 * Marketing copy stays brief so selection cards and live drills remain the page focus.
 */

import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { TrainingHub } from "@/components/training/TrainingHub";

export const metadata: Metadata = {
  title: "开始训练 — VisOrder",
  description:
    "选择舒尔特方格、字色干扰、数值干扰、序列记忆、反向线索、视觉完形，或一次练完全部。",
};

/**
 * TrainPage composes navigation with TrainingHub for multi-drill selection and sessions.
 */
export default function TrainPage() {
  return (
    <>
      <SiteHeader />
      <main className="train-page">
        <div className="train-page__intro">
          <h1>注意力训练</h1>
          <p>
            六种经典练习：选几项热身，或一次练完。每天换布局、别背答案，短时坚持更有效。
          </p>
        </div>
        <TrainingHub />
      </main>
    </>
  );
}
