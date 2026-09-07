#!/bin/sh
# Alternate app icons, drawn from the 2016 original.
#
# walky-2016.png is `src/main/resources/images/icon.png` from the archived Java
# app, copied here rather than reached for across repositories: that repo is not
# a dependency of this one and a clone of walky-web has to be able to build.
# It is 206x274 of black-on-transparent grayscale -- a walking figure over three
# receding crosswalk stripes -- and it is the app's own first icon.
#
# Three variants of the one drawing, because the art is a silhouette and a
# silhouette is only ever as good as what is behind it. The three grounds are
# the app's own colours, not new ones: Paper and Classic are two of the four
# grounds the map offers, and Amber is ORANGE, which is what a pedestrian is
# painted and what the route to a goal is drawn in.
#
# iOS wants opaque square icons at fixed pixel sizes, and applies the rounded
# corners itself, so the figure is inset to about 68% of the square to keep it
# clear of the mask.
#
#   sh Icons/generate.sh
set -eu
cd "$(dirname "$0")/.."
SRC=Icons/walky-2016.png
OUT=App/AltIcons

render() {                       # name, ink, ground
  canvas=1024
  art=700                        # the figure's height on that canvas
  # -colorize replaces the colour of every pixel and leaves alpha alone, so the
  # silhouette keeps its shape and takes the ink. sRGB first: the source is
  # grayscale, and colorizing it in Gray just makes it a different grey.
  magick -size ${canvas}x${canvas} "xc:$3" \
    \( "$SRC" -trim +repage -resize x${art} \
       -colorspace sRGB -fill "$2" -colorize 100 \) \
    -gravity center -compose over -composite \
    -alpha remove -alpha off "$OUT/AltIcon-$1-1024.png"

  # 60pt @2x/@3x for iPhone, 76pt @2x and 83.5pt @2x for iPad.
  magick "$OUT/AltIcon-$1-1024.png" -resize 120x120 "$OUT/AltIcon-$1@2x.png"
  magick "$OUT/AltIcon-$1-1024.png" -resize 180x180 "$OUT/AltIcon-$1@3x.png"
  magick "$OUT/AltIcon-$1-1024.png" -resize 152x152 "$OUT/AltIcon-$1@2x~ipad.png"
  magick "$OUT/AltIcon-$1-1024.png" -resize 167x167 "$OUT/AltIcon-$1-83.5@2x~ipad.png"
  rm "$OUT/AltIcon-$1-1024.png"
}

render Classic '#1E1E1E' '#F2F0EB'   # ink on Paper, which is how the original reads
render Night   '#F2F0EB' '#1E1E1E'   # the same figure on the ground the crowd walks
render Amber   '#1E1E1E' '#FFC800'   # ORANGE, the colour of a pedestrian
