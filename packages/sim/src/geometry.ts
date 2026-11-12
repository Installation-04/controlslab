// SPDX-License-Identifier: AGPL-3.0-only
import type { Point, Rotation } from './types';

/** Rotate a point clockwise (SVG coordinates, y down). */
export function rotate([x, y]: Point, rot: Rotation = 0): Point {
  switch (rot) {
    case 90:
      return [-y, x];
    case 180:
      return [-x, -y];
    case 270:
      return [y, -x];
    default:
      return [x, y];
  }
}

export const addPt = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
