'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker in a useEffect to avoid SSR/hydration mismatches.
 * Previously this was an inline <script> dangerouslySetInnerHTML in layout.tsx,
 * which caused React hydration errors when PostHog also injected script tags.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
      })
    }
  }, [])

  return null
}
