import { cookies } from 'next/headers';
import { AppShell } from '@/components/shell/AppShell';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Proxy has already guaranteed a valid session by the time we get here —
  // this call just reads the username for display in the sidebar.
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  const username = session?.user ?? null;

  return <AppShell username={username}>{children}</AppShell>;
}
