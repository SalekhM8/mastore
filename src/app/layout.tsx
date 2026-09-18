import type { Metadata } from "next";
import "./globals.css";
import { bigShoulders, inter } from "@/lib/fonts";

export const metadata: Metadata = {
  title: { default: "Mastore HQ", template: "%s · Mastore HQ" },
  description: "The commerce headquarters. One catalogue, every marketplace, stock that never oversells.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${bigShoulders.variable} h-full`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
