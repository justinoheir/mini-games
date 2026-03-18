export interface PersonaScore {
  id: string
  name: string
  age: number
  gender: string
  engagement: number
  ease: number
  delight: number
  overall: number
  notes: string
}

export interface DimensionCheck {
  label: string
  passed: boolean
  note?: string
}

export interface DimensionScore {
  score: number
  weight: number
  notes: string
  checks: DimensionCheck[]
}

export interface Bug {
  severity: 'P0' | 'P0-A' | 'P1' | 'P1-A' | 'P2' | 'P2-A' | 'P3'
  description: string
  fixed: boolean
  fixNote?: string
}

export interface AccessibilityViolation {
  category: string
  rule: string
  severity: 'P0-A' | 'P1-A' | 'P2-A'
  description: string
  fixed: boolean
}

export interface AxeViolation {
  id: string
  impact: string
  description: string
  elements: string[]
}

export interface AccessibilityResult {
  motorBasicPassed: number
  motorBasicTotal: number
  cognitiveBasicPassed: number
  cognitiveBasicTotal: number
  visionBasicPassed: number
  visionBasicTotal: number
  activationContextPassed: number
  activationContextTotal: number
  violations: AccessibilityViolation[]
  axeViolations: AxeViolation[]
  verdict: 'PASS' | 'NEEDS_FIXES' | 'BLOCKED'
}

export interface PerformanceResult {
  fpsMedian: number
  fpsMin: number
  heapMB: number
  heapGrowthMB: number
  startupMs: number
  verdict: 'PASS' | 'FAIL'
  notes?: string
}

export type Verdict = 'SHIP' | 'FIX_REQUIRED' | 'BLOCKED' | 'NOT_RUN'

export interface QAResult {
  gameId: string
  gameName: string
  gameEmoji: string
  accentColor: string
  sensor: 'touch' | 'motion' | 'mic' | 'camera'
  durationSeconds: number
  qaDate: string
  qaAgent?: string
  verdict: Verdict
  weightedScore: number
  dimensions: {
    visualQuality: DimensionScore
    audioSync: DimensionScore
    gameFeel: DimensionScore
    understandability: DimensionScore
    replayability: DimensionScore
    bugCount: DimensionScore
    personaScore: DimensionScore
  }
  performance: PerformanceResult
  accessibility: AccessibilityResult
  personas: PersonaScore[]
  bugs: Bug[]
  iterationsRequired: number
  deployUrl?: string
}

export interface GameInfo {
  id: string
  emoji: string
  title: string
  tagline: string
  href: string
  accentColor: string
  duration: string
}

export interface GameWithResult {
  game: GameInfo
  result: QAResult | null
}
