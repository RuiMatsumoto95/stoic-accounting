import type { Metadata } from "next";
import "./globals.css";
import NavLinks from "@/components/layout/NavLinks";
import CompanySwitcher from "@/components/layout/CompanySwitcher";
import { DisplaySettingsProvider } from "@/contexts/DisplaySettingsContext";
import { FiscalPeriodProvider } from "@/contexts/FiscalPeriodContext";
import { ToastProvider } from "@/lib/toast";
import { CompanyProvider } from "@/contexts/CompanyContext";

export const metadata: Metadata = {
  title: "Stoic Accounting",
  description: "会計システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <DisplaySettingsProvider>
          <CompanyProvider>
            <FiscalPeriodProvider>
              <ToastProvider>
                <header className="sticky top-0 z-40 flex min-w-0 items-center border-b bg-background no-print">
                  <CompanySwitcher />
                  <NavLinks />
                </header>
                <main className="flex-1">{children}</main>
              </ToastProvider>
            </FiscalPeriodProvider>
          </CompanyProvider>
        </DisplaySettingsProvider>
      </body>
    </html>
  );
}
