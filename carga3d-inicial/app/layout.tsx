import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Carga3D | Planejamento de cargas",
  description: "Planeje paletes em caminhões de médio porte e confira a distribuição em 3D.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
