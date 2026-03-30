'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';

interface PlayerNameInputProps {
  accentColor: string;
  /** Called with fullName + avatar once registration + consent is complete */
  onReady: (name: string, avatar: string) => void;
  /** Optional brand name shown on the consent screen */
  brandName?: string;
}

const MG_USER_KEY    = 'mg_user';
const AVATAR_DEFAULT = '🦁';

interface StoredUser {
  firstName?: string;
  lastName?:  string;
  email?:     string;
  name?:      string;
  avatar?:    string;
  id?:        string;
  consented?: boolean;
}

function readUser(): StoredUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(MG_USER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as StoredUser;
    if (!p.name && !p.firstName) return null;
    const nameParts = (p.name ?? '').split(' ');
    return {
      firstName: p.firstName ?? nameParts[0] ?? '',
      lastName:  p.lastName  ?? nameParts.slice(1).join(' ') ?? '',
      email:     p.email     ?? '',
      name:      p.name      ?? [p.firstName, p.lastName].filter(Boolean).join(' '),
      avatar:    p.avatar    ?? AVATAR_DEFAULT,
      id:        p.id,
      consented: p.consented ?? false,
    };
  } catch {
    return null;
  }
}

type OverlayStep = 'welcome' | 1 | 2 | 3 | 4;

export default function PlayerNameInput({ accentColor, onReady, brandName }: PlayerNameInputProps) {
  const [step,      setStep]      = useState<OverlayStep>(1);
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [focused,   setFocused]   = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isDone,    setIsDone]    = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // ── Mount: check for returning player ───────────────────────────────────
  useEffect(() => {
    const user = readUser();
    if (user?.firstName) {
      setFirstName(user.firstName);
      setLastName(user.lastName  ?? '');
      setEmail(user.email        ?? '');
      setStep('welcome');
    }
  }, []);

  // ── Auto-focus input when step changes ──────────────────────────────────
  useEffect(() => {
    if (step === 1 || step === 2 || step === 3) {
      const t = setTimeout(() => inputRef.current?.focus(), 260);
      return () => clearTimeout(t);
    }
  }, [step]);

  // ── Dismiss overlay ──────────────────────────────────────────────────────
  const dismiss = useCallback((fullName: string, avatar: string) => {
    onReady(fullName, avatar);
    setIsExiting(true);
    const t = setTimeout(() => setIsDone(true), 220);
    return () => clearTimeout(t);
  }, [onReady]);

  // ── Returning player: continue ───────────────────────────────────────────
  const handleContinue = useCallback(() => {
    const user = readUser();
    if (!user) { setStep(1); return; }
    const fullName = user.name ?? [user.firstName, user.lastName].filter(Boolean).join(' ');
    // Pre-consented returning players (already agreed on a prior visit) skip straight to play
    if (user.consented) {
      dismiss(fullName, user.avatar ?? AVATAR_DEFAULT);
      return;
    }
    // First-time or un-consented returning players see the consent screen
    setStep(4);
  }, [dismiss]);

  // ── Returning player: edit ───────────────────────────────────────────────
  const handleEdit = useCallback(() => { setStep(1); }, []);

  // ── Advance between steps 1–3 ────────────────────────────────────────────
  const advance = useCallback(() => {
    if (step === 1 && firstName.trim()) setStep(2);
    else if (step === 2 && lastName.trim()) setStep(3);
    else if (step === 3 && email.trim()) setStep(4);
  }, [step, firstName, lastName, email]);

  // ── Complete: save + call onReady ────────────────────────────────────────
  const complete = useCallback(() => {
    let existingAvatar = AVATAR_DEFAULT;
    let existingId: string | undefined;
    try {
      const raw = localStorage.getItem(MG_USER_KEY);
      if (raw) {
        const p = JSON.parse(raw) as StoredUser;
        existingAvatar = p.avatar ?? AVATAR_DEFAULT;
        existingId     = p.id;
      }
    } catch { /* ignore */ }

    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

    try {
      localStorage.setItem(MG_USER_KEY, JSON.stringify({
        firstName:  firstName.trim(),
        lastName:   lastName.trim(),
        email:      email.trim(),
        name:       fullName,
        avatar:     existingAvatar,
        id:         existingId ?? crypto.randomUUID(),
        timestamp:  Date.now(),
        consented:  true,
      }));
    } catch { /* storage not available */ }

    dismiss(fullName, existingAvatar);
  }, [firstName, lastName, email, dismiss]);

  // ── Complete for returning player (already have data) ───────────────────
  const completeReturning = useCallback(() => {
    const user = readUser();
    if (!user) { setStep(1); return; }
    const fullName = user.name ?? [user.firstName, user.lastName].filter(Boolean).join(' ');
    dismiss(fullName, user.avatar ?? AVATAR_DEFAULT);
  }, [dismiss]);

  // ── Key handler ──────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    advance();
  }, [advance]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const currentValue = step === 1 ? firstName : step === 2 ? lastName : step === 3 ? email : '';
  const canAdvance   = step === 1 ? firstName.trim().length > 0
                     : step === 2 ? lastName.trim().length > 0
                     : step === 3 ? email.trim().length > 0
                     : false;

  const question =
    step === 1 ? "What's your first name?" :
    step === 2 ? 'And your last name?'     :
    step === 3 ? 'Your email?'             : '';

  const inputType        = step === 3 ? 'email' : 'text';
  const inputPlaceholder = step === 1 ? 'Jane' : step === 2 ? 'Smith' : 'jane@example.com';
  const autoComplete     = step === 1 ? 'given-name' : step === 2 ? 'family-name' : 'email';

  const isReturningConsent = step === 4 && !firstName; // came from welcome → step 4

  if (isDone) return null;

  const glowShadow  = focused ? `0 2px 0 0 ${accentColor}60` : 'none';
  const borderColor = focused ? accentColor : '#1a2535';

  return (
    <div
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         250,
        background:     '#08090f',
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '0 28px',
        fontFamily:     'var(--font-display, "Space Grotesk", sans-serif)',
        opacity:        isExiting ? 0 : 1,
        transition:     'opacity 0.22s ease-out',
        pointerEvents:  isExiting ? 'none' : 'all',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <AnimatePresence mode="wait">

          {/* ── Welcome back ────────────────────────────────────────────── */}
          {step === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
            >
              <p style={{ color: '#94a3b8', fontSize: 18, margin: '0 0 10px', fontWeight: 500 }}>
                Welcome back,
              </p>
              <h2 style={{
                color: '#e2e8f0', fontSize: 'clamp(32px, 8vw, 48px)',
                fontWeight: 700, margin: '0 0 48px', letterSpacing: '-0.5px', lineHeight: 1.1,
              }}>
                {firstName}
              </h2>
              <button
                data-testid="reg-welcome-continue"
                onClick={handleContinue}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  width: '100%', height: 56, borderRadius: 14, border: 'none',
                  background: accentColor, color: '#000', fontSize: 18, fontWeight: 800,
                  cursor: 'pointer', marginBottom: 16, fontFamily: 'inherit', letterSpacing: '-0.2px',
                }}
              >
                Continue <ArrowRight size={20} strokeWidth={2.5} />
              </button>
              <button
                onClick={handleEdit}
                style={{
                  background: 'none', border: 'none', color: '#94a3b8', fontSize: 15,
                  cursor: 'pointer', padding: '8px 4px', fontFamily: 'inherit',
                  width: '100%', textAlign: 'center',
                }}
              >
                Edit info
              </button>
            </motion.div>
          )}

          {/* ── Steps 1–3: data capture ─────────────────────────────────── */}
          {(step === 1 || step === 2 || step === 3) && (
            <motion.div
              key={`step-${step}`}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <h2 style={{
                color: '#e2e8f0', fontSize: 'clamp(28px, 7vw, 40px)', fontWeight: 700,
                margin: '0 0 40px', lineHeight: 1.2, letterSpacing: '-0.4px',
              }}>
                {question}
              </h2>

              <input
                ref={inputRef}
                data-testid="reg-input"
                type={inputType}
                value={currentValue}
                placeholder={inputPlaceholder}
                autoComplete={autoComplete}
                maxLength={step === 3 ? 120 : 50}
                onChange={(e) => {
                  if (step === 1)      setFirstName(e.target.value);
                  else if (step === 2) setLastName(e.target.value);
                  else                 setEmail(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={{
                  width: '100%', height: 56, background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${borderColor}`, boxShadow: glowShadow,
                  color: '#e2e8f0', fontSize: 20, fontWeight: 500, outline: 'none',
                  boxSizing: 'border-box', fontFamily: 'inherit', caretColor: accentColor,
                  paddingBottom: 8, transition: 'border-color 0.2s ease-out, box-shadow 0.2s ease-out',
                }}
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16, minHeight: 44 }}>
                <span style={{ color: '#94a3b8', fontSize: 13, flex: 1 }}>Press Enter ↵ to continue</span>
                <button
                  onClick={advance}
                  disabled={!canAdvance}
                  data-testid="reg-advance"
                  aria-label="Continue"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 44, height: 44, borderRadius: 10, border: 'none',
                    background: canAdvance ? accentColor : '#1a2535',
                    color: canAdvance ? '#000' : '#475569',
                    cursor: canAdvance ? 'pointer' : 'default',
                    transition: 'background 0.2s, color 0.2s', flexShrink: 0,
                  }}
                >
                  <ArrowRight size={20} strokeWidth={2.5} />
                </button>
              </div>

              {/* Progress dots (steps 1-3 out of 4) */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 52 }}>
                {([1, 2, 3, 4] as const).map((dot) => (
                  <div
                    key={dot}
                    style={{
                      width: dot === step ? 24 : 8, height: 8, borderRadius: 4,
                      background: dot === step ? accentColor
                                : dot < step  ? `${accentColor}60`
                                : '#1a2535',
                      transition: 'all 0.2s ease-out',
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Step 4: Consent ─────────────────────────────────────────── */}
          {step === 4 && (
            <motion.div
              key="consent"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ display: 'flex', flexDirection: 'column' }}
            >
              {/* Icon */}
              <div style={{ fontSize: 48, marginBottom: 24, lineHeight: 1 }}>🔒</div>

              <h2 style={{
                color: '#e2e8f0', fontSize: 'clamp(26px, 6vw, 36px)', fontWeight: 700,
                margin: '0 0 16px', lineHeight: 1.2, letterSpacing: '-0.4px',
              }}>
                One last thing
              </h2>

              <p style={{
                color: '#94a3b8', fontSize: 16, lineHeight: 1.65,
                margin: '0 0 40px', maxWidth: 400,
              }}>
                Your gameplay data{brandName ? ` and the info you just entered` : ''} will be collected
                {brandName ? ` by ${brandName}` : ''} to measure the impact of this experience.
                We don&apos;t sell your data.
              </p>

              <button
                data-testid="reg-consent-agree"
                onClick={isReturningConsent ? completeReturning : complete}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  width: '100%', height: 56, borderRadius: 14, border: 'none',
                  background: accentColor, color: '#000', fontSize: 18, fontWeight: 800,
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '-0.2px',
                  marginBottom: 16,
                }}
              >
                I Agree &amp; Play <ArrowRight size={20} strokeWidth={2.5} />
              </button>

              <button
                onClick={() => setStep(step === 4 && !firstName ? 'welcome' : 3)}
                style={{
                  background: 'none', border: 'none', color: '#475569', fontSize: 14,
                  cursor: 'pointer', padding: '8px 4px', fontFamily: 'inherit',
                  width: '100%', textAlign: 'center',
                }}
              >
                ← Go back
              </button>

              {/* Progress dots (step 4 of 4) */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 48 }}>
                {([1, 2, 3, 4] as const).map((dot) => (
                  <div
                    key={dot}
                    style={{
                      width: dot === 4 ? 24 : 8, height: 8, borderRadius: 4,
                      background: dot === 4 ? accentColor : `${accentColor}60`,
                      transition: 'all 0.2s ease-out',
                    }}
                  />
                ))}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      <style>{`input::placeholder { color: #334155; }`}</style>
    </div>
  );
}
