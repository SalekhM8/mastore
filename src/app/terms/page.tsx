import { Prose } from "@/components/marketing/Site";

export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <Prose eyebrow="Legal" title="Terms of service" updated="18 September 2026">
      <p>
        These terms govern your use of Mastore HQ ("Mastore", "the service"), provided by Salekh Ventures Ltd, company
        number [COMPANY NUMBER], registered office [REGISTERED ADDRESS] ("we", "us"). By creating an account you agree
        to them.
      </p>

      <h2>1. The service</h2>
      <p>
        Mastore keeps your listings, stock and prices consistent across the online marketplaces you connect. It acts
        only on your instructions and on events from your marketplaces. You remain the seller of record on every
        marketplace, and responsible for your listings, your stock and your buyers.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You must be at least 18 and using Mastore for business.</li>
        <li>Keep your sign-in details secure. You are responsible for activity under your account.</li>
        <li>
          Connecting a marketplace account confirms that you are entitled to use that account and to authorise Mastore
          on it.
        </li>
      </ul>

      <h2>3. Marketplace rules</h2>
      <p>
        Each marketplace has its own terms and policies. You agree to comply with them, and you accept that a
        marketplace may change or withdraw the access it grants to services like Mastore at any time. Where a
        marketplace's rules limit what Mastore may do, Mastore follows the marketplace's rules.
      </p>

      <h2>4. Fees</h2>
      <ul>
        <li>The subscription price is shown on the pricing page and excludes VAT.</li>
        <li>
          The free trial lasts 14 days from sign-up. A payment card is required. Nothing is charged before the trial
          ends. Cancel before then and you pay nothing.
        </li>
        <li>
          Subscriptions renew monthly until cancelled. Cancel at any time from your account; access continues to the end
          of the paid period. No refunds for partial months.
        </li>
        <li>We may change prices with 30 days' notice by email.</li>
      </ul>

      <h2>5. What we promise</h2>
      <p>
        We will provide the service with reasonable skill and care, and aim for continuous availability, but
        marketplaces, networks and our own systems can fail. We do not guarantee that every update reaches every
        marketplace at every moment. Where an update fails, the service shows you that it failed and why.
      </p>

      <h2>6. What you promise</h2>
      <ul>
        <li>Not to use Mastore for anything unlawful, or to list anything a marketplace prohibits.</li>
        <li>Not to attempt to access other sellers' data or to interfere with the service.</li>
        <li>To keep your stock figures accurate. Mastore acts on the numbers you and your marketplaces give it.</li>
      </ul>

      <h2>7. Liability</h2>
      <p>
        Nothing in these terms limits liability for death or personal injury caused by negligence, fraud, or anything
        else that cannot be limited by law. Otherwise, our total liability to you for any claim arising in a 12 month
        period is limited to the fees you paid us in that period. We are not liable for loss of profit, loss of sales,
        marketplace penalties, or indirect or consequential loss, including loss caused by a marketplace rejecting,
        delaying or reversing an update.
      </p>

      <h2>8. Data</h2>
      <p>
        Our <a href="/privacy">privacy policy</a> explains what we collect and why. You keep ownership of your catalogue
        and data. You grant us the licence needed to run the service on your behalf. When your account closes we delete
        your data as the privacy policy describes.
      </p>

      <h2>9. Ending the agreement</h2>
      <p>
        You can close your account at any time. We may suspend or close an account that breaches these terms, harms the
        service or other sellers, or where a marketplace requires it, with notice where practicable. Your listings on
        the marketplaces are unaffected by closure; Mastore never removes them unless you instruct it to.
      </p>

      <h2>10. Changes</h2>
      <p>
        We may update these terms. Material changes are emailed to account holders at least 14 days before they take
        effect. Continuing to use the service after that date means you accept them.
      </p>

      <h2>11. Law</h2>
      <p>
        These terms are governed by the law of England and Wales and the courts of England and Wales have exclusive
        jurisdiction.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:hello@mastorehq.com">hello@mastorehq.com</a>
      </p>
    </Prose>
  );
}
