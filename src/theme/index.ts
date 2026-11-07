import { Platform } from 'react-native';

/** Single, light and soft theme. */
export const colors = {
  /** page background (very light bluish gray) */
  bg: '#F3F5F9',
  /** cards, modais e menus: branco */
  card: '#FFFFFF',
  /** chips, square icons, tracks */
  surface: '#EDF1F8',
  surfaceAlt: '#E3E9F5',
  surfaceSolid: '#FFFFFF',
  border: 'rgba(15,27,51,0.08)',
  text: '#0F1B33',
  textMuted: '#66728C',
  /** income: green; accumulation, leftovers and the brand stay blue (`primary`) */
  income: '#1FA86A',
  expense: '#E0446A',
  warning: '#D9831F',
  /** refined accent blue (same as login), no neon */
  primary: '#2D55D9',
  primaryAlt: '#6F8FF5',
  /** indicator highlights (no green): net worth and financial freedom */
  violet: '#8B5CF6',
  sky: '#0EA5E9',
  onPrimary: '#FFFFFF',
  overlay: 'rgba(11,25,44,0.45)',
  /** dark sidebar (navy) */
  sidebar: '#0B192C',
  sidebarText: '#9FB0CC',
  sidebarActive: 'rgba(255,255,255,0.09)',
};

export type Colors = typeof colors;

export const gradients = {
  primary: ['#4C74F0', '#2D55D9'] as const,
  income: ['#4CC38A', '#1FA86A'] as const,
  expense: ['#F0698B', '#E0446A'] as const,
  /** progress bars */
  bar: ['#6F8FF5', '#2D55D9'] as const,
  warn: ['#F2A650', '#D9831F'] as const,
};

/** Soft, diffuse shadow (subtle in the light theme). */
export const glow = (color: string, radiusPx = 20, opacity = 0.35) => ({
  shadowColor: color,
  shadowOpacity: Math.min(opacity * 0.45, 0.25),
  shadowRadius: radiusPx,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
});

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { card: 24, control: 16, pill: 999 };
export const minTouch = 48;
export const desktopBreakpoint = 900;
export const maxContentWidth = 1320;

export const fontFamily = Platform.select({
  web: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  default: undefined,
});

export const type = {
  body: { fontSize: 16, fontWeight: '400' as const, fontFamily },
  label: { fontSize: 16, fontWeight: '600' as const, fontFamily },
  title: { fontSize: 20, fontWeight: '700' as const, fontFamily },
  hero: { fontSize: 36, fontWeight: '700' as const, fontFamily, fontVariant: ['tabular-nums' as const] },
};

export function useColors(): Colors {
  return colors;
}
