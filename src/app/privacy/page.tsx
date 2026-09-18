import { Prose } from "@/components/marketing/Site";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <Prose eyebrow="Legal" title="Privacy policy" updated="18 September 2026">
      <p>
        This policy explains what Mastore HQ ("Mastore", "we") collects, why, and what we do with it. Mastore is
        operated by Salekh Ventures Ltd, registered in England and Wales, company number [COMPANY NUMBER], registered
        office [REGISTERED ADDRESS]. We are the data controller for the information described here. Contact:{" "}
        <a href="mailto:security@mastorehq.com">security@mastorehq.com</a>.
      </p>

      <h2>What Mastore is</h2>
      <p>
        Mastore is a multi-channel inventory and listing service for online sellers. A seller connects their marketplace
        accounts, and Mastore keeps their listings, stock and prices consistent across those marketplaces on their
        instruction.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> Your email address and, if you choose one, a password, so you can sign
          in. Your workspace name.
        </li>
        <li>
          <strong>Marketplace connections.</strong> When you authorise Mastore on a marketplace, the marketplace gives
          us an access token for your account. We store it encrypted and use it only to perform the actions you have
          asked for. We never see or store your marketplace password.
        </li>
        <li>
          <strong>Listing and stock data.</strong> Your products, listings, prices, quantities and cost prices, imported
          from your marketplaces or entered by you.
        </li>
        <li>
          <strong>Order data needed for stock.</strong> When an item sells, we record the marketplace's order and line
          identifiers, the item, the quantity and the price, so stock can be updated. We do not store buyer names,
          delivery addresses, email addresses or phone numbers.
        </li>
        <li>
          <strong>Service logs.</strong> Technical records of requests to our service, including IP addresses, for
          security and troubleshooting. Retained for 30 days.
        </li>
        <li>
          <strong>Billing.</strong> Payment card details are collected and held by our payment processor, Stripe. We
          store only your subscription status and the last four digits of the card.
        </li>
      </ul>

      <h2>Why we use it, and the legal basis</h2>
      <ul>
        <li>To provide the service you signed up for: performance of a contract.</li>
        <li>To keep the service secure and to investigate abuse: our legitimate interests.</li>
        <li>To bill you and to keep accounting records: performance of a contract and legal obligation.</li>
        <li>
          To tell you about changes to the service: performance of a contract. We do not send marketing email without
          consent.
        </li>
      </ul>

      <h2>Marketplace data and platform policies</h2>
      <p>
        Data received from a marketplace is used only to provide Mastore's service to the seller whose account it came
        from. We do not pool it across sellers, sell it, or use it for advertising. Where a marketplace's developer
        policy imposes stricter requirements than this policy, we follow the stricter requirement.
      </p>

      <h2>Who we share it with</h2>
      <ul>
        <li>The marketplaces you connect, to carry out your instructions.</li>
        <li>
          Service providers who host and run Mastore: Supabase (database, hosted in London), Vercel (application
          hosting), Inngest (background jobs), Stripe (payments), and an email delivery provider for transactional
          email. Each is bound by contract to process data only on our instructions.
        </li>
        <li>Authorities, where the law requires.</li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>International transfers</h2>
      <p>
        Your data is stored in the United Kingdom or the European Union. Some providers operate globally; where data
        leaves the UK, we rely on the UK International Data Transfer Agreement or adequacy regulations.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Account, catalogue and stock data: for as long as your account is open, then deleted within 30 days of
          closure.
        </li>
        <li>Order identifiers: 12 months, for stock reconciliation and dispute resolution.</li>
        <li>Marketplace tokens: deleted immediately when you disconnect an account or close your account.</li>
        <li>Service logs: 30 days.</li>
        <li>Billing records: 6 years, as UK tax law requires.</li>
      </ul>

      <h2>Marketplace account deletion requests</h2>
      <p>
        If a marketplace notifies us that a user has deleted their marketplace account, we delete the data we hold that
        came from that account within 30 days and record that we did so.
      </p>

      <h2>Security</h2>
      <p>
        Marketplace tokens are encrypted at rest with keys held outside the database. All traffic is encrypted in
        transit. Access to production systems requires multi-factor authentication. We will notify affected sellers and
        any marketplace whose policy requires it without undue delay after becoming aware of a breach.
      </p>

      <h2>Your rights</h2>
      <p>
        Under UK GDPR you can ask for a copy of your data, ask us to correct or delete it, object to or restrict
        processing, and ask for it in a portable form. Email{" "}
        <a href="mailto:security@mastorehq.com">security@mastorehq.com</a>. You can also complain to the Information
        Commissioner's Office at ico.org.uk.
      </p>

      <h2>Cookies</h2>
      <p>
        Mastore uses only the cookies needed to keep you signed in and to protect forms against forgery. There are no
        advertising or tracking cookies.
      </p>

      <h2>Changes</h2>
      <p>We will post changes here and, for material changes, email account holders before they take effect.</p>
    </Prose>
  );
}
