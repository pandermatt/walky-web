/* @(#)k_sin.c, k_cos.c 1.3 95/01/18 -- SunSoft, see include/CWalkyMath.h */
#include "fdlibm.h"

static const double
half = 5.00000000000000000000e-01,
S1 = -1.66666666666666324348e-01,
S2 =  8.33333333332248946124e-03,
S3 = -1.98412698298579493134e-04,
S4 =  2.75573137070700676789e-06,
S5 = -2.50507602534068634195e-08,
S6 =  1.58969099521155010221e-10,
C1 =  4.16666666666666019037e-02,
C2 = -1.38888888888741095749e-03,
C3 =  2.48015872894767294178e-05,
C4 = -2.75573143513906633035e-07,
C5 =  2.08757232129817482790e-09,
C6 = -1.13596475577881948265e-11;

double walky_kernel_sin(double x, double y, int iy) {
  double z, r, v;
  int32_t ix;
  GET_HIGH_WORD(ix, x);
  ix &= 0x7fffffff;
  if (ix < 0x3e400000) {                 /* |x| < 2**-27 */
    if ((int)x == 0) return x;
  }
  z = x * x;
  v = z * x;
  r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy == 0) return x + v * (S1 + z * r);
  return x - ((z * (half * y - v * r) - y) - v * S1);
}

double walky_kernel_cos(double x, double y) {
  double a, hz, z, r, qx;
  int32_t ix;
  GET_HIGH_WORD(ix, x);
  ix &= 0x7fffffff;
  if (ix < 0x3e400000) {                 /* |x| < 2**-27 */
    if (((int)x) == 0) return 1.0;
  }
  z = x * x;
  r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3FD33333)                   /* |x| < 0.3 */
    return 1.0 - (0.5 * z - (z * r - x * y));
  if (ix > 0x3fe90000) {                 /* |x| > 0.78125 */
    qx = 0.28125;
  } else {
    INSERT_WORDS(qx, ix - 0x00200000, 0);  /* x/4 */
  }
  hz = 0.5 * z - qx;
  a = 1.0 - qx;
  return a - (hz - (z * r - x * y));
}
