import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Easing, Platform } from 'react-native';

/** Motion system: subtle, fast and harmonious. */
export const motion = {
  fast: 150,
  base: 260,
  slow: 520,
  /** delay between items of a staggered entrance */
  stagger: 45,
  /** decelerates at the end (entrances) */
  easeOut: Easing.bezier(0.22, 1, 0.36, 1),
  /** default (slides and swaps) */
  ease: Easing.bezier(0.4, 0, 0.2, 1),
};

/** Respects the system's "reduce motion": no animations, only the final state. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      if (!mq) return;
      setReduced(mq.matches);
      const on = () => setReduced(mq.matches);
      mq.addEventListener?.('change', on);
      return () => mq.removeEventListener?.('change', on);
    }
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Number that follows the target with smooth interpolation (counting). On the first
 * render it counts from 0 to the value; afterwards it animates from the current value to the new one.
 */
export function useTween(target: number, duration: number = motion.slow): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const from = useRef(reduced ? target : 0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      setValue(target);
      from.current = target;
      return;
    }
    const start = Date.now();
    const origin = from.current;
    const step = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      const v = origin + (target - origin) * easeOutCubic(p);
      from.current = v;
      setValue(v);
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [target, duration, reduced]);
  return value;
}

/**
 * Like `useTween`, for a list of numbers (the slices of a chart): the first render grows them from 0 and every
 * change afterwards animates from what is on screen to the new values, so a chart never restarts from nothing.
 */
export function useTweenList(targets: number[], duration: number = motion.slow): number[] {
  const reduced = useReducedMotion();
  const sig = targets.join('|');
  const [values, setValues] = useState<number[]>(() => (reduced ? targets : targets.map(() => 0)));
  const from = useRef<number[]>(values);
  useEffect(() => {
    if (reduced) {
      from.current = targets;
      setValues(targets);
      return;
    }
    const start = Date.now();
    const origin = targets.map((_, i) => from.current[i] ?? 0);
    let id = 0;
    const step = () => {
      const p = Math.min((Date.now() - start) / duration, 1);
      const next = targets.map((t, i) => origin[i] + (t - origin[i]) * easeOutCubic(p));
      from.current = next;
      setValues(next);
      if (p < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, duration, reduced]);
  return values;
}

/** Progress from 0 to 1 that restarts whenever `sig` changes (chart drawing). */
export function useProgress(sig: string, duration: number = motion.slow): number {
  const reduced = useReducedMotion();
  const [p, setP] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      setP(1);
      return;
    }
    const start = Date.now();
    let id = 0;
    const step = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      setP(easeOutCubic(t));
      if (t < 1) id = requestAnimationFrame(step);
    };
    setP(0);
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [sig, duration, reduced]);
  return p;
}
