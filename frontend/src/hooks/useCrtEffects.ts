import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gridiron-terminal:crt-effects';

/** Persists the CRT scanline/vignette toggle across sessions. Defaults on - the effect is subtle by design (see index.css), so there's no accessibility reason to default it off, but it's one click away. */
export function useCrtEffects(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // localStorage unavailable (private mode etc.) - the toggle still works for this session
    }
  }, [enabled]);

  return [enabled, setEnabled];
}
