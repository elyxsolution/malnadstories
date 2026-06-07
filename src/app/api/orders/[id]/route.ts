import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/orders/:id — order status for the confirmation-page poller.
 * RLS scopes the read to the owner; a foreign/missing order is a 404.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const idCheck = z.string().uuid().safeParse(params.id);
  if (!idCheck.success) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: order } = await supabase
    .from('orders')
    .select('status')
    .eq('id', params.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  return NextResponse.json({ status: (order as { status: string }).status });
}
