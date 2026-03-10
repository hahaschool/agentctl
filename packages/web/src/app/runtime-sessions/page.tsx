import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Sessions' };

export default function Page(): never {
  redirect('/sessions?type=runtime');
}
