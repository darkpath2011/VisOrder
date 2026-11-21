/**
 * layout.tsx defines the VisOrder document shell: fonts, metadata, and shared page chrome.
 * Chinese body copy uses Noto Sans SC while Syne carries the Latin brand mark VisOrder.
 */

import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC, Syne } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const notoSansSc = Noto_Sans_SC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "VisOrder — 视觉注意力训练",
  description:
    "舒尔特方格、斯特鲁普字色干扰、数值干扰、序列记忆、反向线索与视觉完形。每天几分钟，练专注与抑制控制。",
};

/**
 * RootLayout wraps every route with the VisOrder font variables and full-height body.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      data-scroll-behavior="smooth"
      className={`${syne.variable} ${notoSansSc.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
