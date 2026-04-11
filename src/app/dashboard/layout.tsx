import { cookies } from 'next/headers';
import Sidebar from '@/components/Sidebar';
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

  return (
    <div className="flex min-h-screen overflow-hidden relative">
      <Sidebar userEmail={username} />
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative z-10 w-full min-w-0">
        <div className="flex-1 overflow-y-auto overflow-x-hidden w-full pb-24 md:pb-16 scroll-smooth">
          {children}
        </div>
      </main>
    </div>
  );
}
