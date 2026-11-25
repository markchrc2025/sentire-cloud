import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sentire Cloud", template: "%s | Sentire Cloud" },
  description: "One Sentire Account, one bill, and the connections between your Sentire apps.",
  icons: { icon: "/mark.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
