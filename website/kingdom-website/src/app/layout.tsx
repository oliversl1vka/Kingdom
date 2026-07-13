import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SmoothScroll } from "@/components/SmoothScroll";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KingdomOS — A Terminal Kingdom for Your Agents",
  description:
    "Autonomous hierarchical agent orchestration system. Plan, execute, review, heal — all from the command line. Open source, MIT licensed.",
};

// Explicit viewport — Next's default omits `viewport-fit=cover`, which iOS
// needs so `env(safe-area-inset-*)` resolves (notch / home-indicator math used
// by the fixed corner badge). width=device-width + initial-scale=1 match the
// default, so desktop rendering is unchanged. Zoom is intentionally NOT
// disabled (accessibility); `themeColor` paints the iOS status bar to match the
// page so the dynamic toolbar never flashes a light gap.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
