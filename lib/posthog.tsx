'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider, usePostHog } from 'posthog-js/react';
import { useEffect, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// ─── Init (runs once on client) ──────────────────────────────────────────────

if (typeof window !== 'undefined') {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    api_host: '/ingest',                    // proxied through Vercel — bypasses ad blockers
    ui_host: 'https://us.posthog.com',
    capture_pageview: false,                // we fire manually below for accurate SPA tracking
    capture_pageleave: true,
    session_recording: {
      maskAllInputs: false,                 // game inputs aren't sensitive
    },
    autocapture: true,                      // auto-tracks clicks, taps, form submissions
    persistence: 'localStorage',
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') ph.debug();
    },
  });
}

// ─── Page view tracker (SPA-aware) ───────────────────────────────────────────

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ph = usePostHog();

  useEffect(() => {
    if (pathname && ph) {
      let url = window.origin + pathname;
      if (searchParams.toString()) url += '?' + searchParams.toString();
      ph.capture('$pageview', { $current_url: url });
    }
  }, [pathname, searchParams, ph]);

  return null;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      {children}
    </PHProvider>
  );
}

// ─── Game event helpers ───────────────────────────────────────────────────────

export function trackGameStart(gameId: string, properties?: Record<string, unknown>) {
  posthog.capture('game_started', { game_id: gameId, ...properties });
}

export function trackGameComplete(
  gameId: string,
  score: number | string,
  personality: string,
  extra?: Record<string, unknown>,
) {
  posthog.capture('game_completed', {
    game_id: gameId,
    score,
    personality,
    ...extra,
  });
}

export function trackGameAbandon(gameId: string, timeLeft: number) {
  posthog.capture('game_abandoned', { game_id: gameId, time_left: timeLeft });
}
