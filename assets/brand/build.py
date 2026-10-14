#!/usr/bin/env python3
"""Derive every moxxy logo raster from the one master picture.

    build.py <master.png> <out-dir>

The master is a rendered picture on a black ground, so no derivative can be a
recolour of a vector: each one is cut out of that picture. Stdlib only, because
the repo ships no image library.

Writes into <out-dir>:
  moxxy-mark-<n>.png           the mark on transparency, cut out of the ground
  moxxy-icon-<n>.png           app icon: the master on a rounded macOS tile
  moxxy-icon-square-1024.png   full-bleed square with no alpha (iOS, Expo)
  moxxy-mark-template-<n>.png  one-ink menu-bar glyph (macOS template image)
  moxxy-mark-template-blink-<n>.png  the same glyph with the eyes closed
  moxxy-mark-eyeless-<n>.png   the cut-out mark with its eyes painted out
  moxxy-mark-eyes.json         where the eyes sit, as shares of the mark's side
and prints the terminal art kept in packages/plugin-cli/src/logo-data.ts.
"""
import json
import math
import os
import struct
import sys
import zlib
from collections import deque

# The ground is 0-4 black. Anything this dark AND connected to the border is
# ground; the visor is as dark but walled in by the ribbon, hence a flood fill.
GROUND_MAX = 12
# Outline pixels this close to the ground are part ground, part ribbon: their
# brightness becomes coverage so the cut edge carries no black rim.
EDGE_BAND = 3
EDGE_FULL = 48
# The eyes are the hot cores of the glow inside the visor.
EYE_MIN_RED = 200
# The visor is reached from the eyes through anything darker than this; the
# ribbon's rim is far brighter, so the fill stops at it.
VISOR_MAX = 32
# Clear space around the cut-out mark, as a share of its longer side.
MARK_MARGIN = 0.04
# At 22px an eye is barely one pixel wide; the menu-bar glyph widens its eye
# holes by this share of the mark so they still read.
TEMPLATE_EYE_GROW = 0.012

# A closed eye is a slit this share of the open eye's height.
TEMPLATE_BLINK_SLIT = 0.2
# Painting an eye out covers its glow too: the halo reaches about one eye
# width past the pill and fades over this many more eye widths.
EYE_HALO = 1.1
EYE_HALO_FADE = 0.6

MARK_SIZES = (1024, 512, 256, 128, 64, 48, 32, 16)
EYELESS_SIZES = (512, 256)
ICON_SIZES = (1024, 512, 256, 128)
TEMPLATE_SIZES = (22, 44)
TERMINAL_COLUMNS = {'LOGO_ART_RAW': 46, 'COMPACT_LOGO_ART_RAW': 24}
# A terminal cell is about twice as tall as it is wide.
TERMINAL_CELL_ASPECT = 2.1


# ---- PNG -----------------------------------------------------------------

def read_png(path):
    data = open(path, 'rb').read()
    pos, idat = 8, b''
    while pos < len(data):
        length = struct.unpack('>I', data[pos:pos + 4])[0]
        tag, payload = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        if tag == b'IHDR':
            w, h, depth, colour = struct.unpack('>IIBB', payload[:10])
            if depth != 8 or colour not in (2, 6):
                sys.exit(f'{path}: expected 8-bit RGB or RGBA')
        elif tag == b'IDAT':
            idat += payload
        pos += 12 + length
    bpp = 3 if colour == 2 else 4
    raw, stride = zlib.decompress(idat), w * bpp
    pixels, prev, pos = bytearray(), bytearray(stride), 0
    for _ in range(h):
        kind = raw[pos]
        line = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if kind == 1: line[x] = (line[x] + a) & 255
            elif kind == 2: line[x] = (line[x] + b) & 255
            elif kind == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        pixels += line
        prev = line
    rgba = bytearray(w * h * 4)
    for i in range(w * h):
        rgba[i * 4:i * 4 + 3] = pixels[i * bpp:i * bpp + 3]
        rgba[i * 4 + 3] = pixels[i * bpp + 3] if bpp == 4 else 255
    return w, h, rgba


def write_png(path, w, h, rgba, alpha=True):
    rows = bytearray()
    for y in range(h):
        row = rgba[y * w * 4:(y + 1) * w * 4]
        rows.append(0)
        rows += row if alpha else bytes(v for i, v in enumerate(row) if i % 4 != 3)

    def chunk(tag, payload):
        return (struct.pack('>I', len(payload)) + tag + payload
                + struct.pack('>I', zlib.crc32(tag + payload) & 0xFFFFFFFF))

    with open(path, 'wb') as out:
        out.write(b'\x89PNG\r\n\x1a\n'
                  + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if alpha else 2, 0, 0, 0))
                  + chunk(b'IDAT', zlib.compress(bytes(rows), 9))
                  + chunk(b'IEND', b''))


# ---- reading the picture -------------------------------------------------

def brightness(rgba, i):
    return max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])


def neighbours(i, w, h):
    x, y = i % w, i // w
    if x: yield i - 1
    if x < w - 1: yield i + 1
    if y: yield i - w
    if y < h - 1: yield i + w


def flood(w, h, seeds, accept):
    """Every pixel reachable from `seeds` through 4-neighbours that `accept`."""
    hit = bytearray(w * h)
    queue = deque(i for i in seeds if accept(i))
    for i in queue:
        hit[i] = 1
    while queue:
        for j in neighbours(queue.popleft(), w, h):
            if not hit[j] and accept(j):
                hit[j] = 1
                queue.append(j)
    return hit


def regions(w, h, member):
    """Connected regions of `member` as bounding boxes, largest first."""
    seen = bytearray(w * h)
    found = []
    for start in range(w * h):
        if not member[start] or seen[start]:
            continue
        seen[start] = 1
        queue, xs, ys = deque([start]), [], []
        while queue:
            i = queue.popleft()
            xs.append(i % w)
            ys.append(i // w)
            for j in neighbours(i, w, h):
                if member[j] and not seen[j]:
                    seen[j] = 1
                    queue.append(j)
        found.append((len(xs), (min(xs), min(ys), max(xs), max(ys))))
    found.sort(key=lambda r: -r[0])
    return found


def find_ground(w, h, rgba):
    border = [*range(w), *range((h - 1) * w, h * w), *range(0, h * w, w), *range(w - 1, h * w, w)]
    return flood(w, h, border, lambda i: brightness(rgba, i) <= GROUND_MAX)


def find_eyes(w, h, rgba, ground):
    core = bytearray(w * h)
    for i in range(w * h):
        r, g, b = rgba[i * 4:i * 4 + 3]
        if not ground[i] and r >= EYE_MIN_RED and r > g > b:
            core[i] = 1
    # The ribbon's lining glows orange too, but in long thin streaks. An eye is
    # a pill: well over twice as tall as wide, and filling most of its box.
    def is_pill(area, box):
        bw, bh = box[2] - box[0] + 1, box[3] - box[1] + 1
        return bh > 2 * bw and area > 0.7 * bw * bh

    pills = [box for area, box in regions(w, h, core) if is_pill(area, box)]
    if len(pills) < 2:
        sys.exit('could not find the two eyes in the master')
    return sorted(pills[:2])


def find_visor(w, h, rgba, ground, eyes):
    """The dark glass around the eyes, filled out to its rounded outline."""
    # Each eye sits in a halo of its own glow, about as wide as the eye itself;
    # the fill has to cross it to reach the dark glass.
    def in_eye(i):
        x, y = i % w, i // w
        return any(x0 - (x1 - x0) <= x <= x1 + (x1 - x0) and y0 - (x1 - x0) <= y <= y1 + (x1 - x0)
                   for x0, y0, x1, y1 in eyes)

    seeds = [((y0 + y1) // 2) * w + (x0 + x1) // 2 for x0, y0, x1, y1 in eyes]
    glass = flood(w, h, seeds, lambda i: not ground[i] and (brightness(rgba, i) <= VISOR_MAX or in_eye(i)))
    # Reflections leave notches in the glass; the visor is convex, so filling
    # each row between its outermost glass pixels restores the outline.
    for y in range(h):
        row = [x for x in range(w) if glass[y * w + x]]
        if row:
            for x in range(row[0], row[-1] + 1):
                glass[y * w + x] = 1
    return glass


def cut_out(w, h, rgba, ground):
    """The master with its ground made transparent and its outline anti-aliased."""
    out = bytearray(rgba)
    near = bytearray(w * h)
    frontier = [i for i in range(w * h) if ground[i]]
    for step in range(1, EDGE_BAND + 1):
        frontier = [j for i in frontier for j in neighbours(i, w, h) if not ground[j] and not near[j]]
        for j in frontier:
            near[j] = step
    for i in range(w * h):
        if ground[i]:
            out[i * 4:i * 4 + 4] = b'\0\0\0\0'
        elif near[i]:
            cover = min(1.0, brightness(rgba, i) / EDGE_FULL)
            if cover == 0:
                out[i * 4:i * 4 + 4] = b'\0\0\0\0'
                continue
            for c in range(3):
                out[i * 4 + c] = min(255, round(rgba[i * 4 + c] / cover))
            out[i * 4 + 3] = round(cover * 255)
    return out


def mark_box(w, h, cut):
    """A square around the cut-out mark, with its clear space."""
    xs = [i % w for i in range(w * h) if cut[i * 4 + 3]]
    ys = [i // w for i in range(w * h) if cut[i * 4 + 3]]
    x0, x1, y0, y1 = min(xs), max(xs) + 1, min(ys), max(ys) + 1
    side = round(max(x1 - x0, y1 - y0) * (1 + 2 * MARK_MARGIN))
    return round((x0 + x1 - side) / 2), round((y0 + y1 - side) / 2), side


def crop(w, h, rgba, box):
    left, top, side = box
    out = bytearray(side * side * 4)
    for y in range(max(0, -top), min(side, h - top)):
        x0, x1 = max(0, -left), min(side, w - left)
        src = ((top + y) * w + left + x0) * 4
        out[(y * side + x0) * 4:(y * side + x1) * 4] = rgba[src:src + (x1 - x0) * 4]
    return out


# ---- resampling ------------------------------------------------------------

def box_weights(src, dst):
    """For each output index, the (source index, share) pairs it averages."""
    scale = src / dst
    table = []
    for o in range(dst):
        a, b = o * scale, (o + 1) * scale
        table.append([(s, (min(b, s + 1) - max(a, s)) / scale)
                      for s in range(int(a), min(src, math.ceil(b)))
                      if min(b, s + 1) > max(a, s)])
    return table


def resize(w, h, rgba, nw, nh):
    """Area-average downscale in premultiplied alpha, so edges keep no dark halo."""
    alpha = [rgba[i * 4 + 3] / 255 for i in range(w * h)]
    planes = [[rgba[i * 4 + c] * alpha[i] for i in range(w * h)] for c in range(3)]
    planes.append([a * 255 for a in alpha])
    wx, wy = box_weights(w, nw), box_weights(h, nh)
    out = bytearray(nw * nh * 4)
    for c, plane in enumerate(planes):
        across = [sum(plane[y * w + s] * k for s, k in row) for y in range(h) for row in wx]
        for y, row in enumerate(wy):
            for x in range(nw):
                out[(y * nw + x) * 4 + c] = min(255, round(sum(across[s * nw + x] * k for s, k in row)))
    for i in range(nw * nh):
        a = out[i * 4 + 3]
        for c in range(3):
            out[i * 4 + c] = min(255, round(out[i * 4 + c] * 255 / a)) if a else 0
    return out


# ---- derivatives -----------------------------------------------------------

def rounded_tile(w, rgba, size):
    """macOS icon grid: the master on an 824/1024 tile with corners of radius 185."""
    tile = round(size * 824 / 1024)
    radius = tile * 185 / 824
    inset = (size - tile) // 2
    art = resize(w, w, rgba, tile, tile)
    out = bytearray(size * size * 4)
    for y in range(tile):
        for x in range(tile):
            dx = max(radius - (x + 0.5), 0, (x + 0.5) - (tile - radius))
            dy = max(radius - (y + 0.5), 0, (y + 0.5) - (tile - radius))
            cover = min(1.0, max(0.0, radius - math.hypot(dx, dy) + 0.5)) if dx and dy else 1.0
            src, dst = (y * tile + x) * 4, ((y + inset) * size + x + inset) * 4
            out[dst:dst + 3] = art[src:src + 3]
            out[dst + 3] = round(art[src + 3] * cover)
    return out


def template_glyph(mark, side, box, eyes, size, closed=False):
    """One ink, shape in alpha: the solid silhouette with the eyes punched out.

    AppKit tints a template image for the light and dark bar and reads only its
    alpha, so the glyph has to be legible as a silhouette alone. With `closed`
    each eye is a thin slit across its middle: the blink frame.
    """
    left, top, _ = box
    grow = round(side * TEMPLATE_EYE_GROW)
    ink = bytearray(side * side * 4)
    for i in range(side * side):
        ink[i * 4 + 3] = mark[i * 4 + 3]
    for x0, y0, x1, y1 in eyes:
        top_y, bottom_y = y0 - grow, y1 + grow
        if closed:
            mid, half = (top_y + bottom_y) / 2, (bottom_y - top_y) * TEMPLATE_BLINK_SLIT / 2
            top_y, bottom_y = round(mid - half), round(mid + half)
        for y in range(top_y - top, bottom_y - top + 1):
            for x in range(x0 - left - grow, x1 - left + grow + 1):
                ink[(y * side + x) * 4 + 3] = 0
    return resize(side, side, ink, size, size)


def paint_out_eyes(w, h, cut, visor, eyes):
    """The cut-out with each eye and its glow replaced by the visor's dark glass."""
    glass = [i for i in range(w * h) if visor[i] and brightness(cut, i) <= 20]
    dark = [round(sum(cut[i * 4 + c] for i in glass) / len(glass)) for c in range(3)]
    out = bytearray(cut)
    for x0, y0, x1, y1 in eyes:
        width = x1 - x0 + 1
        reach, fade = EYE_HALO * width, EYE_HALO_FADE * width
        span = math.ceil(reach + fade)
        for y in range(max(0, y0 - span), min(h, y1 + span + 1)):
            for x in range(max(0, x0 - span), min(w, x1 + span + 1)):
                dist = math.hypot(max(x0 - x, 0, x - x1), max(y0 - y, 0, y - y1))
                weight = min(1.0, max(0.0, (reach + fade - dist) / fade))
                i = (y * w + x) * 4
                for c in range(3):
                    out[i + c] = round(out[i + c] * (1 - weight) + dark[c] * weight)
    return out


def eye_layout(box, eyes):
    """Each eye's box as shares of the cut-out mark's side, for drawing on top."""
    left, top, side = box
    return {'eyes': [{'x': round((x0 - left) / side, 4), 'y': round((y0 - top) / side, 4),
                      'width': round((x1 - x0 + 1) / side, 4), 'height': round((y1 - y0 + 1) / side, 4)}
                     for x0, y0, x1, y1 in eyes]}


def terminal_art(mark, side, face, cols):
    """The mark as character art: ribbon by coverage, visor blank, eyes solid."""
    ramp = ' .:-=+*#%@'
    rows = round(cols / TERMINAL_CELL_ASPECT)
    lines = []
    for r in range(rows):
        y0, y1 = r * side // rows, (r + 1) * side // rows
        line = ''
        for c in range(cols):
            x0, x1 = c * side // cols, (c + 1) * side // cols
            cells = (y1 - y0) * (x1 - x0)
            ribbon = eye = 0.0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    i = y * side + x
                    if face[i] == 2:
                        eye += 1
                    elif not face[i]:
                        ribbon += mark[i * 4 + 3] / 255
            if eye / cells > 0.4:
                line += '@'
            else:
                line += ramp[round(ribbon / cells * (len(ramp) - 1))]
        lines.append(line.rstrip())
    # Rows holding nothing but a dotted fringe only cost the terminal height.
    while lines and not lines[0].strip(' .'):
        lines.pop(0)
    while lines and not lines[-1].strip(' .'):
        lines.pop()
    indent = min(len(l) - len(l.lstrip()) for l in lines if l)
    return [l[indent:] for l in lines]


def main():
    master, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    w, h, rgba = read_png(master)
    if w != h:
        sys.exit('the master must be square')
    ground = find_ground(w, h, rgba)
    eyes = find_eyes(w, h, rgba, ground)
    visor = find_visor(w, h, rgba, ground, eyes)
    cut = cut_out(w, h, rgba, ground)
    box = mark_box(w, h, cut)
    left, top, side = box
    mark = crop(w, h, cut, box)

    for n in MARK_SIZES:
        write_png(f'{out_dir}/moxxy-mark-{n}.png', n, n, resize(side, side, mark, n, n))
    for n in ICON_SIZES:
        write_png(f'{out_dir}/moxxy-icon-{n}.png', n, n, rounded_tile(w, rgba, n))
    write_png(f'{out_dir}/moxxy-icon-square-1024.png', 1024, 1024,
              resize(w, h, rgba, 1024, 1024), alpha=False)
    for n in TEMPLATE_SIZES:
        write_png(f'{out_dir}/moxxy-mark-template-{n}.png', n, n,
                  template_glyph(mark, side, box, eyes, n))
        write_png(f'{out_dir}/moxxy-mark-template-blink-{n}.png', n, n,
                  template_glyph(mark, side, box, eyes, n, closed=True))
    eyeless = crop(w, h, paint_out_eyes(w, h, cut, visor, eyes), box)
    for n in EYELESS_SIZES:
        write_png(f'{out_dir}/moxxy-mark-eyeless-{n}.png', n, n, resize(side, side, eyeless, n, n))
    with open(f'{out_dir}/moxxy-mark-eyes.json', 'w') as out:
        json.dump(eye_layout(box, eyes), out, indent=2)
        out.write('\n')

    face = bytearray(side * side)
    for y in range(side):
        for x in range(side):
            sx, sy = left + x, top + y
            if 0 <= sx < w and 0 <= sy < h and visor[sy * w + sx]:
                face[y * side + x] = 1
    for x0, y0, x1, y1 in eyes:
        for y in range(y0 - top, y1 - top + 1):
            for x in range(x0 - left, x1 - left + 1):
                face[y * side + x] = 2
    for name, cols in TERMINAL_COLUMNS.items():
        print(f'const {name}: ReadonlyArray<string> = [')
        for line in terminal_art(mark, side, face, cols):
            print(f"  '{line}',")
        print('];')


if __name__ == '__main__':
    main()
