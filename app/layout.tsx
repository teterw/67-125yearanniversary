import type { Metadata, Viewport } from "next";
import { Geist_Mono, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

// Thai carries stacked vowel and tone marks above and below the baseline, so
// the UI face has to ship the Thai subset; Latin rides along for the numerals
// and the 67 branding. Loaded as a variable font so every weight is on hand.
const notoSansThai = Noto_Sans_Thai({
  variable: "--font-noto-sans-thai",
  subsets: ["thai", "latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "67 × 125 — แข่งความเร็ว 125 ปี",
  description:
    "เกมแข่งทำท่า 6-7 ให้ครบ 125 ครั้งผ่านกล้อง ฉลอง 125 ปี คณะภราดาเซนต์คาเบรียล แขวงประเทศไทย",
};

export const viewport: Viewport = {
  themeColor: "#070a18",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${notoSansThai.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
