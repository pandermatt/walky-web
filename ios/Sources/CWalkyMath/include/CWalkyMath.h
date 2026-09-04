/*
 * fdlibm, as V8 carries it.
 *
 * ECMAScript leaves exp, log, sin, cos, atan2, acos and pow
 * "implementation-approximated", and so does Swift. V8 and Darwin's libm are
 * both correct and they do not agree. Measured over the argument ranges this
 * model actually uses (tools/mathProbe.ts), they differ on:
 *
 *     atan2 19.0%   acos 15.1%   exp 10.6%   cos 5.4%   log 4.2%   sin 3.6%
 *
 * Walky's crowd is chaotic and its determinism is exact rather than
 * approximate: every fidget, trait and tie-break is a positional hash, so two
 * runs either land every pedestrian on the same pixel or they diverge and keep
 * diverging. A last-bit disagreement in `exp` is therefore not a small error --
 * it is a different run by a few hundred ticks. `acos` is worse still: it ranks
 * ear candidates in convexDecompose, so it changes how a wall is split, which
 * changes the visibility graph, which changes where everybody walks.
 *
 * V8 uses fdlibm (src/base/ieee754.cc). So does this. Matching it is the point;
 * these routines are not an optimisation and must not be "improved".
 *
 * Ported from FreeBSD msun, which is fdlibm 5.3 with the SunSoft notice intact:
 *
 *   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *   Developed at SunPro, a Sun Microsystems, Inc. business.
 *   Permission to use, copy, modify, and distribute this software is freely
 *   granted, provided that this notice is preserved.
 */
#ifndef CWALKYMATH_H
#define CWALKYMATH_H

double walky_exp(double x);
double walky_log(double x);
double walky_sin(double x);
double walky_cos(double x);
double walky_atan(double x);
double walky_atan2(double y, double x);
double walky_acos(double x);
double walky_pow(double x, double y);

#endif
