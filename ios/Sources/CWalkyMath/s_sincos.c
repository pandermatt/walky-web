/* @(#)s_sin.c, s_cos.c 1.3 95/01/18 -- SunSoft, see include/CWalkyMath.h */
#include "fdlibm.h"
#include "CWalkyMath.h"

double walky_sin(double x) {
  double y[2], z = 0.0;
  int32_t n, ix;

  GET_HIGH_WORD(ix, x);
  ix &= 0x7fffffff;
  if (ix <= 0x3fe921fb) return walky_kernel_sin(x, z, 0);    /* |x| < pi/4 */
  if (ix >= 0x7ff00000) return x - x;                        /* sin(inf or NaN) */
  n = walky_rem_pio2(x, y);
  switch (n & 3) {
    case 0:  return  walky_kernel_sin(y[0], y[1], 1);
    case 1:  return  walky_kernel_cos(y[0], y[1]);
    case 2:  return -walky_kernel_sin(y[0], y[1], 1);
    default: return -walky_kernel_cos(y[0], y[1]);
  }
}

double walky_cos(double x) {
  double y[2], z = 0.0;
  int32_t n, ix;

  GET_HIGH_WORD(ix, x);
  ix &= 0x7fffffff;
  if (ix <= 0x3fe921fb) return walky_kernel_cos(x, z);       /* |x| < pi/4 */
  if (ix >= 0x7ff00000) return x - x;                        /* cos(inf or NaN) */
  n = walky_rem_pio2(x, y);
  switch (n & 3) {
    case 0:  return  walky_kernel_cos(y[0], y[1]);
    case 1:  return -walky_kernel_sin(y[0], y[1], 1);
    case 2:  return -walky_kernel_cos(y[0], y[1]);
    default: return  walky_kernel_sin(y[0], y[1], 1);
  }
}
