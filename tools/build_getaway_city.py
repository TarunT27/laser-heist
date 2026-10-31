"""Night city for the getaway drive, built in Blender.

Run:  npx tsx tools/export-getaway-city.ts
      ~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_getaway_city.py [-- --preview]

The street grid comes from art/getaway-city.json (exported from client/heist/getaway-sim.ts), so every
building block sits exactly on the collision rectangles the van and police drive around.
Downtown glass towers give way to concrete offices, brick walk-ups and shop streets; three parks;
streetlights, signals, crossings and trees on every street; the crew's getaway house north of the city.

Exports public/heist/getaway-city.glb and art/getaway-city.blend (plus art/getaway-preview-*.png).
The node GarageDoor is the house's roll-up door; the game lifts it when the van arrives.
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import build_heist_hd as kit  # noqa: E402
from build_heist_hd import Mat, World, color, fbm, make_image  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ART, OUT = ROOT / "art", ROOT / "public" / "heist"
LAYOUT = json.loads((ART / "getaway-city.json").read_text())
HALF, ROADS, RECTS = LAYOUT["half"], LAYOUT["roads"], LAYOUT["rects"]
HOUSE, DROP = LAYOUT["house"], LAYOUT["dropoff"]
PREVIEW = "--preview" in sys.argv
SIDEWALK = 2.2


# ─── Textures (6 m facade tiles: two 3 m storeys of three 2 m bays) ──────────

class Canvas:
    """A metre-addressed RGB image; row 0 is the top of the tile."""

    def __init__(self, metres: float, n: int, base):
        self.m, self.n = metres, n
        self.rgb = np.empty((n, n, 3), dtype=np.float32)
        self.rgb[:] = base

    def rect(self, x0, y0, x1, y1, col, target=None):
        p = self.n / self.m
        r0, r1 = int(self.n - y1 * p), int(self.n - y0 * p)
        c0, c1 = int(x0 * p), int(x1 * p)
        (self.rgb if target is None else target)[max(0, r0):max(0, r1), max(0, c0):max(0, c1)] = col


def tex_brick(seed: int, base=(0.42, 0.17, 0.11), lit=0.35, windows=True):
    rng = np.random.default_rng(seed)
    n = 1024
    cv = Canvas(6, n, (0.3, 0.29, 0.27))
    p = n / 6
    rows, bh, bw = int(6 / 0.075), int(0.075 * p), int(0.23 * p)
    for r in range(rows):
        off = (r % 2) * bw // 2
        for c in range(-1, n // bw + 1):
            x0 = c * bw + off
            shade = color(base) * (0.75 + 0.4 * rng.random())
            cv.rgb[r * bh + 1:(r + 1) * bh - 1, max(0, x0 + 1):max(0, x0 + bw - 1)] = shade
    cv.rgb *= (0.9 + 0.15 * fbm(n, 8, 4, seed))[..., None]
    glow = np.zeros_like(cv.rgb)
    if windows:
        stone = (0.72, 0.68, 0.6)
        for f in range(2):
            for b in range(3):
                x0, y0 = b * 2 + 0.5, f * 3 + 0.9
                cv.rect(x0 - 0.08, y0 - 0.12, x0 + 1.08, y0 + 1.68, stone)
                if rng.random() < lit:
                    warm = color((1.0, 0.72, 0.38)) * (0.75 + 0.25 * rng.random())
                    cv.rect(x0, y0, x0 + 1, y0 + 1.5, warm)
                    cv.rect(x0, y0 + 1.1, x0 + 1, y0 + 1.5, warm * 0.6)
                    cv.rect(x0, y0, x0 + 1, y0 + 1.5, warm, glow)
                else:
                    cv.rect(x0, y0, x0 + 1, y0 + 1.5, (0.04, 0.05, 0.07))
                cv.rect(x0 + 0.47, y0, x0 + 0.53, y0 + 1.5, stone)
    return cv.rgb, glow


def tex_ribbon(seed: int, base=(0.55, 0.55, 0.53)):
    """Concrete office: a continuous window band per storey, offices lit in runs."""
    rng = np.random.default_rng(seed)
    n = 1024
    cv = Canvas(6, n, base)
    cv.rgb *= (0.88 + 0.16 * fbm(n, 6, 4, seed))[..., None]
    glow = np.zeros_like(cv.rgb)
    for f in range(2):
        y0 = f * 3 + 0.95
        cv.rect(0, y0, 6, y0 + 1.5, (0.05, 0.07, 0.09))
        for b in range(6):
            if rng.random() < 0.32:
                cool = color((0.75, 0.88, 1.0)) * (0.7 + 0.3 * rng.random())
                cv.rect(b + 0.04, y0 + 0.05, b + 0.96, y0 + 1.45, cool)
                cv.rect(b + 0.04, y0 + 0.05, b + 0.96, y0 + 1.45, cool, glow)
            cv.rect(b - 0.03, y0, b + 0.03, y0 + 1.5, (0.2, 0.22, 0.24))
    return cv.rgb, glow


def tex_curtain(seed: int, frame=(0.1, 0.12, 0.15), lit_col=(0.7, 0.86, 1.0), lit=0.3):
    """Curtain wall: 1 m panes, a dark spandrel at each 3 m floor, offices lit in runs along a floor."""
    rng = np.random.default_rng(seed)
    n = 1024
    cv = Canvas(6, n, frame)
    glow = np.zeros_like(cv.rgb)
    for f in range(2):
        y0 = f * 3
        on = np.zeros(6, bool)
        c = 0
        while c < 6:
            run = int(rng.integers(1, 4))
            if rng.random() < lit:
                on[c:c + run] = True
            c += run + int(rng.integers(0, 2))
        tint = 0.6 + 0.4 * rng.random()
        for b in range(6):
            x0 = b + 0.05
            if on[b]:
                col = color(lit_col) * tint
                cv.rect(x0, y0 + 0.8, x0 + 0.9, y0 + 2.9, col)
                cv.rect(x0, y0 + 2.5, x0 + 0.9, y0 + 2.9, col * 0.55)
                cv.rect(x0, y0 + 0.8, x0 + 0.9, y0 + 2.9, col * 0.8, glow)
            else:
                cv.rect(x0, y0 + 0.8, x0 + 0.9, y0 + 2.9, (0.03 + 0.04 * (b % 2), 0.05, 0.08))
    cv.rgb *= (0.92 + 0.12 * fbm(n, 4, 3, seed))[..., None]
    return cv.rgb, glow


def tex_storefront(seed: int):
    """Street level, 0–3.4 m: big lit windows in dark frames with shelf silhouettes; fascia above."""
    rng = np.random.default_rng(seed)
    n = 1024
    cv = Canvas(6, n, (0.07, 0.07, 0.08))
    glow = np.zeros_like(cv.rgb)
    for b in range(3):
        x0 = b * 2 + 0.12
        warm = color((1.0, 0.8, 0.52) if rng.random() < 0.6 else (0.75, 0.9, 1.0)) * (0.55 + 0.3 * rng.random())
        cv.rect(x0, 0.35, x0 + 1.76, 3.0, warm)
        cv.rect(x0, 0.35, x0 + 1.76, 3.0, warm * 0.75, glow)
        for shelf in (0.9, 1.6, 2.3):
            cv.rect(x0 + 0.1, shelf, x0 + 1.66, shelf + 0.08, warm * 0.35)
            cv.rect(x0 + 0.1, shelf, x0 + 1.66, shelf + 0.08, warm * 0.2, glow)
        cv.rect(x0 + 0.86, 0.35, x0 + 0.9, 3.0, (0.05, 0.05, 0.05))
    cv.rect(0, 3.0, 6, 3.4, (0.12, 0.12, 0.13))
    return cv.rgb, glow


def tex_billboard(seed: int):
    rng = np.random.default_rng(seed)
    n = 512
    y, x = np.mgrid[0:n, 0:n] / n
    pal = [((0.95, 0.25, 0.35), (0.15, 0.05, 0.25)), ((0.15, 0.75, 0.95), (0.02, 0.08, 0.2)), ((1.0, 0.72, 0.2), (0.25, 0.08, 0.02)), ((0.4, 0.95, 0.55), (0.02, 0.15, 0.1))][seed % 4]
    rgb = color(pal[1])[None, None, :] * (1 - y[..., None]) + color(pal[0])[None, None, :] * y[..., None] * 0.6
    cx, cy, r = 0.25 + rng.random() * 0.15, 0.5, 0.28
    rgb[(x - cx) ** 2 + (y - cy) ** 2 < r * r] = pal[0]
    for k in range(3):
        rgb[(np.abs(y - (0.3 + k * 0.2)) < 0.035) & (x > 0.55) & (x < 0.92 - k * 0.1)] = (1, 1, 1)
    rgb[(y < 0.04) | (y > 0.96) | (x < 0.02) | (x > 0.98)] = (0.9, 0.9, 0.9)
    return rgb


# ─── Materials ───────────────────────────────────────────────────────────────

def materials():
    def brick(name, seed, base, lit):
        rgb, glow = tex_brick(seed, base, lit)
        return Mat(name, img=make_image(name, rgb), emit_img=make_image(name + "_glow", half(glow)), size=6, rough=0.85, emit=1.5)

    def ribbon(name, seed, base):
        rgb, glow = tex_ribbon(seed, base)
        return Mat(name, img=make_image(name, rgb), emit_img=make_image(name + "_glow", half(glow)), size=6, rough=0.6, emit=1.2)

    def half(glow):
        return glow[::2, ::2]

    def glass(name, seed, frame, lit_col):
        rgb, glow = tex_curtain(seed, frame, lit_col)
        return Mat(name, img=make_image(name, rgb), emit_img=make_image(name + "_glow", half(glow)), size=6, rough=0.12, metal=0.5, emit=1.2)

    def storefront(name, seed):
        rgb, glow = tex_storefront(seed)
        return Mat(name, img=make_image(name, rgb), emit_img=make_image(name + "_glow", half(glow)), size=6, rough=0.2, metal=0.2, emit=1.1)

    plain_brick, _ = tex_brick(91, (0.46, 0.2, 0.13), 0, windows=False)
    plain_brick = plain_brick[::2, ::2]
    return {
        "ground": Mat("OuterGround", img=make_image("outer_ground", kit.tex_grass(256, 5)), size=10, rough=0.95),
        "road": Mat("Asphalt", img=make_image("asphalt", kit.tex_asphalt(512, 3)), size=8, rough=0.85),
        "paint": Mat("LanePaint", (0.86, 0.84, 0.76), rough=0.6, emit=0.15),
        "yellow": Mat("YellowPaint", (0.92, 0.7, 0.15), rough=0.6, emit=0.15),
        "walk": Mat("Sidewalk", img=make_image("sidewalk", kit.tex_paver(512, 7)), size=3, rough=0.8),
        "curb": Mat("Curb", (0.55, 0.55, 0.53), rough=0.8),
        "grass": Mat("ParkGrass", img=make_image("park_grass", kit.tex_grass(512, 9)), size=5, rough=0.95),
        "path": Mat("ParkPath", (0.5, 0.46, 0.4), rough=0.9),
        "hedge": Mat("Hedge", (0.07, 0.16, 0.07), rough=0.9),
        "bark": Mat("Bark", (0.18, 0.12, 0.08), rough=0.9),
        "leaf": Mat("Leaves", (0.08, 0.19, 0.08), rough=0.85),
        "glass_cool": glass("GlassCool", 101, (0.1, 0.12, 0.16), (0.7, 0.86, 1.0)),
        "glass_warm": glass("GlassWarm", 102, (0.13, 0.11, 0.09), (1.0, 0.8, 0.5)),
        "glass_teal": glass("GlassTeal", 103, (0.06, 0.12, 0.13), (0.65, 0.95, 0.95)),
        "office_a": ribbon("OfficeConcrete", 111, (0.55, 0.55, 0.53)),
        "office_b": ribbon("OfficeSandstone", 112, (0.62, 0.55, 0.45)),
        "brick_red": brick("BrickRed", 121, (0.42, 0.17, 0.11), 0.38),
        "brick_tan": brick("BrickTan", 122, (0.55, 0.42, 0.3), 0.32),
        "brick_dark": brick("BrickDark", 123, (0.25, 0.14, 0.11), 0.36),
        "roof": Mat("RoofGravel", (0.16, 0.17, 0.18), rough=0.95),
        "trim": Mat("StoneTrim", (0.62, 0.6, 0.55), rough=0.7),
        "metal": Mat("Metal", (0.45, 0.47, 0.5), rough=0.4, metal=0.8),
        "dark": Mat("DarkMetal", (0.06, 0.065, 0.07), rough=0.45, metal=0.6),
        "lamp": Mat("StreetLamp", (1.0, 0.8, 0.5), emit=7),
        "beacon": Mat("Beacon", (1.0, 0.12, 0.1), emit=10),
        "sig_red": Mat("SignalRed", (1.0, 0.1, 0.08), emit=6),
        "sig_amber": Mat("SignalAmber", (1.0, 0.6, 0.05), emit=1.0),
        "sig_green": Mat("SignalGreen", (0.1, 1.0, 0.45), emit=6),
        "shop_warm": storefront("StorefrontA", 131),
        "shop_cool": storefront("StorefrontB", 132),
        "fountain": Mat("FountainGlow", (0.4, 0.75, 0.95), emit=1.5),
        "signs": [Mat(f"Sign{i}", c, emit=2.6) for i, c in enumerate([(1.0, 0.2, 0.35), (0.2, 0.75, 1.0), (1.0, 0.7, 0.15), (0.45, 1.0, 0.5), (0.85, 0.35, 1.0)])],
        "awnings": [Mat(f"Awning{i}", c, rough=0.8) for i, c in enumerate([(0.55, 0.08, 0.08), (0.08, 0.3, 0.2), (0.12, 0.15, 0.35), (0.5, 0.35, 0.08)])],
        "boards": [Mat(f"Billboard{i}", img=make_image(f"billboard{i}", tex_billboard(i)), size=8, emit=3.0) for i in range(4)],
        "barrier": Mat("Barrier", (0.62, 0.62, 0.6), rough=0.9),
        "house_brick": Mat("HouseBrick", img=make_image("house_brick", plain_brick), size=6, rough=0.85),
        "shingle": Mat("Shingle", (0.17, 0.15, 0.14), rough=0.9),
        "white": Mat("WhitePaint", (0.86, 0.84, 0.8), rough=0.6),
        "wood": Mat("DoorWood", (0.3, 0.17, 0.09), rough=0.6),
        "garage": Mat("GarageDoor", (0.5, 0.48, 0.45), rough=0.5, metal=0.3),
        "warm_window": Mat("HouseWindow", (1.0, 0.75, 0.42), emit=2.5),
        "garage_inside": Mat("GarageInside", (1.0, 0.8, 0.55), emit=0.8),
        "lawn": Mat("Lawn", img=make_image("lawn", kit.tex_grass(512, 13)), size=4, rough=0.95),
        "concrete": Mat("Driveway", (0.45, 0.45, 0.44), rough=0.85),
    }


# ─── Pieces ──────────────────────────────────────────────────────────────────

def ext(W, group, mat, x0, x1, y0, y1, z0, z1, bevel=0.0):
    W.box(group, mat, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), bevel=bevel)


def flat(W, group, mat, x0, x1, z0, z1, y=0.004):
    """A single upward-facing quad: road paint needs no sides or underside."""
    bm = kit.bmesh.new()
    v = [bm.verts.new(p) for p in ((x0, 0, z0), (x0, 0, z1), (x1, 0, z1), (x1, 0, z0))]
    bm.faces.new(v)
    W._merge(bm, group, mat, kit.Matrix.Translation((0, y, 0)))


def tree(W, x, z, y0, M, rng, scale=1.0):
    h = rng.uniform(2.6, 3.6) * scale
    W.cyl("Static", M["bark"], (x, y0 + h / 2, z), 0.12 * scale, h, seg=6, r2=0.08 * scale)
    W.sphere("Static", M["leaf"], (x, y0 + h + 0.3 * scale, z), 1.35 * scale, seg=8, rings=5, scale=(1, 0.85, 1))
    W.sphere("Static", M["leaf"], (x + 0.5 * scale, y0 + h + 0.9 * scale, z - 0.3 * scale), 0.9 * scale, seg=7, rings=4)


def streetlight(W, x, z, toward, M):
    """Pole on the sidewalk, arm reaching over the road along `toward` (unit vector)."""
    W.cyl("Static", M["dark"], (x, 3.6, z), 0.08, 7.2, seg=8, r2=0.06)
    W.pipe("Static", M["dark"], (x, 7.0, z), (x + toward[0] * 1.8, 7.2, z + toward[1] * 1.8), 0.05, seg=6)
    W.box("Static", M["lamp"], (x + toward[0] * 1.9, 7.1, z + toward[1] * 1.9), (0.5, 0.14, 0.5))


def signal(W, x, z, face, M, red: bool):
    W.cyl("Static", M["dark"], (x, 2.4, z), 0.07, 4.8, seg=8)
    W.box("Static", M["dark"], (x, 4.4, z), (0.38, 1.1, 0.38))
    lamps = (M["sig_red"] if red else M["dark"], M["dark"], M["dark"] if red else M["sig_green"])
    for k, m in enumerate(lamps):
        W.box("Static", m, (x + face[0] * 0.2, 4.75 - k * 0.33, z + face[1] * 0.2), (0.22 if face[0] == 0 else 0.04, 0.22, 0.04 if face[0] == 0 else 0.22))


def ring(W, group, mat, x0, x1, z0, z1, y, h, out=0.25):
    ext(W, group, mat, x0 - out, x1 + out, y, y + h, z0 - out, z0 + out)
    ext(W, group, mat, x0 - out, x1 + out, y, y + h, z1 - out, z1 + out)
    ext(W, group, mat, x0 - out, x0 + out, y, y + h, z0, z1)
    ext(W, group, mat, x1 - out, x1 + out, y, y + h, z0, z1)


def tower(W, lot, M, rng, central):
    x0, x1, z0, z1 = lot
    h = round((48 + rng.random() * 30 + central * 40) / 3) * 3
    skin = M[rng.choice(["glass_cool", "glass_teal", "glass_warm"])]
    ext(W, "Buildings", M["shop_cool"], x0 + 0.4, x1 - 0.4, 0, 6, z0 + 0.4, z1 - 0.4)
    ext(W, "Buildings", M["dark"], x0, x1, 5.9, 6.4, z0, z1)
    split = round(h * 0.62 / 3) * 3
    ext(W, "Buildings", skin, x0 + 0.6, x1 - 0.6, 6.4, split, z0 + 0.6, z1 - 0.6)
    inset = min(3.0, (x1 - x0) * 0.18, (z1 - z0) * 0.18)
    ext(W, "Buildings", M["dark"], x0 + 0.4, x1 - 0.4, split, split + 0.6, z0 + 0.4, z1 - 0.4)
    ext(W, "Buildings", skin, x0 + 0.6 + inset, x1 - 0.6 - inset, split + 0.6, h, z0 + 0.6 + inset, z1 - 0.6 - inset)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    ext(W, "Buildings", M["roof"], x0 + 0.7 + inset, x1 - 0.7 - inset, h, h + 0.3, z0 + 0.7 + inset, z1 - 0.7 - inset)
    ext(W, "Buildings", M["metal"], cx - 3, cx + 3, h + 0.3, h + 3.3, cz - 2.5, cz + 2.5)
    W.cyl("Static", M["metal"], (cx + 2, h + 7.5, cz + 1.5), 0.12, 9, seg=6, r2=0.05)
    W.sphere("Static", M["beacon"], (cx + 2, h + 12.1, cz + 1.5), 0.3, seg=8, rings=6)


def office(W, lot, M, rng):
    x0, x1, z0, z1 = lot
    h = round((15 + rng.random() * 21) / 3) * 3
    ext(W, "Buildings", M[rng.choice(["office_a", "office_b"])], x0 + 0.3, x1 - 0.3, 0, h, z0 + 0.3, z1 - 0.3)
    ring(W, "Buildings", M["trim"], x0 + 0.3, x1 - 0.3, z0 + 0.3, z1 - 0.3, h, 0.9, 0.2)
    ext(W, "Buildings", M["roof"], x0 + 0.5, x1 - 0.5, h, h + 0.15, z0 + 0.5, z1 - 0.5)
    for k in range(rng.randint(2, 4)):
        ax, az = rng.uniform(x0 + 3, x1 - 5), rng.uniform(z0 + 3, z1 - 5)
        ext(W, "Buildings", M["metal"], ax, ax + 2.2, h + 0.15, h + 1.6, az, az + 1.6, bevel=0.05)
    ext(W, "Buildings", M["trim"], x0 + 2, x0 + 5, h, h + 3, z0 + 2, z0 + 5)


def walkup(W, lot, M, rng, street):
    x0, x1, z0, z1 = lot
    h = 3 * rng.randint(4, 8)
    ext(W, "Buildings", M[rng.choice(["brick_red", "brick_tan", "brick_dark"])], x0 + 0.3, x1 - 0.3, 0, h, z0 + 0.3, z1 - 0.3)
    ring(W, "Buildings", M["trim"], x0 + 0.3, x1 - 0.3, z0 + 0.3, z1 - 0.3, h - 0.3, 0.6, 0.35)
    ring(W, "Buildings", M["trim"], x0 + 0.3, x1 - 0.3, z0 + 0.3, z1 - 0.3, 3.0, 0.25, 0.12)
    ext(W, "Buildings", M["roof"], x0 + 0.5, x1 - 0.5, h, h + 0.15, z0 + 0.5, z1 - 0.5)
    # Fire escape on the street face: landings, rails and ladders.
    sx, sz = street
    if sx:
        fx, fz, along = (x1 if sx > 0 else x0) + sx * 0.7, (z0 + z1) / 2, "z"
    else:
        fx, fz, along = (x0 + x1) / 2, (z1 if sz > 0 else z0) + sz * 0.7, "x"
    for f in range(1, h // 3):
        y = f * 3
        size = (2.6, 0.06, 1.0) if along == "x" else (1.0, 0.06, 2.6)
        W.box("Buildings", M["dark"], (fx, y, fz), size)
        rail = (2.6, 0.9, 0.04) if along == "x" else (0.04, 0.9, 2.6)
        W.box("Buildings", M["dark"], (fx + sx * 0.48, y + 0.45, fz + sz * 0.48), rail)
        if f > 1:
            a = (fx - (1.0 if along == "x" else 0), y - 3, fz - (1.0 if along == "z" else 0))
            b = (fx + (1.0 if along == "x" else 0), y, fz + (1.0 if along == "z" else 0))
            W.pipe("Buildings", M["dark"], a, b, 0.04, seg=4)
    # Water tank on legs.
    tx, tz = rng.uniform(x0 + 3, x1 - 3), rng.uniform(z0 + 3, z1 - 3)
    for lx in (-0.9, 0.9):
        for lz in (-0.9, 0.9):
            W.cyl("Buildings", M["dark"], (tx + lx, h + 1.1, tz + lz), 0.07, 2.2, seg=4)
    W.cyl("Buildings", M["wood"], (tx, h + 3.4, tz), 1.4, 2.4, seg=14)
    W.cyl("Buildings", M["shingle"], (tx, h + 5.0, tz), 1.5, 0.8, seg=14, r2=0.1)


def shops(W, lot, M, rng, street, board_dir):
    x0, x1, z0, z1 = lot
    h = rng.choice([4.5, 6, 7.5])
    ext(W, "Buildings", M["brick_tan"], x0 + 0.3, x1 - 0.3, 3.4, h, z0 + 0.3, z1 - 0.3)
    ext(W, "Buildings", M[rng.choice(["shop_warm", "shop_cool"])], x0 + 0.6, x1 - 0.6, 0, 3.4, z0 + 0.6, z1 - 0.6)
    sign, awn = rng.choice(M["signs"]), rng.choice(M["awnings"])
    sx, sz = street
    if sx:
        fx = x1 - 0.25 if sx > 0 else x0 + 0.25
        ext(W, "Buildings", sign, fx - 0.1, fx + 0.1, 3.0, 3.6, z0 + 1.5, z1 - 1.5)
        ext(W, "Buildings", awn, fx + sx * 0.6 - 0.6, fx + sx * 0.6 + 0.6, 2.75, 2.85, z0 + 1.5, z1 - 1.5)
    else:
        fz = z1 - 0.25 if sz > 0 else z0 + 0.25
        ext(W, "Buildings", sign, x0 + 1.5, x1 - 1.5, 3.0, 3.6, fz - 0.1, fz + 0.1)
        ext(W, "Buildings", awn, x0 + 1.5, x1 - 1.5, 2.75, 2.85, fz + sz * 0.6 - 0.6, fz + sz * 0.6 + 0.6)
    ext(W, "Buildings", M["roof"], x0 + 0.5, x1 - 0.5, h, h + 0.15, z0 + 0.5, z1 - 0.5)
    if board_dir is not None:
        bx, bz = (x0 + x1) / 2, (z0 + z1) / 2
        dx, dz = board_dir
        for k in (-2.8, 2.8):
            W.cyl("Buildings", M["dark"], (bx + (k if dx == 0 else 0), h + 2, bz + (k if dz == 0 else 0)), 0.12, 4, seg=6)
        size = (8, 3.6, 0.2) if dx == 0 else (0.2, 3.6, 8)
        W.box("Buildings", M["dark"], (bx, h + 5.6, bz), (size[0] + 0.3, 3.9, size[2] + 0.1))
        W.box("Buildings", rng.choice(M["boards"]), (bx + dx * 0.12, h + 5.6, bz + dz * 0.12), size)


def park(W, rect, M, rng):
    x0, x1, z0, z1 = rect["x0"] + SIDEWALK, rect["x1"] - SIDEWALK, rect["z0"] + SIDEWALK, rect["z1"] - SIDEWALK
    ext(W, "Static", M["grass"], x0, x1, 0.18, 0.24, z0, z1)
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    ext(W, "Static", M["path"], cx - 1.2, cx + 1.2, 0.24, 0.26, z0, z1)
    ext(W, "Static", M["path"], x0, x1, 0.24, 0.26, cz - 1.2, cz + 1.2)
    W.cyl("Static", M["trim"], (cx, 0.5, cz), 2.4, 0.5, seg=24)
    W.cyl("Static", M["fountain"], (cx, 0.78, cz), 2.0, 0.06, seg=24)
    for side in (-1, 1):
        ext(W, "Static", M["hedge"], x0, x1, 0.24, 1.0, (z1 if side > 0 else z0) - 0.4, (z1 if side > 0 else z0) + 0.4)
        ext(W, "Static", M["hedge"], (x1 if side > 0 else x0) - 0.4, (x1 if side > 0 else x0) + 0.4, 0.24, 1.0, z0, z1)
    for _ in range(14):
        tx, tz = rng.uniform(x0 + 2, x1 - 2), rng.uniform(z0 + 2, z1 - 2)
        if abs(tx - cx) < 2.5 or abs(tz - cz) < 2.5:
            continue
        tree(W, tx, tz, 0.24, M, rng, scale=1.3)
    for k in (-1, 1):
        streetlight_park = (cx + k * 6, cz + 2)
        W.cyl("Static", M["dark"], (streetlight_park[0], 2, streetlight_park[1]), 0.06, 4, seg=6)
        W.sphere("Static", M["lamp"], (streetlight_park[0], 4.1, streetlight_park[1]), 0.25, seg=8, rings=6)


def getaway_house(W, M, rng):
    """Origin at the garage face; the house extends north (away from the city)."""
    hx, hz = HOUSE["x"], HOUSE["z"]
    def at(x, z):
        return hx + x, hz + z
    g = "House"
    # Lot, lawn, driveway reaching the city road.
    ext(W, g, M["lawn"], hx - 26, hx + 26, 0.0, 0.05, hz - 26, hz + 0.2)
    ext(W, g, M["concrete"], hx - 5.8, hx - 0.2, 0.04, 0.08, hz - 0.2, hz + 7)
    # Body, trim, roof, chimney.
    ext(W, g, M["house_brick"], hx - 8, hx + 8, 0, 6.6, hz - 10, hz - 0.05)
    ext(W, g, M["trim"], hx - 8.2, hx + 8.2, 0, 0.45, hz - 10.2, hz + 0.15)
    ext(W, g, M["white"], hx - 8.3, hx + 8.3, 6.5, 6.8, hz - 10.3, hz + 0.3)
    roof = kit.bmesh.new()
    v = [roof.verts.new(p) for p in ((-8.8, 0, 0.9), (8.8, 0, 0.9), (8.8, 2.9, -5), (-8.8, 2.9, -5), (-8.8, 0, -10.9), (8.8, 0, -10.9))]
    for f in ((0, 1, 2, 3), (3, 2, 5, 4), (0, 3, 4), (1, 5, 2)):
        roof.faces.new([v[i] for i in f])
    W._merge(roof, g, M["shingle"], kit.Matrix.Translation((hx, 6.8, hz)))
    ext(W, g, M["house_brick"], hx + 4.5, hx + 5.8, 6.8, 10.6, hz - 7, hz - 5.7)
    # Garage opening with a lit interior behind the roll-up door.
    ext(W, g, M["white"], hx - 6.1, hx + 0.1, 0, 3.75, hz - 0.12, hz + 0.08)
    ext(W, g, M["garage_inside"], hx - 5.6, hx - 0.4, 0.05, 3.45, hz + 0.08, hz + 0.1)
    for k in range(7):
        ext(W, "GarageDoor", M["garage"], hx - 5.55, hx - 0.45, 0.06 + k * 0.48, 0.5 + k * 0.48, hz + 0.12, hz + 0.24, bevel=0.03)
    # Front door, porch and porch light.
    ext(W, g, M["wood"], hx + 3.4, hx + 4.6, 0.3, 2.6, hz - 0.08, hz + 0.1)
    ext(W, g, M["white"], hx + 2.4, hx + 5.6, 2.9, 3.1, hz - 0.1, hz + 2.0)
    for px in (2.6, 5.4):
        W.cyl(g, M["white"], (hx + px, 1.45, hz + 1.8), 0.1, 2.9, seg=10)
    ext(W, g, M["concrete"], hx + 2.4, hx + 5.6, 0, 0.3, hz, hz + 2.0)
    ext(W, g, M["lamp"], hx + 4.9, hx + 5.15, 2.2, 2.5, hz + 0.05, hz + 0.2)
    # Windows: frames and warm glass.
    for (wx, wy) in ((-6, 4.6), (-3, 4.6), (1, 4.6), (4.2, 4.6), (6.6, 1.6), (1.4, 1.6)):
        ext(W, g, M["white"], hx + wx - 0.8, hx + wx + 0.8, wy - 0.9, wy + 0.9, hz - 0.08, hz + 0.08)
        ext(W, g, M["warm_window"], hx + wx - 0.65, hx + wx + 0.65, wy - 0.75, wy + 0.75, hz + 0.07, hz + 0.1)
        ext(W, g, M["white"], hx + wx - 0.03, hx + wx + 0.03, wy - 0.75, wy + 0.75, hz + 0.1, hz + 0.12)
    # Picket fence around the lawn, open for the driveway.
    for x in np.arange(-25.5, 25.6, 1.2):
        if -6.5 < x < 0.5:
            continue
        ext(W, g, M["white"], hx + x - 0.06, hx + x + 0.06, 0, 1.1, hz + 0.6, hz + 0.72)
    for y in (0.4, 0.85):
        ext(W, g, M["white"], hx - 25.6, hx - 6.5, y, y + 0.08, hz + 0.6, hz + 0.7)
        ext(W, g, M["white"], hx + 0.5, hx + 25.6, y, y + 0.08, hz + 0.6, hz + 0.7)
    ext(W, g, M["dark"], hx + 0.9, hx + 1.4, 0.9, 1.3, hz + 1.2, hz + 1.6)
    W.cyl(g, M["wood"], (hx + 1.15, 0.45, hz + 1.4), 0.05, 0.9, seg=6)
    for tx, tz in ((-12, -4), (12, -14), (-20, -16)):
        tree(W, hx + tx, hz + tz, 0.05, M, rng, scale=1.5)
    # Neighbours either side, darker and simpler.
    for nx in (-22, 22):
        ext(W, "Static", M["house_brick"], hx + nx - 6, hx + nx + 6, 0, 5.6, hz - 14, hz - 4)
        ext(W, "Static", M["shingle"], hx + nx - 6.5, hx + nx + 6.5, 5.6, 6.2, hz - 14.5, hz - 3.5)
        ext(W, "Static", M["warm_window"], hx + nx - 2, hx + nx - 0.8, 3.4, 4.6, hz - 3.95, hz - 3.9)


def build() -> World:
    W, M = World(), materials()
    rng = random.Random(7)
    span = HALF + 12
    ext(W, "Ground", M["ground"], -500, 500, -0.12, -0.02, -500, 500)
    ext(W, "Road", M["road"], -span, span, -0.02, 0.0, -span, span)
    lo, hi = ROADS[0], ROADS[-1]
    # Lane dashes between junctions and zebra crossings at every junction arm.
    for k in ROADS:
        for a, b in zip(ROADS, ROADS[1:]):
            s = a + 9.5
            while s + 3 < b - 9.5:
                flat(W, "Markings", M["paint"], k - 0.08, k + 0.08, s, s + 3)
                flat(W, "Markings", M["paint"], s, s + 3, k - 0.08, k + 0.08)
                s += 6
    for x in ROADS:
        for z in ROADS:
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if not (lo <= x + dx * 20 <= hi and lo <= z + dz * 20 <= hi):
                    continue
                for s in range(6):
                    off = -5 + s * 2
                    if dx:
                        cx = x + dx * 8
                        flat(W, "Markings", M["paint"], cx - 1.4, cx + 1.4, z + off - 0.45, z + off + 0.45)
                    else:
                        cz = z + dz * 8
                        flat(W, "Markings", M["paint"], x + off - 0.45, x + off + 0.45, cz - 1.4, cz + 1.4)
    parks = {(2, 5), (5, 1), (6, 6)}
    boards = 0
    for idx, r in enumerate(RECTS):
        i, j = idx // 8, idx % 8
        brng = random.Random(1000 + i * 17 + j)
        x0, x1, z0, z1 = r["x0"], r["x1"], r["z0"], r["z1"]
        ext(W, "Sidewalks", M["walk"], x0, x1, 0.0, 0.18, z0, z1)
        ring(W, "Sidewalks", M["curb"], x0 + 0.15, x1 - 0.15, z0 + 0.15, z1 - 0.15, 0.0, 0.2, 0.15)
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        # Streetlights on every side, arms over the road; signals at the corners.
        for t in (0.3, 0.7):
            streetlight(W, x0 + 0.7, z0 + (z1 - z0) * t, (-1, 0), M)
            streetlight(W, x1 - 0.7, z0 + (z1 - z0) * t, (1, 0), M)
            streetlight(W, x0 + (x1 - x0) * t, z0 + 0.7, (0, -1), M)
            streetlight(W, x0 + (x1 - x0) * t, z1 - 0.7, (0, 1), M)
        for sx, sz in ((x0 + 0.6, z0 + 0.6), (x1 - 0.6, z1 - 0.6)):
            signal(W, sx, sz, (0, -1) if sz < cz else (0, 1), M, red=brng.random() < 0.5)
        if (i, j) in parks:
            park(W, r, M, brng)
            continue
        d = math.hypot(cx, cz)
        central = max(0.0, 1 - d / 120)
        if d > 95:
            for t in (0.15, 0.5, 0.85):
                for (tx, tz) in ((x0 + 1.1, z0 + (z1 - z0) * t), (x1 - 1.1, z0 + (z1 - z0) * t)):
                    if brng.random() < 0.7:
                        tree(W, tx, tz, 0.18, M, brng)
        bx0, bx1, bz0, bz1 = x0 + SIDEWALK, x1 - SIDEWALK, z0 + SIDEWALK, z1 - SIDEWALK
        mx, mz = (bx0 + bx1) / 2, (bz0 + bz1) / 2
        if d < 95:
            lots = [(bx0, bx1, bz0, bz1)] if brng.random() < 0.55 else [(bx0, mx - 0.6, bz0, bz1), (mx + 0.6, bx1, bz0, bz1)]
            for lot in lots:
                tower(W, lot, M, brng, central)
        else:
            lots = [(bx0, mx - 0.5, bz0, mz - 0.5), (mx + 0.5, bx1, bz0, mz - 0.5), (bx0, mx - 0.5, mz + 0.5, bz1), (mx + 0.5, bx1, mz + 0.5, bz1)]
            for lot in lots:
                lx, lz = (lot[0] + lot[1]) / 2, (lot[2] + lot[3]) / 2
                street = (1 if lx > cx else -1, 0) if brng.random() < 0.5 else (0, 1 if lz > cz else -1)
                roll = brng.random()
                if d < 155 and roll < 0.45:
                    office(W, lot, M, brng)
                elif roll < 0.72:
                    walkup(W, lot, M, brng, street)
                else:
                    board = None
                    if boards < 10 and brng.random() < 0.5:
                        board, boards = street, boards + 1
                    shops(W, lot, M, brng, street, board)
    # Concrete barriers on the boundary, gap for the getaway house driveway.
    for along in np.arange(-HALF, HALF, 4):
        for x, z, horiz in ((along + 2, -HALF - 0.5, True), (along + 2, HALF + 0.5, True), (-HALF - 0.5, along + 2, False), (HALF + 0.5, along + 2, False)):
            if horiz and z < 0 and abs(x - DROP["x"]) < 10:
                continue
            W.box("Static", M["barrier"], (x, 0.45, z), (3.8, 0.9, 0.6) if horiz else (0.6, 0.9, 3.8))
    # A ring of distant towers so the city doesn't end at the barriers.
    for k in range(46):
        a = 2 * math.pi * k / 46 + rng.uniform(-0.04, 0.04)
        r = rng.uniform(250, 340)
        x, z = math.cos(a) * r, math.sin(a) * r
        if z < -HALF and abs(x - HOUSE["x"]) < 70:
            continue
        w, h = rng.uniform(14, 30), rng.uniform(25, 110)
        W.box("Buildings", M[rng.choice(["glass_cool", "glass_teal", "office_a", "brick_dark"])], (x, h / 2, z), (w, h, w))
        if h > 80:
            W.sphere("Static", M["beacon"], (x, h + 0.5, z), 0.6, seg=8, rings=6)
    getaway_house(W, M, rng)
    return W


def preview():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.02, 0.045, 1)
    bg.inputs["Strength"].default_value = 0.8
    moon = bpy.data.objects.new("Moon", bpy.data.lights.new("Moon", "SUN"))
    moon.data.energy, moon.data.color = 0.6, (0.6, 0.7, 1.0)
    moon.rotation_euler = (math.radians(55), 0, math.radians(30))
    scene.collection.objects.link(moon)
    cam = bpy.data.objects.new("Preview", bpy.data.cameras.new("Preview"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = {
        "aerial": ((-150, -230, 170), (10, 0, 0), 24),
        "street": ((ROADS[3] + 3, -(ROADS[5] + 20), 4), (ROADS[3], -(ROADS[3]), 8), 22),
        "house": ((DROP["x"] - 2, -(DROP["z"] + 24), 6), (HOUSE["x"], -(HOUSE["z"] - 4), 3), 26),
    }
    for name, (loc, target, lens) in shots.items():
        cam.location = loc
        cam.data.lens = lens
        cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(ART / f"getaway-preview-{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = build().build()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    out = OUT / "getaway-city.glb"
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_image_format="JPEG",
                              export_jpeg_quality=80, export_cameras=False,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12, export_lights=False, export_animations=False)
    if PREVIEW:
        preview()
    bpy.ops.wm.save_as_mainfile(filepath=str(ART / "getaway-city.blend"))
    print(f"CITY: {len(objs)} nodes, {tris} triangles, {out.stat().st_size / 1e6:.2f} MB -> {out.name}")


if __name__ == "__main__":
    main()
