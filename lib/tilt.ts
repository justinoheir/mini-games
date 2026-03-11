type TiltCallback = (x: number, y: number) => void

interface TiltOptions {
  sensitivity?: number  // default 1.0
  smoothing?: number    // default 0.65 — lower = more responsive
  deadzone?: number     // default 3 degrees
  clamp?: number        // default 30 degrees maps to ±1
}

export function createTiltController(onUpdate: TiltCallback, options: TiltOptions = {}) {
  const { sensitivity = 1.0, smoothing = 0.45, deadzone = 2, clamp = 30 } = options
  let calibratedGamma = 0, calibratedBeta = 0, calibrated = false
  let smoothX = 0, smoothY = 0
  let handler: ((e: DeviceOrientationEvent) => void) | null = null
  let stopped = false

  const process = (gamma: number, beta: number) => {
    if (!calibrated) { calibratedGamma = gamma; calibratedBeta = beta; calibrated = true }
    let dx = gamma - calibratedGamma
    let dy = beta - calibratedBeta
    if (Math.abs(dx) < deadzone) dx = 0
    if (Math.abs(dy) < deadzone) dy = 0
    const nx = Math.max(-1, Math.min(1, dx / clamp)) * sensitivity
    const ny = Math.max(-1, Math.min(1, dy / clamp)) * sensitivity
    smoothX = smoothX * smoothing + nx * (1 - smoothing)
    smoothY = smoothY * smoothing + ny * (1 - smoothing)
    if (!stopped) onUpdate(smoothX, smoothY)
  }

  return {
    start: async (): Promise<boolean> => {
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        try {
          const perm = await (DeviceOrientationEvent as any).requestPermission()
          if (perm !== 'granted') return false
        } catch { return false }
      } else if (!window.DeviceOrientationEvent) return false
      handler = (e: DeviceOrientationEvent) => {
        if (e.gamma === null || e.beta === null) return
        process(e.gamma, e.beta)
      }
      window.addEventListener('deviceorientation', handler)
      return true
    },
    stop: () => { stopped = true; if (handler) window.removeEventListener('deviceorientation', handler) },
    getValues: () => ({ x: smoothX, y: smoothY }),
  }
}
