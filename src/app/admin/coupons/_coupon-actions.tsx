'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { setCouponActive } from '@/lib/actions/admin/coupons';

export default function CouponToggle({ couponId, active }: { couponId: string; active: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    const res = await setCouponActive({ couponId, active: !active });
    setBusy(false);
    if (res.ok) router.refresh();
  };

  return (
    <Button variant="ghost" size="sm" onClick={toggle} disabled={busy}>
      {busy ? <InlineLoader /> : null} {active ? 'Disable' : 'Enable'}
    </Button>
  );
}
