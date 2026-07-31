'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { DesktopSidebar } from './DesktopSidebar';
import { MobileNavigation } from './MobileNavigation';

export interface AppShellProps {
  username: string | null;
  children: ReactNode;
}

export function AppShell({ username, children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="h-dvh overflow-hidden bg-app-bg">
      <DesktopSidebar pathname={pathname} username={username} />
      <main
        className={[
          'h-dvh overflow-y-auto overflow-x-hidden overscroll-contain',
          'pb-[calc(5rem+env(safe-area-inset-bottom))] md:ml-72 md:pb-0',
        ].join(' ')}
        id="dashboard-content"
        tabIndex={-1}
      >
        {children}
      </main>
      <MobileNavigation pathname={pathname} />
    </div>
  );
}
