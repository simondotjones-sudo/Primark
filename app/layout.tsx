import type { Metadata } from "next";
import "./globals.css";
import {LanguageProvider} from '@/components/language-provider';

export const metadata: Metadata = {
  title: "Primark Safety Passport",
  description: "Primark store colleague safety induction.",
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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased"><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
