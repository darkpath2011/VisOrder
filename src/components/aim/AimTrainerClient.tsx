/**
 * AimTrainerClient.tsx dynamically loads AimTrainerApp with SSR disabled.
 * Next.js forbids ssr:false dynamic() inside Server Components, so this thin
 * client boundary owns the WebGL entry while /aim/page.tsx keeps route metadata.
 */

"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import "./aim.css";

const AimTrainerApp = dynamic(
  () =>
    import("@/components/aim/AimTrainerApp").then((mod) => mod.AimTrainerApp),
  {
    ssr: false,
    loading: () => (
      <div className="aim-loading">
        <p>加载瞄准训练…</p>
        <Link href="/">返回 VisOrder</Link>
      </div>
    ),
  },
);

/**
 * AimTrainerClient renders the fullscreen trainer after the client bundle is ready.
 */
export function AimTrainerClient() {
  return <AimTrainerApp />;
}
