/* Bit access, as fdlibm spells it. Little-endian only, which every platform
 * this ships on is. */
#ifndef WALKY_FDLIBM_H
#define WALKY_FDLIBM_H

#include <stdint.h>

typedef union { double value; struct { uint32_t lsw; uint32_t msw; } parts; } ieee_double_shape_type;

#define EXTRACT_WORDS(ix0,ix1,d) do { ieee_double_shape_type ew_u; ew_u.value = (d); (ix0) = ew_u.parts.msw; (ix1) = ew_u.parts.lsw; } while (0)
#define GET_HIGH_WORD(i,d)       do { ieee_double_shape_type gh_u; gh_u.value = (d); (i) = gh_u.parts.msw; } while (0)
#define GET_LOW_WORD(i,d)        do { ieee_double_shape_type gl_u; gl_u.value = (d); (i) = gl_u.parts.lsw; } while (0)
#define INSERT_WORDS(d,ix0,ix1)  do { ieee_double_shape_type iw_u; iw_u.parts.msw = (ix0); iw_u.parts.lsw = (ix1); (d) = iw_u.value; } while (0)
#define SET_HIGH_WORD(d,v)       do { ieee_double_shape_type sh_u; sh_u.value = (d); sh_u.parts.msw = (v); (d) = sh_u.value; } while (0)
#define SET_LOW_WORD(d,v)        do { ieee_double_shape_type sl_u; sl_u.value = (d); sl_u.parts.lsw = (v); (d) = sl_u.value; } while (0)

int walky_rem_pio2(double x, double *y);
int walky_kernel_rem_pio2(double *x, double *y, int e0, int nx, int prec, const int32_t *ipio2);
double walky_kernel_sin(double x, double y, int iy);
double walky_kernel_cos(double x, double y);

#endif
