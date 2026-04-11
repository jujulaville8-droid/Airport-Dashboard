'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import anime from 'animejs';
import {
  SquaresFour,
  Receipt,
  AirplaneTilt,
  CalendarBlank,
  CurrencyDollar,
  Package,
  SignOut,
} from '@phosphor-icons/react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: SquaresFour },
  { href: '/dashboard/sales', label: 'Sales', icon: Receipt },
  { href: '/dashboard/inventory', label: 'Inventory', icon: Package },
  { href: '/dashboard/flights', label: 'Flights', icon: AirplaneTilt },
  { href: '/dashboard/schedules', label: 'Schedules', icon: CalendarBlank },
  { href: '/dashboard/concession', label: 'Concession', icon: CurrencyDollar },
];

interface SidebarProps {
  userEmail?: string | null;
}

export default function Sidebar({ userEmail }: SidebarProps = {}) {
  const pathname = usePathname();
  // `userEmail` may be a username ("admin") or an email — derive initials from
  // whichever comes in. Split on @ first (email-safe) then on word separators.
  const initials = userEmail
    ? userEmail
        .split('@')[0]
        .split(/[._-]/)
        .map((p) => p[0]?.toUpperCase())
        .filter(Boolean)
        .slice(0, 2)
        .join('') || userEmail[0]?.toUpperCase() || 'U'
    : 'SM';
  const brandRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tl = anime.timeline({ easing: 'easeOutExpo', duration: 800 });

    tl.add({
      targets: brandRef.current,
      translateY: [20, 0],
      opacity: [0, 1],
      duration: 1000,
    }).add({
      targets: navRef.current?.children,
      translateX: [-20, 0],
      opacity: [0, 1],
      delay: anime.stagger(100),
    }, '-=600').add({
      targets: bottomRef.current,
      translateY: [10, 0],
      opacity: [0, 1],
    }, '-=600');
  }, []);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-[260px] bg-brand-linen border-r border-brand-wood/10 shadow-[4px_0_24px_rgba(15,23,42,0.04)] z-20 h-screen shrink-0 pb-6 relative">
        <div ref={brandRef} className="px-8 pt-12 pb-10 opacity-0">
          <h1 className="font-serif text-[22px] leading-tight tracking-wide text-brand-black w-3/4">
            The Tailor&apos;s<br />Daughter
          </h1>
          <div className="h-[2px] w-8 bg-brand-gold mt-4 mb-3" />
          <p className="text-[9px] uppercase tracking-[0.2em] font-medium text-brand-wood/60 leading-relaxed max-w-[180px]">
            V.C. Bird International<br />Airport
          </p>
        </div>

        <nav ref={navRef} className="flex-1 px-4 flex flex-col gap-1.5 mt-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`opacity-0 group relative flex items-center gap-3 px-4 py-3 rounded-r-lg transition-colors duration-300 ${
                  isActive ? 'bg-brand-gold/[0.04]' : 'hover:bg-brand-gold/[0.03]'
                }`}
              >
                <div className={`absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full transition-colors ${
                  isActive ? 'bg-brand-gold' : 'bg-transparent group-hover:bg-brand-wood/20'
                }`} />
                <Icon
                  size={20}
                  className={`transition-colors ${
                    isActive ? 'text-brand-gold' : 'text-brand-wood/70 group-hover:text-brand-black'
                  }`}
                />
                <span className={`text-sm font-medium tracking-wide transition-colors ${
                  isActive ? 'text-brand-black' : 'text-brand-wood/80 group-hover:text-brand-black'
                }`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div ref={bottomRef} className="mt-auto px-6 opacity-0">
          <div className="pt-6 border-t border-brand-wood/10 flex items-center gap-3 group">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-brand-gold flex items-center justify-center text-brand-black font-serif font-bold text-[15px] border-2 border-transparent group-hover:border-brand-wood/20 transition-colors">
                {initials}
              </div>
              <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-[2.5px] border-brand-linen" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-xs font-semibold text-brand-black truncate">
                {userEmail ?? 'Store Manager'}
              </span>
              <span className="text-[10px] font-medium text-brand-wood/60 mt-0.5 tracking-wide">
                The Tailor&apos;s Daughter
              </span>
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="p-2 rounded-lg text-brand-wood/50 hover:text-brand-black hover:bg-brand-gold/10 transition-colors cursor-pointer"
              >
                <SignOut size={16} />
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-brand-linen/95 backdrop-blur-md border-t border-brand-wood/15 shadow-[0_-4px_20px_rgba(15,23,42,0.05)] pb-safe pt-2">
        <ul className="flex justify-around items-end px-2 pb-5 pt-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <li key={item.href} className="w-1/4">
                <Link
                  href={item.href}
                  className={`flex flex-col items-center gap-1.5 transition-colors ${
                    isActive ? 'text-brand-gold' : 'text-brand-wood/60 hover:text-brand-black'
                  }`}
                >
                  <Icon size={24} weight={isActive ? 'fill' : 'regular'} />
                  <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
