import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OPS",
  description: "RION Order 통합 운영 콘솔",
};

export default function OpsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
