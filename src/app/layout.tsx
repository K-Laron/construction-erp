import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { PWA } from "@/components/ui/PWA";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Construction Supply ERP",
  description:
    "Point-of-sale and inventory management system for construction supply stores",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased dark bg-surface-950 text-slate-100`}
    >
      <body className="min-h-full flex flex-col bg-surface-950">
        <PWA />
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
