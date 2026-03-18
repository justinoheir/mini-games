'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * /onboarding is deprecated.
 * Player info is now captured per-game via the Typeform-style PlayerNameInput overlay.
 * Redirect everyone who lands here directly to the portal.
 */
export default function OnboardingRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return null;
}
