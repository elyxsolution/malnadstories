'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
      {busy ? <Loader2 className="animate-spin" /> : null} {active ? 'Disable' : 'Enable'}
    </Button>
  );
}
