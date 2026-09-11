import type { Metadata } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face, used for headings only — see `--font-display` in globals.css.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "Badminton Queue",
  description:
    "Fair, skill-matched badminton court queueing with real-time sync across devices.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables belong on <html>, not <body>. Tailwind's preflight
    // sets `font-family` on `html`, so a variable defined one level down is
    // undefined where it is read — the declaration would be invalid at
    // computed-value time and the page would fall back to the browser default.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
