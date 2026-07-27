#!/usr/bin/env python3
"""Composite an RGBA PNG onto an opaque background and re-encode it as RGB.

iOS rejects app icons that carry an alpha channel, and `apps/mobile` has a test
that reads the IHDR colour type to enforce it. Chrome's screenshot always writes
colour type 6, so every icon destined for iOS goes through here.

    flatten-png.py <in.png> <out.png> [#RRGGBB]
"""
import struct
import sys
import zlib


def chunks(data):
    i = 8
    while i < len(data):
        ln = struct.unpack(">I", data[i:i + 4])[0]
        yield data[i + 4:i + 8], data[i + 8:i + 8 + ln]
        i += 12 + ln


def unfilter(raw, w, h, bpp):
    stride = w * bpp
    out, prev, pos = [], bytearray(stride), 0
    for _ in range(h):
        ft = raw[pos]; pos += 1
        line = bytearray(raw[pos:pos + stride]); pos += stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ft == 1: line[x] = (line[x] + a) & 255
            elif ft == 2: line[x] = (line[x] + b) & 255
            elif ft == 3: line[x] = (line[x] + (a + b) // 2) & 255
            elif ft == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out.append(bytes(line)); prev = line
    return out


def chunk(tag, payload):
    return (struct.pack(">I", len(payload)) + tag + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))


def main():
    src, dst = sys.argv[1], sys.argv[2]
    bg = sys.argv[3] if len(sys.argv) > 3 else "#0B0D12"
    br, bgr, bb = (int(bg[i:i + 2], 16) for i in (1, 3, 5))

    data = open(src, "rb").read()
    idat, w, h, colour = b"", 0, 0, 6
    for tag, payload in chunks(data):
        if tag == b"IHDR":
            w, h, depth, colour = struct.unpack(">IIBB", payload[:10])
            if depth != 8 or colour not in (2, 6):
                sys.exit(f"{src}: expected 8-bit RGB or RGBA, got depth {depth} colour type {colour}")
        elif tag == b"IDAT":
            idat += payload

    # Chrome already drops the alpha channel when every pixel is opaque, so an
    # RGB input is a pass-through rather than an error.
    if colour == 2:
        open(dst, "wb").write(data)
        print(f"{dst}: {w}x{h} RGB, no alpha channel (already flat)")
        return

    rows = unfilter(zlib.decompress(idat), w, h, 4)
    out = bytearray()
    for row in rows:
        out.append(0)  # filter type: none
        for x in range(w):
            r, g, b, a = row[x * 4:x * 4 + 4]
            out += bytes(((r * a + br * (255 - a)) // 255,
                          (g * a + bgr * (255 - a)) // 255,
                          (b * a + bb * (255 - a)) // 255))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(out), 9))
           + chunk(b"IEND", b""))
    open(dst, "wb").write(png)
    print(f"{dst}: {w}x{h} RGB, no alpha channel")


main()
