import { Prose } from "@/components/marketing/Site";

export const metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <Prose eyebrow="Contact" title="Talk to us">
      <p>Mastore HQ is built and run by Salekh Ventures Ltd in the United Kingdom.</p>
      <ul>
        <li>
          Email: <a href="mailto:hello@mastorehq.com">hello@mastorehq.com</a>
        </li>
        <li>
          Security or privacy matters: <a href="mailto:security@mastorehq.com">security@mastorehq.com</a>
        </li>
      </ul>
      <p>
        We answer within one working day. If you are a marketplace or platform partner, the same address reaches the
        founder directly.
      </p>
      <h2>Company</h2>
      <p>
        Salekh Ventures Ltd, registered in England and Wales, company number [COMPANY NUMBER]. Registered office:
        [REGISTERED ADDRESS].
      </p>
    </Prose>
  );
}
