import React from 'react';

export type Rect = { l: number; t: number; r: number; b: number };

/** Native fallback: the 3D scene is web-only (see ControlScene.web.tsx). */
export function ControlScene(_props: { avoid?: (w: number, h: number) => Rect[]; spacing?: number }) {
  return null;
}
