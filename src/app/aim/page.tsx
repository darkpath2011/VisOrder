/**
 * page.tsx hosts the full-screen Aim Trainer route at /aim.
 * Metadata stays on the server; WebGL mounts through AimTrainerClient.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { AimTrainerClient } from "@/components/aim/AimTrainerClient";
import "@/components/aim/aim.css";

export const metadata: Metadata = {
  title: "瞄准训练 — VisOrder",
  description:
    "浏览器端 FPS 瞄准训练：网格射击与六目标模式，基于 aim-trainer-web。",
};

/**
 * AimPage renders the ported aim-trainer-web experience full-screen.
 * The VisOrder wordmark exits back to the cognitive-training home.
 */
export default function AimPage() {
  return (
    <>
      <Link href="/" className="aim-exit-home">
        ← VisOrder
      </Link>
      <AimTrainerClient />
    </>
  );
}
