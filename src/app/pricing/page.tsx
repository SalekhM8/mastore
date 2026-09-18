import Link from "next/link";
import { SiteShell } from "@/components/marketing/Site";

export const metadata = { title: "Pricing" };

const INCLUDED = [
  "Every supported marketplace, no per-channel fees",
  "Unlimited listings and unlimited orders",
  "Stock sync across all channels within seconds",
  "Create once, publish everywhere",
  "Margin after fees, per item, per channel",
  "Sync page with every update and a plain-English reason for any failure",
  "Email support from the people who built it",
];

export default function PricingPage() {
  return (
    <SiteShell>
      <section className="mx-auto w-full max-w-6xl px-6 py-16">
        <div className="eyebrow text-mineral">Pricing</div>
        <h1 className="font-display mt-2 text-5xl text-naval sm:text-6xl">One plan. Every channel.</h1>
        <p className="mt-3 max-w-xl text-sm text-ink-muted">
          No tiers, no per-listing charges, no surprises when a marketplace changes its fees. That is our problem, not
          yours.
        </p>

        <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="glass-strong p-8 lg:col-span-2">
            <div className="flex flex-wrap items-end gap-3">
              <span className="font-display text-7xl text-naval">£50</span>
              <span className="mb-3 text-ink-muted">per month, plus VAT</span>
            </div>
            <p className="mt-2 text-sm text-ink-muted">
              14 day free trial. Card required, cancel any time, nothing charged until day 15.
            </p>
            <ul className="mt-6 grid grid-cols-1 gap-2 text-sm text-naval sm:grid-cols-2">
              {INCLUDED.map((i) => (
                <li key={i} className="flex gap-2">
                  <span
                    className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded-full bg-structural"
                    aria-hidden="true"
                  />
                  {i}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className="mt-8 inline-flex rounded-xl bg-structural px-5 py-3 text-sm font-semibold text-naval hover:bg-structural-600"
            >
              Start the trial
            </Link>
          </div>
          <div className="naval-scene glass-dark p-8 text-bone">
            <div className="eyebrow text-structural">Founding cohort</div>
            <h2 className="font-display mt-2 text-4xl text-optical">Ten sellers. Then the door closes for a while.</h2>
            <p className="mt-3 text-sm text-bone/80">
              The first ten UK sellers get the price locked for as long as they stay, a direct line to the founder, and
              a say in what gets built next.
            </p>
            <Link
              href="/contact"
              className="mt-6 inline-flex text-sm font-semibold text-structural underline-offset-4 hover:underline"
            >
              Ask about a place →
            </Link>
          </div>
        </div>

        <h2 className="font-display mt-16 text-3xl text-naval">Questions people ask</h2>
        <dl className="mt-4 grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
          {[
            [
              "Which marketplaces?",
              "eBay today. Amazon, Depop, TikTok Shop, Etsy, OnBuy and Vinted Pro as each platform approves us, at no extra cost.",
            ],
            ["Do you take a cut of sales?", "No. Flat monthly fee. Your sales are yours."],
            [
              "What happens to my listings if I leave?",
              "Nothing. Mastore only ever changes what you tell it to. Cancel and your listings stay exactly where they are.",
            ],
            [
              "Is my marketplace login safe?",
              "You never give us a password. Each marketplace asks you to authorise Mastore directly, and the token it gives us is encrypted at rest.",
            ],
          ].map(([q, a]) => (
            <div key={q} className="glass p-5">
              <dt className="font-semibold text-naval">{q}</dt>
              <dd className="mt-1 text-ink-muted">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </SiteShell>
  );
}
