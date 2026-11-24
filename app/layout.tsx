import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DEFAULT_BUSINESS_NAME } from "@/lib/brand";
import { loadBusinessName } from "@/lib/business-name-store";
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
  const businessName = await loadBusinessName();
  return {
    title:
      businessName === DEFAULT_BUSINESS_NAME
        ? DEFAULT_BUSINESS_NAME
        : `${businessName} — Production Planner`,
    description: "Visual production scheduling for freelance creative work.",
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}