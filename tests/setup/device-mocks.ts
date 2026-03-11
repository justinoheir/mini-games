/**
 * Device API Mocks for Game QA Testing
 * Import this in every game test file.
 * Simulates accelerometer, microphone, haptics, and camera.
 */

import { Page } from '@playwright/test'

// ─── Accelerometer Mock ───────────────────────────────────────────────────────

export async function mockAccelerometer(page: Page, options?: {
  x?: number   // default 2.0 (gentle tilt right)
  y?: number   // default 1.0
  z?: number   // default 9.8 (gravity)
  fireImmediately?: boolean
}) {
  const { x = 2.0, y = 1.0, z = 9.8, fireImmediately = true } = options ?? {}

  await page.addInitScript(({ x, y, z, fireImmediately }) => {
    // Mock iOS permission API
    ;(window as any).DeviceMotionEvent = class MockDeviceMotionEvent extends Event {
      acceleration = { x, y, z }
      accelerationIncludingGravity = { x, y, z }
      rotationRate = { alpha: 0, beta: 5, gamma: 3 }
      interval = 16
      static requestPermission = async () => 'granted'
    }

    // Mock DeviceOrientationEvent for gamma/beta
    ;(window as any).DeviceOrientationEvent = class MockDeviceOrientationEvent extends Event {
      alpha = 0; beta = 10; gamma = 5; absolute = false
      static requestPermission = async () => 'granted'
    }

    if (fireImmediately) {
      const originalAddEventListener = window.addEventListener.bind(window)
      window.addEventListener = (type: string, listener: any, options?: any) => {
        originalAddEventListener(type, listener, options)
        if (type === 'devicemotion') {
          setTimeout(() => {
            const e = new (window as any).DeviceMotionEvent('devicemotion')
            window.dispatchEvent(e)
          }, 100)
        }
        if (type === 'deviceorientation') {
          setInterval(() => {
            const e = new (window as any).DeviceOrientationEvent('deviceorientation')
            window.dispatchEvent(e)
          }, 16)
        }
      }
    }
  }, { x, y, z, fireImmediately })
}

// ─── Microphone Mock ──────────────────────────────────────────────────────────

export async function mockMicrophone(page: Page, options?: {
  volumeLevel?: number        // 0-100, default 0 (silent)
  volumePattern?: 'silent' | 'loud' | 'breathing' | 'spike'
}) {
  const { volumeLevel = 0, volumePattern = 'silent' } = options ?? {}

  await page.addInitScript(({ volumeLevel, volumePattern }) => {
    // Mock getUserMedia
    const mockStream = {
      getTracks: () => [{ stop: () => {} }],
      getAudioTracks: () => [{ stop: () => {} }]
    }
    navigator.mediaDevices = {
      ...navigator.mediaDevices,
      getUserMedia: async () => mockStream as any
    }

    // Mock AudioContext + AnalyserNode
    let tick = 0
    class MockAnalyserNode {
      fftSize = 256
      smoothingTimeConstant = 0.3
      frequencyBinCount = 128

      getByteFrequencyData(arr: Uint8Array) {
        tick++
        let v = 0
        switch (volumePattern) {
          case 'silent':   v = 2; break
          case 'loud':     v = 80; break
          case 'breathing': v = 20 + Math.sin(tick / 30) * 15; break
          case 'spike':    v = tick % 60 < 5 ? 90 : 5; break
          default:         v = volumeLevel * 1.28
        }
        arr.fill(Math.min(255, Math.max(0, v)))
      }

      getByteTimeDomainData(arr: Uint8Array) { arr.fill(128) }
      connect() {}
      disconnect() {}
    }

    class MockAudioContext {
      state = 'running'
      createAnalyser() { return new MockAnalyserNode() }
      createMediaStreamSource() { return { connect: () => {} } }
      close() { return Promise.resolve() }
    }

    ;(window as any).AudioContext = MockAudioContext
    ;(window as any).webkitAudioContext = MockAudioContext
  }, { volumeLevel, volumePattern })
}

// ─── Haptics Mock ─────────────────────────────────────────────────────────────

export async function mockHaptics(page: Page) {
  await page.addInitScript(() => {
    const vibrateLog: number[][] = []
    navigator.vibrate = (pattern: number | number[]) => {
      vibrateLog.push(Array.isArray(pattern) ? pattern : [pattern])
      return true
    }
    ;(window as any).__vibrateLog = vibrateLog
  })
}

export async function getVibrateLog(page: Page): Promise<number[][]> {
  return page.evaluate(() => (window as any).__vibrateLog ?? [])
}

// ─── Camera Mock ──────────────────────────────────────────────────────────────

export async function mockCamera(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 240
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#333'
    ctx.fillRect(0, 0, 320, 240)
    const stream = (canvas as any).captureStream?.(30) ?? { getTracks: () => [] }
    navigator.mediaDevices = {
      ...navigator.mediaDevices,
      getUserMedia: async () => stream
    }
  })
}

// ─── localStorage Helpers ─────────────────────────────────────────────────────

export async function setStoredUser(page: Page, name = 'Test User', email = 'test@test.com') {
  await page.addInitScript(({ name, email }) => {
    localStorage.setItem('mg_user', JSON.stringify({ name, email, timestamp: Date.now() }))
  }, { name, email })
}

export async function getStoredScores(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('mg_scores')
    return raw ? JSON.parse(raw) : {}
  })
}
