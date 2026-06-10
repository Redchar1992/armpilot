import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ArmPilot",
  description: "Language-commanded robot arm in your browser",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
