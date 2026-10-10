import type { Metadata } from "next";
import { Hahmlet, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";
import "./hm-ui.css";

const display = Hahmlet({ weight: ["600", "700"], subsets: ["latin"], display: "swap", preload: false, variable: "--font-hm-display" });
const body = IBM_Plex_Sans_KR({ weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap", preload: false, variable: "--font-hm-body" });

export const metadata: Metadata = { title: "HarmonyMaker", description: "MusicXML 악보로 알토·테너 화음을 만들고 연습하는 도구" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={`${display.variable} ${body.variable}`}><body>{children}</body></html>;
}
