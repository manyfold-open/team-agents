import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = forwardedHost ?? requestHeaders.get("host") ?? "team-agents.workers.dev";
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(host) ? host : "team-agents.workers.dev";
  const protocol = requestHeaders.get("x-forwarded-proto")
    ?? (safeHost.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${safeHost}`;
  const image = `${origin}/team-agents-social.png`;
  const description = "A bilingual channel workspace where people and A2A agents collaborate in real time.";

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Team Agents",
      template: "%s · Team Agents",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Team Agents",
      description,
      type: "website",
      url: origin,
      images: [{ url: image, width: 1200, height: 630, alt: "Team Agents — people and A2A agents in one shared channel" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Team Agents",
      description,
      images: [image],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
