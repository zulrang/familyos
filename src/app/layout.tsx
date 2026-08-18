import type { Metadata, Viewport } from "next";
import { Newsreader, Nunito_Sans } from "next/font/google";
import { NavRail } from "@/components/nav/NavRail";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

const nunitoSans = Nunito_Sans({
  subsets: ["latin"],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  title: "FamilyOS",
  description: "Family command center",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${newsreader.variable} ${nunitoSans.variable}`}>
      <body>
        <div style={{ display: "flex", height: "100%" }}>
          <NavRail />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              position: "relative",
            }}
          >
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
