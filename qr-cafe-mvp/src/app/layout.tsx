import type { Metadata } from "next";
import "./globals.css";
import { PwaRuntime } from "./_components/PwaRuntime";

export const metadata: Metadata = {
  title: {
    default: "RION Order",
    template: "%s | RION Order",
  },
  description: "RION Labs의 스마트 QR 주문 서비스",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Rion Order" },
  icons: { apple: "/icons/apple-touch-icon-180.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <PwaRuntime />
        {children}
      </body>
    </html>
  );
}
