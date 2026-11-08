import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Height of the page the app really has. On the web the HTML can take space above the app (the install
 * banner at the top of phones): `#root` shrinks by exactly that, so the app height is `#root`'s height and
 * not the window's. Anything that decides layout from the height must use this instead of
 * `useWindowDimensions().height`. The banner tells the app when it appears or goes away with the
 * `installbanner` event (see `public/index.html`).
 */
export function useViewportHeight(): number {
  const { height } = useWindowDimensions();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener('installbanner', refresh);
    return () => window.removeEventListener('installbanner', refresh);
  }, []);
  if (Platform.OS !== 'web') return height;
  const page = document.getElementById('root')?.clientHeight;
  return page ? Math.min(height, page) : height;
}

/**
 * Height of the install banner at the top of phones while it is shown (0 otherwise, and off the web). The panels that open over
 * the app (menu, full screens, dialogs) start below it, so the banner stays visible and usable.
 */
export function useInstallBannerHeight(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const refresh = () => setTick((n) => n + 1);
    window.addEventListener('installbanner', refresh);
    window.addEventListener('resize', refresh);
    return () => {
      window.removeEventListener('installbanner', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, []);
  if (Platform.OS !== 'web') return 0;
  if (!document.body.classList.contains('install-banner-on')) return 0;
  return document.getElementById('install-banner')?.offsetHeight ?? 0;
}
