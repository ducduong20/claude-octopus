#!/usr/bin/env python3
"""Redraws or touches up animations in media/sprites/octopus.png.

The original sheet came from a design pass. Some rows are composed here from the same body so they
stay consistent (working, vibe, music, chill, eating); others are patched in place (coffee, lift,
tired, nearly_out, sleep, hibernate, stretch). Every step is idempotent, so the script can be run
again after a change. Music notes, food, the battery and sweat are system symbols or emoji drawn by
the overlay, not pixels.
Run from the repository root, then make_sprites.py:
    python3 -I native/macos/redraw.py && python3 -I native/macos/make_sprites.py
Letters: B body, E eyes, L light prop, K dark (sunglasses, closed eyes, eyelids), C blue (headphones,
laptop logo), R red (weight plates), '.' transparent.
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sprites import ANIMS, CELL, LETTERS, SHEET, decode_png  # noqa: E402

COLOURS = {'B': (0xd9, 0x77, 0x57), 'E': (0xff, 0xff, 0xff), 'L': (0xe6, 0xe8, 0xec), 'K': (0x1a, 0x1a, 0x1a),
           'C': (0x5a, 0xb0, 0xf0), 'R': (0xe5, 0x53, 0x4b)}


def blank():
    return [['.'] * CELL for _ in range(CELL)]


def rect(g, x0, y0, x1, y1, c):
    """Fills columns x0..x1 and rows y0..y1 (inclusive)."""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= x < CELL and 0 <= y < CELL:
                g[y][x] = c


def body(g, dy=0, dx=0, arms=True, legs=True):
    """The standing creature: head rows 10-13, arms on rows 14-15, legs on rows 18-19."""
    rect(g, 5 + dx, 10 + dy, 16 + dx, 17 + dy, 'B')
    if arms:
        rect(g, 3 + dx, 14 + dy, 4 + dx, 15 + dy, 'B')
        rect(g, 17 + dx, 14 + dy, 18 + dx, 15 + dy, 'B')
    if legs:
        for x in (6, 8, 13, 15):
            rect(g, x + dx, 18 + dy, x + dx, 19, 'B')


def eyes(g, rows=(12, 13), dy=0, dx=0):
    for x in (7, 14):
        for y in rows:
            g[y + dy][x + dx] = 'E'


def laptop(g):
    """Seen from behind, like in the coffee animation: the lid hides the lower body, a blue dot
    on it is the logo, and the keyboard edge runs across the legs."""
    rect(g, 7, 14, 14, 17, 'L')
    rect(g, 10, 15, 11, 16, 'C')
    rect(g, 3, 18, 18, 18, 'L')


def typing_arms(g, f):
    """Arms working the keys on either side of the lid, one up while the other is down."""
    up_left = f % 2 == 0
    rect(g, 3, 15 if up_left else 16, 4, 15 if up_left else 17, 'B')
    rect(g, 17, 16 if up_left else 15, 18, 17 if up_left else 15, 'B')


def working(f, _orig):
    g = blank()
    body(g, arms=False)
    # Eyes on the screen, glancing from one side of it to the other.
    for x in ((7, 14) if f in (0, 1) else (8, 15)):
        g[12][x] = 'E'
    laptop(g)
    typing_arms(g, f)
    return g


def vibe(f, _orig):
    g = blank()
    nod = 1 if f in (1, 3) else 0  # head drops a row on the beat
    rect(g, 5, 10 + nod, 16, 17, 'B')
    for x in (6, 8, 13, 15):
        g[19][x] = 'B'
    sunglasses(g, 11 + nod)
    laptop(g)
    typing_arms(g, f)
    return g


def sunglasses(g, y):
    """Two dark lenses and a bridge, rows y and y + 1."""
    rect(g, 6, y, 9, y + 1, 'K')
    rect(g, 12, y, 15, y + 1, 'K')
    rect(g, 10, y, 11, y, 'K')


def music(f, _orig):
    g = blank()
    dx = (0, 1, 0, -1)[f]
    body(g, dx=dx)
    # Closed happy eyes (^ ^) and a smile.
    for x in (7, 14):
        g[12][x + dx] = 'E'
        g[13][x - 1 + dx] = 'E'
        g[13][x + 1 + dx] = 'E'
    g[15][9 + dx] = 'E'
    g[15][12 + dx] = 'E'
    rect(g, 10 + dx, 16, 11 + dx, 16, 'E')
    # Blue headphones: a band over the head and a cup on each side.
    rect(g, 6 + dx, 8, 15 + dx, 8, 'C')
    g[9][5 + dx] = 'C'
    g[9][16 + dx] = 'C'
    rect(g, 3 + dx, 10, 4 + dx, 13, 'C')
    rect(g, 17 + dx, 10, 18 + dx, 13, 'C')
    return g


def chill(f, _orig):
    """Like vibe coding without the laptop: sunglasses, a smile, a slow bob."""
    g = blank()
    dy = 1 if f in (2, 3) else 0
    rect(g, 5, 10 + dy, 16, 17, 'B')
    rect(g, 3, 14 + dy, 4, 15 + dy, 'B')
    rect(g, 17, 14 + dy, 18, 15 + dy, 'B')
    for x in (6, 8, 13, 15):
        rect(g, x, 18, x, 19, 'B')
    sunglasses(g, 11 + dy)
    g[14 + dy][9] = 'E'
    g[14 + dy][12] = 'E'
    rect(g, 10, 15 + dy, 11, 15 + dy, 'E')
    return g


def eating(f, _orig):
    """Icon-free: the overlay drops the food on frames 0-2."""
    g = blank()
    body(g)
    if f in (0, 1, 2):
        eyes(g, rows=(11, 12))  # looking up at what is falling
        if f == 2:
            rect(g, 9, 14, 12, 15, 'E')  # mouth wide open
    elif f in (3, 4):
        for x in (6, 7, 14, 15):
            g[13][x] = 'K'  # eyes squeezed shut, munching
        if f == 3:
            rect(g, 10, 15, 11, 15, 'E')
        else:
            g[15][9] = 'E'
            g[15][12] = 'E'
            rect(g, 10, 16, 11, 16, 'E')
    else:
        eyes(g)
        rect(g, 10, 15, 11, 15, 'E')
    return g


# ---- patches to the designed frames


def closed_eyes(f, g, rows=None):
    """Sleeping: the white eye slits become dark closed lids."""
    for y in rows or range(CELL):
        for x in range(CELL):
            if g[y][x] == 'E':
                g[y][x] = 'K'
    return g


def coffee(f, g):
    rect(g, 10, 15, 11, 16, 'C')  # the same laptop logo
    return g


def lift(f, g):
    """Red weight plates on the light bar."""
    cells = [(x, y) for y in range(CELL) for x in range(CELL) if g[y][x] in 'LR']
    if cells:
        lo = min(x for x, _ in cells)
        hi = max(x for x, _ in cells)
        for x, y in cells:
            g[y][x] = 'R' if x <= lo + 1 or x >= hi - 1 else 'L'
    return g


def tired(f, g):
    """Heavy dark lids over the eyes; no sigh puffs (they read as hearts)."""
    for y in range(CELL):
        for x in range(5):
            if g[y][x] == 'B' and not (3 <= x and 14 <= y <= 17):
                g[y][x] = '.'
    lid_eyes(g)
    return g


def lid_eyes(g):
    """Puts a dark lid on top of each eye: white eye pixels with body above them."""
    for y in range(1, CELL):
        for x in range(CELL):
            if g[y][x] == 'E' and g[y - 1][x] == 'B' and y < 15:
                g[y - 1][x] = 'K'
    return g


def nearly_out(f, g):
    """Droopy lids; the pixel battery goes (the overlay draws a red one)."""
    for y in range(9):
        g[y] = ['.'] * CELL
    return lid_eyes(g)


def stretch(f, g):
    return closed_eyes(f, g) if f in (0, 1) else g


REDRAW = {'working': working, 'vibe': vibe, 'music': music, 'chill': chill, 'eating': eating,
          'coffee': coffee, 'lift': lift, 'tired': tired, 'tired_walk': lambda f, g: lid_eyes(g),
          'nearly_out': nearly_out, 'sleep': closed_eyes, 'hibernate': closed_eyes, 'stretch': stretch}


def encode_png(w, h, px):
    raw = b''.join(b'\x00' + bytes(c for p in row for c in p) for row in px)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    w, h, px = decode_png(SHEET)
    px = [list(row) for row in px]
    letter = {**LETTERS, **{v: k for k, v in COLOURS.items()}}
    for row, (name, n, _fps, _loops) in enumerate(ANIMS):
        if name not in REDRAW:
            continue
        for f in range(6):
            orig = [[letter.get(px[row * CELL + y][f * CELL + x][:3], '.') if px[row * CELL + y][f * CELL + x][3] >= 128 else '.'
                     for x in range(CELL)] for y in range(CELL)]
            g = REDRAW[name](f, orig) if f < n else blank()
            for y in range(CELL):
                for x in range(CELL):
                    c = g[y][x]
                    px[row * CELL + y][f * CELL + x] = COLOURS[c] + (255,) if c != '.' else (0, 0, 0, 0)
    open(SHEET, 'wb').write(encode_png(w, h, px))
    print(f'redrew {", ".join(REDRAW)} in {SHEET}')


if __name__ == '__main__':
    main()
