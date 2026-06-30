import Link from 'next/link';
import { Mail, Phone, MapPin, LifeBuoy } from 'lucide-react';
import PublicPage from '@/components/public-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export const metadata = { title: 'Contact Us — Malnad Stories' };

const CONTACTS = [
  {
    icon: Mail,
    title: 'Email support',
    note: 'We reply within 24 hours.',
    value: 'support@malnadstories.com',
    href: 'mailto:support@malnadstories.com',
  },
  {
    icon: Phone,
    title: 'Call us',
    note: 'Mon–Sat, 9:00 AM – 6:00 PM IST.',
    value: '+91 80 4567 8901',
    href: 'tel:+918045678901',
  },
];

export default function ContactPage() {
  return (
    <PublicPage
      eyebrow="Support & office"
      title="We’d love to hear from you"
      intro="Questions about custom sizes, order tracking, or corporate gifting? Our team in Bengaluru is here to help."
    >
      <div className="grid gap-8 md:grid-cols-2">
        {/* Contact info */}
        <div className="space-y-6">
          <div className="border border-border bg-card p-6 shadow-xs">
            <h2 className="mb-5 font-display text-xl font-medium tracking-tight text-primary">Get in touch directly</h2>
            <div className="space-y-5">
              {CONTACTS.map((c) => {
                const Icon = c.icon;
                return (
                  <div key={c.title} className="flex items-start gap-3.5 text-sm">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
                    <div>
                      <h3 className="font-semibold text-foreground">{c.title}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>
                      <a href={c.href} className="mt-1 block font-medium text-primary hover:underline">
                        {c.value}
                      </a>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-start gap-3.5 text-sm">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-gold" aria-hidden />
                <div>
                  <h3 className="font-semibold text-foreground">Office address</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Malnad Stories Private Limited</p>
                  <p className="mt-1.5 text-xs font-light leading-relaxed text-foreground">
                    12, Wood Street, Richmond Town,
                    <br />
                    Bengaluru, Karnataka 560025
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-border bg-primary/5 p-6">
            <h3 className="mb-2 flex items-center gap-2 font-display text-lg font-medium text-primary">
              <LifeBuoy className="h-5 w-5 shrink-0 text-gold" aria-hidden /> Already have an account?
            </h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Open a trackable support ticket inside your dashboard to reference your specific orders and
              uploaded albums.
            </p>
            <div className="mt-4">
              <Button render={<Link href="/login" />} variant="outline" size="sm">
                Go to support tickets
              </Button>
            </div>
          </div>
        </div>

        {/* Pre-auth message form.
            TODO: no public/pre-auth contact endpoint exists in the backend — this form is
            presentational. Authenticated ticketing goes through /support (createTicket). Wire
            this up only if a public contact endpoint is added later. */}
        <div className="border border-border bg-card p-6 shadow-xs">
          <h2 className="mb-5 font-display text-xl font-medium tracking-tight text-primary">Send a message</h2>
          <form className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="c-name">Your name</Label>
              <Input id="c-name" name="name" type="text" placeholder="e.g. Priya Sharma" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-email">Email address</Label>
              <Input id="c-email" name="email" type="email" placeholder="e.g. priya@example.com" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-subject">Subject</Label>
              <Input id="c-subject" name="subject" type="text" placeholder="e.g. Bulk order inquiry" className="rounded-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-message">Message</Label>
              <textarea
                id="c-message"
                name="message"
                rows={4}
                placeholder="Write your message here…"
                className="w-full resize-y rounded-sm border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow,border-color] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <Button type="button" className="h-10 w-full" disabled>
              Send message
            </Button>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              For secure, trackable requests, ticketing is managed inside your dashboard.
            </p>
          </form>
        </div>
      </div>
    </PublicPage>
  );
}
