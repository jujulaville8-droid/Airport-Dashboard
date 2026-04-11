import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Inter is the single display + body face for Direction A ("financial terminal").
// We load a wide weight range so we can use 600/700 for hierarchy instead of a
// separate display serif. JetBrains Mono provides the monospace tabular
// numerals for code/data blocks when we want them to stand out harder than
// Inter's built-in tabular-nums feature.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "The Tailor's Daughter — Dashboard",
  description: "AI-powered retail analytics for The Tailor's Daughter at V.C. Bird International Airport",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans bg-[var(--color-brand-cream)] text-[var(--color-brand-black)]">
        {children}
      </body>
    </html>
  );
}
