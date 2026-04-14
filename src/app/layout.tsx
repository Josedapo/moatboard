import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Moatboard — Are Your Businesses Still Good?",
    template: "%s | Moatboard",
  },
  description:
    "The business quality dashboard for buy-and-hold investors. Track your theses, monitor quality scorecards, and review your positions monthly — not daily.",
  metadataBase: new URL("https://www.moatboard.com"),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className}>
      <body className="min-h-screen bg-white text-navy-950 antialiased">
        {children}
      </body>
    </html>
  );
}
