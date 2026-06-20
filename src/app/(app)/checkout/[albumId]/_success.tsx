'use client';

import Link from 'next/link';
import { MapPin, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Cinematic success moment (Claude Design). Shown ONLY after the order reaches a paid
 * state (the poller / verify path) — it never drives payment; it's pure presentation
 * over the existing order state. The finished book swings closed, a gold rule draws in,
 * then the Track / Library CTAs appear.
 */
export default function SuccessScreen({
  orderId,
  albumTitle,
  coverUrl,
  estDelivery,
  email,
}: {
  orderId: string;
  albumTitle: string;
  coverUrl: string | null;
  estDelivery: string;
  email: string;
}) {
  return (
    <div className="fixed inset-0 z-[9500] flex flex-col items-center justify-center overflow-hidden bg-[#122019] px-6 text-center">
      {/* closing book */}
      <div className="animate-book-close flex h-[150px] shadow-[0_30px_60px_rgb(0_0_0/0.45)]">
        <div className="w-3 rounded-l-[1px] bg-[linear-gradient(90deg,#16271f,#244235)]" />
        <div className="flex w-[120px] flex-col items-center justify-center bg-[linear-gradient(140deg,#234639,#1a3328)] px-4 text-center">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <>
              <span className="text-[7px] uppercase tracking-[0.2em] text-[#b89a5c]">Malnad Stories</span>
              <span className="my-2.5 h-px w-5 bg-[#b89a5c]/70" />
              <span className="font-display text-[17px] leading-tight text-[#ecd9ad]">{albumTitle}</span>
            </>
          )}
        </div>
      </div>

      <p className="animate-fade-in mt-9 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#b89a5c]" style={{ animationDelay: '1.3s' }}>
        Order {orderId}
      </p>
      <h1 className="animate-rise mt-5 max-w-[16ch] font-display text-[clamp(2.6rem,7vw,3.75rem)] font-normal leading-[1.04] text-[#f5efe3]" style={{ animationDelay: '1.4s' }}>
        Your story is on its way.
      </h1>
      <span className="animate-draw-line mt-7 h-px bg-[linear-gradient(90deg,transparent,#b89a5c,transparent)]" style={{ ['--dw' as string]: '280px' }} />
      <p className="animate-fade-in mt-7 text-[15px] font-light text-[#a9bdb0]" style={{ animationDelay: '2.2s' }}>
        Hand-bound and delivered by <strong className="font-medium text-[#ecd9ad]">{estDelivery}</strong>.
        {email ? (
          <>
            <br />
            We’ve emailed your receipt to {email}.
          </>
        ) : null}
      </p>

      <div className="animate-fade-in mt-9 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: '2.5s' }}>
        <Button
          render={<Link href={`/orders/${orderId}`} />}
          className="border-0 bg-[#ecd9ad] text-[#1e3a2f] hover:bg-[#f2e3bd]"
        >
          <MapPin /> Track your album
        </Button>
        <Button
          variant="outline"
          render={<Link href="/dashboard" />}
          className="border-[#ecd9ad]/40 bg-transparent text-[#ecd9ad] hover:bg-[#ecd9ad]/10"
        >
          <Library /> Back to library
        </Button>
      </div>
    </div>
  );
}
