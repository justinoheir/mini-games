'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import type {
  GameWithResult,
  QAResult,
  PersonaScore,
  DimensionScore,
  Verdict,
} from './types';

// ─── Helpers ───────────────────────────────────────────────────────────────

type TabId = 'rubric' | 'personas' | 'bugs' | 'accessibility';

type DimensionKey = keyof QAResult['dimensions'];

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  visualQuality: 'Visual Quality',
  audioSync: 'Audio Sync',
  gameFeel: 'Game Feel',
  understandability: 'Understandability',
  replayability: 'Replayability',
  bugCount: 'Bug Count',
  personaScore: 'Persona Score',
};

const DIMENSION_ORDER: DimensionKey[] = [
  'visualQuality',
  'gameFeel',
  'understandability',
  'audioSync',
  'replayability',
  'bugCount',
  'personaScore',
];

const MINI_DIMENSIONS: DimensionKey[] = ['visualQuality', 'gameFeel', 'understandability'];

function verdictLabel(v: Verdict): string {
  switch (v) {
    case 'SHIP': return 'SHIP';
    case 'FIX_REQUIRED': return 'FIX REQUIRED';
    case 'BLOCKED': return 'BLOCKED';
    case 'NOT_RUN': return 'NOT RUN';
  }
}

function verdictStyle(v: Verdict): React.CSSProperties {
  switch (v) {
    case 'SHIP':
      return { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' };
    case 'FIX_REQUIRED':
      return { background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)' };
    case 'BLOCKED':
      return { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' };
    case 'NOT_RUN':
      return { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.1)' };
  }
}

function personaScoreColor(score: number): string {
  if (score >= 8) return '#4ade80';
  if (score >= 5) return '#fbbf24';
  return '#f87171';
}

function severityStyle(sev: string): React.CSSProperties {
  if (sev.startsWith('P0')) return { color: '#f87171' };
  if (sev.startsWith('P1')) return { color: '#fb923c' };
  if (sev.startsWith('P2')) return { color: '#fbbf24' };
  return { color: 'rgba(255,255,255,0.4)' };
}

function accessVerdictStyle(v: 'PASS' | 'NEEDS_FIXES' | 'BLOCKED'): React.CSSProperties {
  if (v === 'PASS') return { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' };
  if (v === 'NEEDS_FIXES') return { background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.3)' };
  return { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function ScoreBar({
  score,
  maxScore = 10,
  accentColor,
  height = 6,
}: {
  score: number;
  maxScore?: number;
  accentColor: string;
  height?: number;
}) {
  const pct = Math.min(100, (score / maxScore) * 100);
  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 999,
        height,
        overflow: 'hidden',
        flex: 1,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: accentColor,
          borderRadius: 999,
          transition: 'width 0.4s ease',
        }}
      />
    </div>
  );
}

function ExpandableDimension({
  dimKey,
  dim,
  accentColor,
}: {
  dimKey: DimensionKey;
  dim: DimensionScore;
  accentColor: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 12, marginBottom: 12 }}>
      <button
        onClick={() => setExpanded((p) => !p)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          marginBottom: 6,
        }}
      >
        <span style={{ color: 'white', fontSize: 13, fontWeight: 600, flex: 1, textAlign: 'left' }}>
          {DIMENSION_LABELS[dimKey]}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
          w{Math.round(dim.weight * 100)}%
        </span>
        <span style={{ color: accentColor, fontSize: 14, fontWeight: 700, minWidth: 24, textAlign: 'right' }}>
          {dim.score}/10
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginLeft: 4 }}>
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <ScoreBar score={dim.score} accentColor={accentColor} />
      </div>

      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
        {dim.notes}
      </p>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dim.checks.map((check, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 13, marginTop: 1, flexShrink: 0 }}>
                    {check.passed ? '✅' : '❌'}
                  </span>
                  <div>
                    <span style={{ color: check.passed ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      {check.label}
                    </span>
                    {check.note && (
                      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, display: 'block' }}>
                        {check.note}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RubricTab({ result, accentColor }: { result: QAResult; accentColor: string }) {
  return (
    <div>
      {/* Dimension Bars */}
      <div style={{ marginBottom: 24 }}>
        {DIMENSION_ORDER.map((key) => (
          <ExpandableDimension
            key={key}
            dimKey={key}
            dim={result.dimensions[key]}
            accentColor={accentColor}
          />
        ))}
      </div>

      {/* Performance Gate */}
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>⚡ Performance</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 999,
              ...(result.performance.verdict === 'PASS'
                ? { background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)' }
                : { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }),
            }}
          >
            {result.performance.verdict}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { label: 'FPS median', value: `${result.performance.fpsMedian}`, ok: result.performance.fpsMedian >= 55 },
            { label: 'FPS min', value: `${result.performance.fpsMin}`, ok: result.performance.fpsMin >= 50 },
            { label: 'Heap', value: `${result.performance.heapMB} MB`, ok: result.performance.heapMB <= 100 },
            { label: 'Heap growth', value: `${result.performance.heapGrowthMB} MB`, ok: result.performance.heapGrowthMB <= 15 },
            { label: 'Startup', value: `${result.performance.startupMs} ms`, ok: result.performance.startupMs <= 1000 },
          ].map(({ label, value, ok }) => (
            <div
              key={label}
              style={{
                background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                borderRadius: 8,
                padding: '6px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {label}
              </span>
              <span style={{ color: ok ? '#4ade80' : '#f87171', fontSize: 14, fontWeight: 700 }}>
                {value}
              </span>
            </div>
          ))}
        </div>
        {result.performance.notes && (
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            {result.performance.notes}
          </p>
        )}
      </div>

      {/* Accessibility Gate summary */}
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: 'white', fontSize: 13, fontWeight: 600 }}>♿ Accessibility Gate</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 999,
              ...accessVerdictStyle(result.accessibility.verdict),
            }}
          >
            {result.accessibility.verdict.replace('_', ' ')}
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Motor', passed: result.accessibility.motorBasicPassed, total: result.accessibility.motorBasicTotal },
            { label: 'Cognitive', passed: result.accessibility.cognitiveBasicPassed, total: result.accessibility.cognitiveBasicTotal },
            { label: 'Vision', passed: result.accessibility.visionBasicPassed, total: result.accessibility.visionBasicTotal },
            { label: 'Activation', passed: result.accessibility.activationContextPassed, total: result.accessibility.activationContextTotal },
          ].map(({ label, passed, total }) => {
            const ok = passed === total;
            return (
              <div
                key={label}
                style={{
                  background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(234,179,8,0.08)',
                  border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'rgba(234,179,8,0.2)'}`,
                  borderRadius: 8,
                  padding: '6px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {label}
                </span>
                <span style={{ color: ok ? '#4ade80' : '#fbbf24', fontSize: 14, fontWeight: 700 }}>
                  {passed}/{total}
                </span>
              </div>
            );
          })}
        </div>
        {result.accessibility.violations.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.accessibility.violations.map((v, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 10px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, ...severityStyle(v.severity), flexShrink: 0, marginTop: 1 }}>
                  {v.severity}
                </span>
                <div style={{ flex: 1 }}>
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{v.description}</span>
                  {v.fixed && (
                    <span style={{ color: '#4ade80', fontSize: 11, marginLeft: 8 }}>✓ Fixed</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PersonasTab({
  result,
  accentColor,
  selectedPersonaId,
  onSelectPersona,
}: {
  result: QAResult;
  accentColor: string;
  selectedPersonaId: string | null;
  onSelectPersona: (id: string) => void;
}) {
  const selectedPersona: PersonaScore | undefined = result.personas.find(
    (p) => p.id === selectedPersonaId
  );

  return (
    <div>
      {/* Persona pill buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
        {result.personas.map((p) => {
          const isSelected = p.id === selectedPersonaId;
          const color = personaScoreColor(p.overall);
          return (
            <button
              key={p.id}
              onClick={() => onSelectPersona(p.id)}
              style={{
                padding: '5px 12px',
                borderRadius: 999,
                border: isSelected ? `1.5px solid ${color}` : '1px solid rgba(255,255,255,0.12)',
                background: isSelected ? `${color}18` : 'rgba(255,255,255,0.04)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600 }}>
                {p.name}
              </span>
              <span
                style={{
                  background: `${color}22`,
                  color: color,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 999,
                }}
              >
                {p.overall.toFixed(1)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Persona detail */}
      <AnimatePresence mode="wait">
        {selectedPersona ? (
          <motion.div
            key={selectedPersona.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
                padding: 20,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ color: 'white', fontSize: 20, fontWeight: 700 }}>
                    {selectedPersona.name}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                    {selectedPersona.age}{selectedPersona.gender} · {selectedPersona.id}
                  </div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div
                    style={{
                      color: personaScoreColor(selectedPersona.overall),
                      fontSize: 32,
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {selectedPersona.overall.toFixed(1)}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>overall</div>
                </div>
              </div>

              {/* Score bars */}
              {[
                { label: 'Engagement', value: selectedPersona.engagement },
                { label: 'Ease', value: selectedPersona.ease },
                { label: 'Delight', value: selectedPersona.delight },
              ].map(({ label, value }) => (
                <div key={label} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{label}</span>
                    <span style={{ color: personaScoreColor(selectedPersona.overall), fontSize: 13, fontWeight: 600 }}>
                      {value}/10
                    </span>
                  </div>
                  <ScoreBar score={value} accentColor={personaScoreColor(selectedPersona.overall)} height={5} />
                </div>
              ))}

              {/* Notes */}
              <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 14, marginBottom: 0, lineHeight: 1.5 }}>
                {selectedPersona.notes}
              </p>

              {/* Risk flags */}
              {[
                { label: 'Engagement', value: selectedPersona.engagement },
                { label: 'Ease', value: selectedPersona.ease },
                { label: 'Delight', value: selectedPersona.delight },
              ]
                .filter(({ value }) => value < 5)
                .map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: 8,
                      color: '#f87171',
                      fontSize: 12,
                    }}
                  >
                    ⚠️ {label} {value} — may need attention
                  </div>
                ))}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              color: 'rgba(255,255,255,0.3)',
              fontSize: 13,
              textAlign: 'center',
              padding: '32px 16px',
            }}
          >
            Select a persona above to see details
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BugsTab({ result }: { result: QAResult }) {
  if (result.bugs.length === 0) {
    return (
      <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '32px 16px' }}>
        🎉 No bugs reported
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {['Severity', 'Description', 'Status'].map((h) => (
              <th
                key={h}
                style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontWeight: 600,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  textAlign: 'left',
                  padding: '0 12px 10px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.bugs.map((bug, i) => (
            <tr key={i}>
              <td style={{ padding: '10px 12px 10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: bug.severity.startsWith('P0')
                      ? 'rgba(239,68,68,0.15)'
                      : bug.severity.startsWith('P1')
                      ? 'rgba(249,115,22,0.15)'
                      : bug.severity.startsWith('P2')
                      ? 'rgba(234,179,8,0.15)'
                      : 'rgba(255,255,255,0.06)',
                    ...severityStyle(bug.severity),
                  }}
                >
                  {bug.severity}
                </span>
              </td>
              <td style={{ padding: '10px 12px 10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.75)', verticalAlign: 'top' }}>
                {bug.description}
                {bug.fixNote && (
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3 }}>
                    {bug.fixNote}
                  </div>
                )}
              </td>
              <td style={{ padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', verticalAlign: 'top' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 10px',
                    borderRadius: 999,
                    ...(bug.fixed
                      ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)' }
                      : { background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }),
                  }}
                >
                  {bug.fixed ? 'Fixed' : 'Open'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessibilityTab({ result }: { result: QAResult }) {
  const categories = [
    { label: 'Motor', passed: result.accessibility.motorBasicPassed, total: result.accessibility.motorBasicTotal },
    { label: 'Cognitive', passed: result.accessibility.cognitiveBasicPassed, total: result.accessibility.cognitiveBasicTotal },
    { label: 'Vision', passed: result.accessibility.visionBasicPassed, total: result.accessibility.visionBasicTotal },
    { label: 'Activation Context', passed: result.accessibility.activationContextPassed, total: result.accessibility.activationContextTotal },
  ];

  return (
    <div>
      {/* Overall verdict */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>Overall verdict:</span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: '4px 14px',
            borderRadius: 999,
            ...accessVerdictStyle(result.accessibility.verdict),
          }}
        >
          {result.accessibility.verdict.replace('_', ' ')}
        </span>
      </div>

      {/* Score bars */}
      <div style={{ marginBottom: 24 }}>
        {categories.map(({ label, passed, total }) => {
          const pct = total === 0 ? 0 : (passed / total) * 100;
          const ok = passed === total;
          return (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>{label}</span>
                <span style={{ color: ok ? '#4ade80' : '#fbbf24', fontSize: 13, fontWeight: 600 }}>
                  {passed}/{total}
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 6, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: ok ? '#4ade80' : '#fbbf24',
                    borderRadius: 999,
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* axe violations */}
      {result.accessibility.axeViolations.length > 0 && (
        <div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            axe-core Violations
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {result.accessibility.axeViolations.map((v, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '10px 14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 600 }}>{v.id}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '1px 8px',
                      borderRadius: 999,
                      background: v.impact === 'critical' ? 'rgba(239,68,68,0.15)' : v.impact === 'serious' ? 'rgba(249,115,22,0.15)' : 'rgba(234,179,8,0.15)',
                      color: v.impact === 'critical' ? '#f87171' : v.impact === 'serious' ? '#fb923c' : '#fbbf24',
                    }}
                  >
                    {v.impact}
                  </span>
                </div>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>{v.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Manual violations */}
      {result.accessibility.violations.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
            Manual Audit Violations
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {result.accessibility.violations.map((v, i) => (
              <div
                key={i}
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  gap: 10,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 700, ...severityStyle(v.severity), flexShrink: 0, marginTop: 1 }}>
                  {v.severity}
                </span>
                <div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginBottom: 2 }}>{v.category} · {v.rule}</div>
                  <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>{v.description}</div>
                  {v.fixed && <div style={{ color: '#4ade80', fontSize: 11, marginTop: 4 }}>✓ Fixed</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.accessibility.violations.length === 0 && result.accessibility.axeViolations.length === 0 && (
        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          ✅ No violations found
        </div>
      )}
    </div>
  );
}

// ─── Game Card ──────────────────────────────────────────────────────────────

function GameCard({
  gwr,
  isSelected,
  onClick,
}: {
  gwr: GameWithResult;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { game, result } = gwr;
  const verdict: Verdict = result?.verdict ?? 'NOT_RUN';
  const accentColor = result?.accentColor ?? game.accentColor;
  const weightedScore = result?.weightedScore ?? null;

  return (
    <button
      onClick={onClick}
      style={{
        background: isSelected ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        border: isSelected
          ? `1.5px solid ${accentColor}`
          : '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '14px 16px',
        cursor: 'pointer',
        textAlign: 'left',
        boxShadow: isSelected ? `0 0 0 2px ${accentColor}44` : 'none',
        transition: 'all 0.15s',
        width: '100%',
      }}
    >
      {/* Top row: emoji + name + verdict */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22 }}>{game.emoji}</span>
          <span style={{ color: 'white', fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>
            {game.title}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '3px 9px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            ...verdictStyle(verdict),
          }}
        >
          {verdictLabel(verdict)}
        </span>
      </div>

      {/* Score */}
      <div style={{ marginBottom: 10 }}>
        {weightedScore !== null ? (
          <span style={{ color: accentColor, fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
            {weightedScore.toFixed(1)}
          </span>
        ) : (
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
            —
          </span>
        )}
        {weightedScore !== null && (
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginLeft: 4 }}>/10</span>
        )}
      </div>

      {/* Mini dimension bars */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {MINI_DIMENSIONS.map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, width: 90, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {DIMENSION_LABELS[key]}
              </span>
              <ScoreBar score={result.dimensions[key].score} accentColor={accentColor} height={4} />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, width: 16, textAlign: 'right', flexShrink: 0 }}>
                {result.dimensions[key].score}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ─── Detail Panel ────────────────────────────────────────────────────────────

function DetailPanel({
  gwr,
  activeTab,
  setActiveTab,
  selectedPersonaId,
  setSelectedPersonaId,
}: {
  gwr: GameWithResult;
  activeTab: TabId;
  setActiveTab: (tab: TabId) => void;
  selectedPersonaId: string | null;
  setSelectedPersonaId: (id: string) => void;
}) {
  const { game, result } = gwr;
  const accentColor = result?.accentColor ?? game.accentColor;

  const TABS: { id: TabId; label: string }[] = [
    { id: 'rubric', label: 'Rubric' },
    { id: 'personas', label: 'Personas' },
    { id: 'bugs', label: 'Bugs' },
    { id: 'accessibility', label: 'Accessibility' },
  ];

  if (!result) {
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
          padding: 32,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>{game.emoji}</div>
        <div style={{ color: 'white', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{game.title}</div>
        <div
          style={{
            display: 'inline-block',
            fontSize: 12,
            fontWeight: 700,
            padding: '4px 14px',
            borderRadius: 999,
            marginBottom: 16,
            ...verdictStyle('NOT_RUN'),
          }}
        >
          NOT RUN
        </div>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
          No QA data available for this game yet.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: '16px 20px 0',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 24 }}>{result.gameEmoji || game.emoji}</span>
          <div>
            <div style={{ color: 'white', fontSize: 16, fontWeight: 700 }}>{result.gameName || game.title}</div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
              QA: {result.qaDate} · {result.iterationsRequired} iteration{result.iterationsRequired !== 1 ? 's' : ''}
              {result.deployUrl && (
                <> · <a href={result.deployUrl} target="_blank" rel="noopener noreferrer" style={{ color: accentColor, textDecoration: 'none' }}>deploy ↗</a></>
              )}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 12px',
                borderRadius: 999,
                ...verdictStyle(result.verdict),
              }}
            >
              {verdictLabel(result.verdict)}
            </span>
            <span style={{ color: accentColor, fontSize: 22, fontWeight: 800 }}>
              {result.weightedScore.toFixed(1)}
            </span>
          </div>
        </div>

        {/* Tab nav — underline style */}
        <div style={{ display: 'flex', gap: 0 }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: activeTab === id ? `2px solid ${accentColor}` : '2px solid transparent',
                color: activeTab === id ? 'white' : 'rgba(255,255,255,0.45)',
                fontSize: 13,
                fontWeight: activeTab === id ? 600 : 400,
                padding: '8px 16px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Panel content */}
      <div style={{ padding: 20 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {activeTab === 'rubric' && <RubricTab result={result} accentColor={accentColor} />}
            {activeTab === 'personas' && (
              <PersonasTab
                result={result}
                accentColor={accentColor}
                selectedPersonaId={selectedPersonaId}
                onSelectPersona={setSelectedPersonaId}
              />
            )}
            {activeTab === 'bugs' && <BugsTab result={result} />}
            {activeTab === 'accessibility' && <AccessibilityTab result={result} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Main Client Component ───────────────────────────────────────────────────

export default function QaDashboardClient({
  gamesWithResults,
}: {
  gamesWithResults: GameWithResult[];
}) {
  const searchParams = useSearchParams();
  const [selectedGameId, setSelectedGameId] = useState<string | null>(
    searchParams.get('game') ?? null
  );
  const [activeTab, setActiveTab] = useState<TabId>('rubric');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);

  // Auto-scroll to detail panel when deep-linked via ?game=
  useEffect(() => {
    const gameParam = searchParams.get('game');
    if (gameParam) {
      setSelectedGameId(gameParam);
      setTimeout(() => {
        document.getElementById('qa-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  }, [searchParams]);

  // Stats
  const totalGames = gamesWithResults.length;
  const testedGames = gamesWithResults.filter((g) => g.result !== null).length;
  const shipped = gamesWithResults.filter((g) => g.result?.verdict === 'SHIP').length;
  const needsFixes = gamesWithResults.filter(
    (g) => g.result?.verdict === 'FIX_REQUIRED' || g.result?.verdict === 'BLOCKED'
  ).length;
  const notRun = gamesWithResults.filter((g) => g.result === null).length;

  const selectedGWR = gamesWithResults.find((g) => g.game.id === selectedGameId) ?? null;

  function handleCardClick(id: string) {
    if (selectedGameId === id) {
      setSelectedGameId(null);
    } else {
      setSelectedGameId(id);
      setActiveTab('rubric');
      setSelectedPersonaId(null);
    }
  }

  return (
    <div
      style={{
        background: '#08090f',
        minHeight: '100vh',
        padding: '40px 16px 60px',
        fontFamily: 'inherit',
        color: 'white',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'rgba(255,255,255,0.45)',
              fontSize: 13,
              textDecoration: 'none',
              marginBottom: 16,
              transition: 'color 0.15s',
            }}
          >
            ← All Games
          </Link>
          <h1 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 4px', letterSpacing: '-0.5px' }}>
            QA Dashboard ⚔️
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 15, margin: '0 0 20px' }}>
            Ether Glimmer — Game Quality Overview
          </p>

          {/* Stats bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { label: `${testedGames} / ${totalGames} games tested`, color: 'rgba(255,255,255,0.6)' },
              { label: `${shipped} shipped`, color: '#4ade80' },
              { label: `${needsFixes} needs fixes`, color: '#fbbf24' },
              { label: `${notRun} not run`, color: 'rgba(255,255,255,0.3)' },
            ].map(({ label, color }) => (
              <div
                key={label}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 999,
                  padding: '5px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  color,
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Main layout: grid + detail panel */}
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* Game Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
              flex: selectedGWR ? '0 0 auto' : '1 1 100%',
              width: selectedGWR ? 'min(100%, 560px)' : '100%',
            }}
          >
            {gamesWithResults.map((gwr) => (
              <GameCard
                key={gwr.game.id}
                gwr={gwr}
                isSelected={selectedGameId === gwr.game.id}
                onClick={() => handleCardClick(gwr.game.id)}
              />
            ))}
          </div>

          {/* Detail Panel */}
          <AnimatePresence>
            {selectedGWR && (
              <motion.div
                id="qa-detail-panel"
                key={selectedGWR.game.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.22 }}
                style={{ flex: '1 1 360px', minWidth: 320, maxWidth: 600 }}
              >
                <DetailPanel
                  gwr={selectedGWR}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  selectedPersonaId={selectedPersonaId}
                  setSelectedPersonaId={setSelectedPersonaId}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
