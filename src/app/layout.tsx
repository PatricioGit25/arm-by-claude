import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARM by Claude",
  description: "CRM inmobiliario automatizado con agentes de IA que atienden, califican y pasan al agente solo los compradores reales.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // El teclado del móvil reduce la página en vez de taparla o desplazarla.
  interactiveWidget: "resizes-content",
  themeColor: "#0b0f0d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
