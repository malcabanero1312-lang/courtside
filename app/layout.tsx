import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { PullToRefresh } from "@/components/pull-to-refresh";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Courtside", template: "%s · Courtside" },
  description: "Tennis appointment management for coaches, agents and clubs.",
  applicationName: "Courtside",
  appleWebApp: {
    capable: true,
    title: "Courtside",
    statusBarStyle: "default"
  },
  icons: {
    apple: "/icons/apple-touch-icon.png"
  },
  formatDetection: {
    telephone: false
  }
};

export const viewport: Viewport = {
  themeColor: "#12392c",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>
        <PullToRefresh />
        {children}
      </body>
    </html>
  );
}
