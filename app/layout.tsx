import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Synq",
  description: "Studio operations dashboard for classes, instructors, and substitutions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
