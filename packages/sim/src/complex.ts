// SPDX-License-Identifier: AGPL-3.0-only
/** Minimal complex numbers for AC phasor analysis. */
export interface Complex {
  re: number;
  im: number;
}

export const C = (re: number, im = 0): Complex => ({ re, im });
export const ZERO: Complex = { re: 0, im: 0 };
export const add = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export const abs = (a: Complex): number => Math.hypot(a.re, a.im);
export const scale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k });
export const polar = (mag: number, deg: number): Complex => ({
  re: mag * Math.cos((deg * Math.PI) / 180),
  im: mag * Math.sin((deg * Math.PI) / 180),
});
