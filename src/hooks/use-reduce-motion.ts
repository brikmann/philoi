import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// "prefers-reduced-motion → static" (PHILOI_UI_SPEC.md §13 and the animation rules throughout).
// The read + the `reduceMotionChanged` subscription were being hand-rolled identically in a
// dozen components; this is that same pair, once. Returns false until the initial async read
// resolves, which is the safe default — a frame or two of motion before it settles beats
// suppressing animation for everyone on the first render.
export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  return reduceMotion;
}
