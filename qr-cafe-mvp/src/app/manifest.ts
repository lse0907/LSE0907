import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Rion Order",
    short_name: "Rion Order",
    description: "RION Labs의 스마트 QR 주문 서비스",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "ko",
    background_color: "#0f1f3d",
    theme_color: "#0f1f3d",
    icons: [
      { src: "/icons/rion-order-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/rion-order-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/rion-order-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/rion-order-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "QR 주문", short_name: "QR 주문", url: "/" },
      { name: "관리자", short_name: "관리자", url: "/admin" },
      { name: "직원 주문 운영", short_name: "직원", url: "/staff" },
    ],
  };
}
