import Link from "next/link";
import { SiteShell } from "@/components/marketing/Site";

const CHANNELS = ["eBay", "Amazon", "Depop", "TikTok Shop", "Etsy", "Vinted Pro", "OnBuy", "Your storefront"];

const PILLARS = [
  {
    title: "One catalogue",
    body: "List an item once. Publish it to every marketplace you sell on, with the right fields for each.",
  },
  {
    title: "Stock that never lies",
    body: "A sale anywhere takes the item off everywhere else within seconds. No double-selling, no refunds, no apologies.",
  },
  {
    title: "Margin you can see",
    body: "Every fee schedule built in. Know what each item makes on each channel before you list it.",
  },
  {
    title: "Nothing silent",
    body: "Every update Mastore sends is on one page with a plain-English status. If a marketplace says no, you see why.",
  },
];

export default function Home() {
  return (
    <SiteShell>
      {/* Hero */}
      <section className="naval-scene relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 hidden w-24 bg-structural lg:block" aria-hidden="true" />
        <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-28">
          <div className="glass-dark max-w-2xl p-8 sm:p-10">
            <div className="eyebrow text-structural">The commerce headquarters</div>
            <h1 className="font-display mt-4 text-6xl text-optical sm:text-7xl lg:text-8xl">
              See the whole
              <br />
              market. Move first.
            </h1>
            <p className="mt-5 max-w-lg text-base text-bone/85 sm:text-lg">
              One view across every channel, listing and sale. Stock and margin problems, solved before they happen.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-structural px-5 py-3 text-sm font-semibold text-naval hover:bg-structural-600"
              >
                Enter headquarters →
              </Link>
              <Link
                href="/pricing"
                className="rounded-xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold text-optical hover:bg-white/20"
              >
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Channels strip */}
      <section className="border-b border-concrete bg-bone">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-6 py-6 text-sm text-ink-muted">
          <span className="eyebrow text-mineral">Channels</span>
          {CHANNELS.map((c) => (
            <span key={c} className="font-medium text-naval/80">
              {c}
            </span>
          ))}
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20">
        <div className="eyebrow text-mineral">What it does</div>
        <h2 className="font-display mt-2 max-w-3xl text-5xl text-naval sm:text-6xl">
          Sell everywhere. Run it from one place.
        </h2>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <div key={p.title} className="glass p-6">
              <h3 className="font-display text-3xl text-naval">{p.title}</h3>
              <p className="mt-2 text-sm text-ink-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="naval-scene text-bone">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="eyebrow text-structural">How it works</div>
          <ol className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {[
              ["Connect", "Sign in to each marketplace once. Mastore imports what you already sell."],
              ["Confirm", "Tell us which items are one-offs and which have stock. Add cost prices for margin."],
              ["Sell", "From then on a sale on any channel updates the rest. You watch it happen on the sync page."],
            ].map(([t, b], i) => (
              <li key={t} className="glass-dark p-6">
                <div className="font-display text-5xl text-structural">0{i + 1}</div>
                <h3 className="font-display mt-2 text-3xl text-optical">{t}</h3>
                <p className="mt-2 text-sm text-bone/80">{b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-6xl px-6 py-20 text-center">
        <h2 className="font-display text-5xl text-naval sm:text-6xl">£50 a month. Fourteen days free.</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-ink-muted">
          Founding cohort of ten UK sellers. Every channel, every listing, one price.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-flex rounded-xl bg-naval px-6 py-3 text-sm font-semibold text-optical hover:bg-naval-700"
        >
          Start the trial
        </Link>
      </section>
    </SiteShell>
  );
}
