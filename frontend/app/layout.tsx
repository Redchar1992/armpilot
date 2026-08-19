import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "ArmPilot — Language-grounded robot control",
  description:
    "Plan natural-language manipulation tasks, inspect every tool call, and watch a robot arm execute and verify the goal in real time.",
  applicationName: "ArmPilot",
  authors: [{ name: "Redchar1992", url: "https://github.com/Redchar1992" }],
  keywords: [
    "robotics",
    "physical AI",
    "MuJoCo",
    "LLM tool calling",
    "react-three-fiber",
  ],
  openGraph: {
    title: "ArmPilot — Language-grounded robot control",
    description: "Natural language → verified robot motion, visible end to end.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080c0e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
