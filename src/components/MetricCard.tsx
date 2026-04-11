'use client';

import { useEffect, useRef } from 'react';
import anime from 'animejs';
import type { Icon } from '@phosphor-icons/react';

interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  subtitle: string;
  icon: Icon;
  iconColorClass?: string;
  iconBgClass?: string;
  decimals?: number;
  delay?: number;
}

export default function MetricCard({
  label,
  value,
  prefix = '',
  suffix = '',
  subtitle,
  icon: IconComponent,
  iconColorClass = 'text-brand-gold',
  iconBgClass = 'bg-brand-gold/10',
  decimals = 0,
  delay = 0,
}: MetricCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // Card entrance
    anime({
      targets: cardRef.current,
      translateY: [30, 0],
      opacity: [0, 1],
      easing: 'easeOutExpo',
      duration: 800,
      delay,
    });

    // Counter animation
    const counter = { val: 0 };
    anime({
      targets: counter,
      val: value,
      round: decimals > 0 ? Math.pow(10, decimals) : 1,
      easing: 'easeOutExpo',
      duration: 2500,
      delay: delay + 600,
      update: () => {
        if (valueRef.current) {
          const formatted = decimals > 0
            ? (counter.val / Math.pow(10, decimals)).toFixed(decimals)
            : String(counter.val);
          valueRef.current.textContent = formatted.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        }
      },
    });
  }, [value, decimals, delay]);

  // Hover handlers
  const handleEnter = () => {
    if (cardRef.current) {
      anime.remove(cardRef.current);
      anime({
        targets: cardRef.current,
        translateY: -4,
        scale: 1.01,
        boxShadow: '0 20px 50px -15px rgba(15, 23, 42, 0.10)',
        duration: 400,
        easing: 'easeOutElastic(1, .6)',
      });
    }
  };

  const handleLeave = () => {
    if (cardRef.current) {
      anime.remove(cardRef.current);
      anime({
        targets: cardRef.current,
        translateY: 0,
        scale: 1,
        boxShadow: '0 12px 40px -12px rgba(15, 23, 42, 0.06)',
        duration: 600,
        easing: 'easeOutExpo',
      });
    }
  };

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="opacity-0 bg-white rounded-xl p-5 md:p-6 border border-brand-wood/10 shadow-[0_1px_2px_0_rgba(15,23,42,0.03),0_8px_24px_-12px_rgba(15,23,42,0.08)] cursor-default"
    >
      <div className="flex items-start justify-between mb-5">
        <p className="text-[10px] font-semibold text-brand-wood/60 tracking-[0.08em] uppercase">
          {label}
        </p>
        <div className={`w-7 h-7 rounded-md ${iconBgClass} flex items-center justify-center`}>
          <IconComponent size={15} className={iconColorClass} />
        </div>
      </div>
      <div>
        <h3 className="font-serif text-[28px] md:text-[32px] leading-none text-brand-black tracking-tight flex items-baseline tabular-nums">
          {prefix}<span ref={valueRef}>{decimals > 0 ? '0.00' : '0'}</span>{suffix}
        </h3>
        <p className="mt-2 text-[11px] font-medium text-brand-wood/60">{subtitle}</p>
      </div>
    </div>
  );
}
