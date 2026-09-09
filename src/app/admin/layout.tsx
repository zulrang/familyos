import type { Metadata, Viewport } from "next";
import { Newsreader, Nunito_Sans } from "next/font/google";
import { AdminShell } from "@/admin/AdminShell";
import "../globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});
const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "FamilyOS · Parents",
  description: "Manage your family's tasks, members, and stars.",
  manifest: "/admin/manifest.webmanifest",
  appleWebApp: { capable: true, title: "FamilyOS", statusBarStyle: "default" },
  icons: { apple: "/admin/icon-180.png", icon: "/admin/icon-192.png" },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f6f8f5",
};
export const dynamic = "force-dynamic";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${newsreader.variable} ${nunitoSans.variable}`}>
      <body>
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
