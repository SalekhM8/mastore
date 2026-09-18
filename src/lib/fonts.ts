import { Big_Shoulders, Inter } from "next/font/google";

/**
 * Inter is the product face. Big Shoulders stands in for Couture Narrow until the
 * licensed files are in /public/fonts; the CSS font stack prefers Couture when present.
 */
export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const bigShoulders = Big_Shoulders({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-big-shoulders",
  display: "swap",
});
