"""High-detail environments for the three Laser Heist contracts.

Run:  npx tsx tools/export-heist-maps.ts
      ~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_heist_hd.py [-- --preview]

Every wall, door, console and piece of cover is placed from art/heist-maps.json, which is
exported from shared/heist-maps.ts, so the visible building always matches collision,
guard sight lines and navigation. Geometry is authored in game coordinates
(x right, y up, z depth; floor top at y=0) and converted to Blender's z-up on output.

Exports public/heist/hd-world-<level>.glb plus editable art/hd-world-<level>.blend.
Nodes named Wall_* are camera occluders the game fades; Gate_<id> nodes are door leaves the
game shows while that gate is closed.
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "heist"
ART = ROOT / "art"
MAPS = json.loads((ART / "heist-maps.json").read_text())
PREVIEW = "--preview" in sys.argv
ONLY = next((int(a.split("=")[1]) for a in sys.argv if a.startswith("--level=")), None)
LOGICAL_TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")
WALL_H = 2.6


# ─── Procedural textures (tileable, numpy) ───────────────────────────────────

def value_noise(n: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    grid = rng.random((cells, cells))
    t = np.arange(n) * cells / n
    i0 = np.floor(t).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = t - np.floor(t)
    f = f * f * (3 - 2 * f)
    top = grid[i0][:, i0] * (1 - f)[None, :] + grid[i0][:, i1] * f[None, :]
    bottom = grid[i1][:, i0] * (1 - f)[None, :] + grid[i1][:, i1] * f[None, :]
    return top * (1 - f)[:, None] + bottom * f[:, None]


def fbm(n: int, base: int, octaves: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        out += value_noise(n, base * 2 ** o, rng) * amp
        total += amp
        amp *= 0.5
    return out / total


def color(c) -> np.ndarray:
    return np.array(c, dtype=np.float32)


def make_image(name: str, rgb: np.ndarray) -> bpy.types.Image:
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px[::-1].ravel())
    img.file_format = "JPEG"
    img.pack()
    return img


def marble(n: int, base, vein, seed: int, scale=6.0, turb=5.0, sharp=10.0) -> np.ndarray:
    y, x = np.mgrid[0:n, 0:n] / n
    warp = fbm(n, 4, 5, seed)
    v = np.abs(np.sin((x * scale + y * scale * 0.6 + warp * turb) * math.pi))
    veins = (1 - v) ** sharp
    cloud = fbm(n, 8, 4, seed + 1)
    rgb = color(base)[None, None, :] * (0.9 + 0.12 * cloud[..., None])
    return rgb * (1 - veins[..., None] * 0.85) + color(vein)[None, None, :] * veins[..., None] * 0.85


def tex_checker_marble(n=1024) -> np.ndarray:
    """2 x 2 tiles of white and grey marble with grout; texture spans 2 m."""
    a = marble(n, (0.93, 0.91, 0.87), (0.55, 0.53, 0.52), 11)
    b = marble(n, (0.42, 0.43, 0.45), (0.86, 0.86, 0.84), 12, scale=4)
    y, x = np.mgrid[0:n, 0:n]
    half = n // 2
    mask = ((x // half + y // half) % 2 == 0)[..., None]
    rgb = np.where(mask, a, b)
    grout = ((x % half) < 3) | ((y % half) < 3)
    rgb[grout] = (0.25, 0.23, 0.21)
    return rgb


def tex_bank_floor(n=1024) -> np.ndarray:
    """Polished black and cream marble on the diagonal with brass lines."""
    a = marble(n, (0.06, 0.07, 0.07), (0.45, 0.42, 0.36), 21, scale=5, sharp=14)
    b = marble(n, (0.86, 0.80, 0.68), (0.55, 0.45, 0.33), 22, scale=4)
    y, x = np.mgrid[0:n, 0:n] / n
    d1, d2 = (x + y) % 0.5, (x - y) % 0.5
    mask = (((x + y) // 0.5 + (x - y) // 0.5) % 2 == 0)[..., None]
    rgb = np.where(mask, a, b)
    line = (d1 < 0.006) | (d2 < 0.006)
    rgb[line] = (0.78, 0.58, 0.25)
    return rgb


def tex_plaster(n=512, base=(0.88, 0.84, 0.76), seed=3) -> np.ndarray:
    g = fbm(n, 6, 5, seed)
    return color(base)[None, None, :] * (0.9 + 0.12 * g[..., None])


def tex_wood(n=1024, base=(0.32, 0.17, 0.08), seed=5, planks=8) -> np.ndarray:
    y, x = np.mgrid[0:n, 0:n] / n
    warp = fbm(n, 4, 4, seed)
    rings = np.sin((x * 40 + warp * 6) * math.pi) * 0.5 + 0.5
    grain = fbm(n, 64, 3, seed + 1)
    shade = 0.75 + 0.2 * rings[..., None] + 0.1 * grain[..., None]
    rgb = color(base)[None, None, :] * shade
    seam = (y * planks % 1) < 0.008
    rgb[seam] *= 0.45
    return rgb


def tex_brushed(n=512, base=(0.78, 0.6, 0.3), seed=7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    streak = rng.random((n, 1)) * 0.5 + fbm(n, 4, 3, seed)[:, :1] * 0.5
    rgb = color(base)[None, None, :] * (0.88 + 0.18 * np.repeat(streak, n, axis=1)[..., None])
    return rgb


def tex_concrete(n=1024, base=(0.52, 0.53, 0.54), seed=9, seams=4) -> np.ndarray:
    g = fbm(n, 6, 6, seed)
    stain = fbm(n, 3, 3, seed + 3)
    rgb = color(base)[None, None, :] * (0.82 + 0.22 * g[..., None] - 0.12 * (stain[..., None] > 0.62))
    y, x = np.mgrid[0:n, 0:n]
    seam = ((x % (n // seams)) < 2) | ((y % (n // seams)) < 2)
    rgb[seam] *= 0.7
    return rgb


def tex_facade(n=1024, frame=(0.16, 0.19, 0.23), seed=13, cols=8, rows=8, warm=True) -> np.ndarray:
    """Curtain wall: `rows` storeys of `cols` bays with spandrels and mullions.
    Offices light up in runs along a floor, like a real tower at night."""
    rng = np.random.default_rng(seed)
    rgb = np.empty((n, n, 3), dtype=np.float32)
    rgb[:] = frame
    cw, ch = n // cols, n // rows
    lit = np.array((1.0, 0.8, 0.5) if warm else (0.62, 0.84, 0.98))
    dark = np.array((0.035, 0.05, 0.07))
    for r in range(rows):
        on = np.zeros(cols, bool)
        c = 0
        while c < cols:
            run = rng.integers(1, 4)
            if rng.random() < (0.5 if rows <= 2 else 0.24):
                on[c:c + run] = True
            c += run + rng.integers(1, 3)
        tint = 0.65 + 0.35 * rng.random()
        for c in range(cols):
            y0, x0 = r * ch + int(ch * 0.22), c * cw + 3
            glass = lit * tint * (0.85 + 0.15 * rng.random()) if on[c] else dark + rng.random() * 0.025
            rgb[y0:y0 + int(ch * 0.7), x0:x0 + cw - 6] = glass
            if on[c]:  # blinds and desk silhouettes break up the glow
                rgb[y0:y0 + int(ch * 0.12), x0:x0 + cw - 6] *= 0.55
    return rgb


def tex_stone_block(n=1024, base=(0.72, 0.68, 0.6), seed=15) -> np.ndarray:
    """Rusticated ashlar: 0.5 m courses, staggered 1 m blocks; texture spans 2 m."""
    g = fbm(n, 8, 5, seed)
    rgb = color(base)[None, None, :] * (0.85 + 0.2 * g[..., None])
    y, x = np.mgrid[0:n, 0:n]
    course = n // 4
    row = y // course
    offset = (row % 2) * (n // 4)
    joint = ((y % course) < 4) | (((x + offset) % (n // 2)) < 4)
    rgb[joint] *= 0.55
    return rgb


def tex_hazard(n=256) -> np.ndarray:
    y, x = np.mgrid[0:n, 0:n]
    band = ((x + y) // (n // 4)) % 2 == 0
    rgb = np.where(band[..., None], color((0.95, 0.72, 0.1)), color((0.06, 0.06, 0.06)))
    return rgb


def tex_painting(seed: int, n=256) -> np.ndarray:
    rng = np.random.default_rng(seed)
    palettes = [[(0.82, 0.32, 0.18), (0.95, 0.82, 0.55), (0.12, 0.22, 0.35), (0.62, 0.68, 0.6)],
                [(0.2, 0.32, 0.2), (0.75, 0.62, 0.35), (0.42, 0.18, 0.12), (0.88, 0.86, 0.78)],
                [(0.1, 0.12, 0.25), (0.85, 0.45, 0.25), (0.92, 0.9, 0.85), (0.35, 0.5, 0.65)]]
    pal = palettes[seed % len(palettes)]
    base = fbm(n, 3, 4, seed)
    rgb = np.empty((n, n, 3), dtype=np.float32)
    rgb[:] = color(pal[0]) * 0.6 + color(pal[3]) * 0.4
    rgb *= (0.8 + 0.3 * base[..., None])
    y, x = np.mgrid[0:n, 0:n] / n
    if seed % 2 == 0:  # landscape: horizon, hills, sun
        horizon = 0.55 + 0.08 * np.sin(x * 9 + seed)
        rgb[y > horizon] = color(pal[1]) * (0.7 + 0.3 * base[y > horizon][..., None])
        sun = (x - 0.7) ** 2 + (y - 0.3) ** 2 < 0.012
        rgb[sun] = pal[2] if seed % 3 else (0.98, 0.9, 0.6)
    else:  # abstract: blocks and circles
        for _ in range(7):
            cx, cy, r = rng.random(), rng.random(), rng.uniform(0.08, 0.25)
            col = pal[rng.integers(0, 4)]
            if rng.random() < 0.5:
                rgb[(np.abs(x - cx) < r) & (np.abs(y - cy) < r * 0.6)] = col
            else:
                rgb[(x - cx) ** 2 + (y - cy) ** 2 < r * r] = col
    rgb *= (0.92 + 0.08 * fbm(n, 32, 2, seed + 9))[..., None]
    return rgb


def tex_grass(n=512, seed=17) -> np.ndarray:
    g = fbm(n, 16, 5, seed)
    return color((0.13, 0.2, 0.09))[None, None, :] * (0.7 + 0.6 * g[..., None])


def tex_asphalt(n=512, seed=19) -> np.ndarray:
    g = fbm(n, 32, 4, seed)
    return color((0.13, 0.13, 0.14))[None, None, :] * (0.8 + 0.4 * g[..., None])


def tex_paver(n=1024, seed=23) -> np.ndarray:
    g = fbm(n, 8, 5, seed)
    rgb = color((0.55, 0.5, 0.44))[None, None, :] * (0.85 + 0.2 * g[..., None])
    y, x = np.mgrid[0:n, 0:n]
    joint = ((x % (n // 4)) < 3) | ((y % (n // 8)) < 3)
    rgb[joint] *= 0.6
    return rgb


# ─── Materials ───────────────────────────────────────────────────────────────

class Mat:
    """A material plus the world size (m) one texture repeat covers, for box-projected UVs."""

    def __init__(self, name, rgb=None, img=None, size=2.0, rough=0.5, metal=0.0, emit=0.0, alpha=1.0, emit_img=None):
        self.size = size
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        if img is not None:
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img
            nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
            if emit:
                # A separate glow map lets lit windows shine while brick and frames stay dark.
                if emit_img is not None:
                    e = nt.nodes.new("ShaderNodeTexImage")
                    e.image = emit_img
                    nt.links.new(e.outputs["Color"], b.inputs["Emission Color"])
                else:
                    nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
                b.inputs["Emission Strength"].default_value = emit
        else:
            b.inputs["Base Color"].default_value = (*rgb, 1)
            m.diffuse_color = (*rgb, 1)
            if emit:
                b.inputs["Emission Color"].default_value = (*rgb, 1)
                b.inputs["Emission Strength"].default_value = emit
        if alpha < 1:
            b.inputs["Alpha"].default_value = alpha
            m.surface_render_method = "BLENDED" if hasattr(m, "surface_render_method") else None
        self.mat = m


# ─── Geometry accumulator ────────────────────────────────────────────────────

class World:
    """Collects primitives per (node group, material) into bmeshes in game coordinates."""

    def __init__(self):
        self.groups: dict[str, dict[Mat, bmesh.types.BMesh]] = {}
        # A group listed here is exported with its origin at this game-space point (e.g. a door hinge)
        # and carries these custom properties as glTF extras.
        self.pivots: dict[str, tuple] = {}
        self.extras: dict[str, dict] = {}

    def _merge(self, src, group, mat, matrix):
        bmesh.ops.transform(src, matrix=matrix, verts=src.verts)
        dst = self.groups.setdefault(group, {}).setdefault(mat, bmesh.new())
        vmap = {v: dst.verts.new(v.co) for v in src.verts}
        for f in src.faces:
            try:
                dst.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                pass
        src.free()

    def box(self, group, mat, c, s, bevel=0.0, yaw=0.0):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector(s), verts=bm.verts)
        if bevel > 0:
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(bevel, min(s) * 0.45), segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
        self._merge(bm, group, mat, Matrix.Translation(Vector(c)) @ Matrix.Rotation(yaw, 4, "Y"))

    def cyl(self, group, mat, c, r, h, seg=24, r2=None, axis="Y", yaw=0.0):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
        rot = {"Y": Matrix.Rotation(-math.pi / 2, 4, "X"), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Z": Matrix.Identity(4)}[axis]
        self._merge(bm, group, mat, Matrix.Translation(Vector(c)) @ Matrix.Rotation(yaw, 4, "Y") @ rot)

    def pipe(self, group, mat, a, b, r, seg=12):
        a, b = Vector(a), Vector(b)
        d = b - a
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r, depth=d.length)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        self._merge(bm, group, mat, Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())

    def sphere(self, group, mat, c, r, seg=24, rings=14, scale=(1, 1, 1)):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
        bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
        self._merge(bm, group, mat, Matrix.Translation(Vector(c)))

    def torus(self, group, mat, c, R, r, seg=48, rseg=12, tilt=0.0, yaw=0.0):
        bm = bmesh.new()
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), r * math.sin(b), (R + r * math.cos(b)) * math.sin(a))))
            rings.append(ring)
        for i in range(seg):
            for j in range(rseg):
                bm.faces.new([rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % rseg], rings[i][(j + 1) % rseg]])
        self._merge(bm, group, mat, Matrix.Translation(Vector(c)) @ Matrix.Rotation(yaw, 4, "Y") @ Matrix.Rotation(tilt, 4, "X"))

    def annulus(self, group, mat, c, r0, r1, seg=64, h=0.01):
        bm = bmesh.new()
        inner_t, outer_t, inner_b, outer_b = [], [], [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            for lst, r, y in ((inner_t, r0, h), (outer_t, r1, h), (inner_b, r0, 0), (outer_b, r1, 0)):
                lst.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new([inner_t[i], inner_t[j], outer_t[j], outer_t[i]])
            bm.faces.new([outer_t[i], outer_t[j], outer_b[j], outer_b[i]])
        self._merge(bm, group, mat, Matrix.Translation(Vector(c)))

    def prism(self, group, mat, pts, z0, z1):
        """Extrude a convex outline drawn in the x-y (facing) plane between depths z0 and z1."""
        bm = bmesh.new()
        front = [bm.verts.new((x, y, z0)) for x, y in pts]
        back = [bm.verts.new((x, y, z1)) for x, y in pts]
        bm.faces.new(front)
        bm.faces.new(back)
        for i in range(len(pts)):
            j = (i + 1) % len(pts)
            bm.faces.new([front[i], front[j], back[j], back[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._merge(bm, group, mat, Matrix.Identity(4))

    def band(self, group, mat, cx, cy, r0, r1, z0, z1, floor=-1e9, seg=72):
        """A ring r0..r1 around (cx, cy) in the facing plane, cut off where its outer edge meets the floor."""
        full = cy - r1 >= floor
        a0 = -math.pi / 2 if full else math.asin((floor - cy) / r1)
        span = 2 * math.pi if full else math.pi - 2 * a0
        n = seg if full else max(8, int(seg * span / (2 * math.pi)) + 1)
        angles = [a0 + span * i / n for i in range(n + (0 if full else 1))]
        bm = bmesh.new()
        ring = [[bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), z)) for a in angles] for r, z in ((r1, z0), (r0, z0), (r0, z1), (r1, z1))]
        count = len(angles)
        for i in range(count if full else count - 1):
            j = (i + 1) % count
            for k in range(4):
                a, b = ring[k], ring[(k + 1) % 4]
                bm.faces.new([a[i], a[j], b[j], b[i]])
        if not full:
            for end in (0, count - 1):
                bm.faces.new([ring[k][end] for k in range(4)])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._merge(bm, group, mat, Matrix.Identity(4))

    def collar(self, group, mat, cx, cy, r, w, h, z0, z1, seg=96):
        """A w x h block (floor at y=0) pierced by a round opening of radius r centred at (cx, cy)
        that runs down to the floor: the portal around a round vault door."""
        a0 = math.asin(-cy / r)
        corners = [math.atan2(yy - cy, xx) % (2 * math.pi) for xx, yy in ((w / 2, 0), (w / 2, h), (-w / 2, h), (-w / 2, 0))]
        corners = [a - 2 * math.pi if a > math.pi - a0 else a for a in corners]
        angles = sorted({a0 + (math.pi - 2 * a0) * i / seg for i in range(seg + 1)} | {a for a in corners if a0 < a < math.pi - a0})

        def outer(a):
            dx, dy = math.cos(a), math.sin(a)
            hits = [t for t in ((w / 2) / dx if dx > 1e-9 else None, (-w / 2) / dx if dx < -1e-9 else None,
                                (h - cy) / dy if dy > 1e-9 else None, -cy / dy if dy < -1e-9 else None) if t is not None]
            t = min(hits)
            return cx + dx * t, cy + dy * t
        bm = bmesh.new()
        inner_pts = [(cx + r * math.cos(a), max(0.0, cy + r * math.sin(a))) for a in angles]
        outer_pts = [outer(a) for a in angles]
        layers = {}
        for key, pts in (("i", inner_pts), ("o", outer_pts)):
            for z in (z0, z1):
                layers[key, z] = [bm.verts.new((x, y, z)) for x, y in pts]
        for i in range(len(angles) - 1):
            j = i + 1
            for z in (z0, z1):
                quad = [layers["i", z][i], layers["i", z][j], layers["o", z][j], layers["o", z][i]]
                if i == 0:
                    quad = quad[1:]
                elif j == len(angles) - 1:
                    quad = quad[:2] + quad[3:]
                bm.faces.new(quad)
            for key in ("i", "o"):
                if (i == 0 or j == len(angles) - 1) and key == "o":
                    continue
                bm.faces.new([layers[key, z0][i], layers[key, z0][j], layers[key, z1][j], layers[key, z1][i]])
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        self._merge(bm, group, mat, Matrix.Identity(4))

    def build(self) -> list[bpy.types.Object]:
        objs = []
        for group, parts in self.groups.items():
            bm = bmesh.new()
            uv = bm.loops.layers.uv.new("UVMap")
            mats = list(parts.keys())
            for index, mat in enumerate(mats):
                src = parts[mat]
                vmap = {v: bm.verts.new(v.co) for v in src.verts}
                for f in src.faces:
                    try:
                        nf = bm.faces.new([vmap[v] for v in f.verts])
                    except ValueError:
                        continue
                    nf.material_index = index
                    nf.normal_update()
                    n = nf.normal
                    ax = max(range(3), key=lambda k: abs(n[k]))
                    for loop in nf.loops:
                        p = loop.vert.co
                        u, v = ((p.z, p.y) if ax == 0 else (p.x, p.z) if ax == 1 else (p.x, p.y))
                        loop[uv].uv = (u / mat.size, v / mat.size)
                src.free()
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
            for f in bm.faces:
                f.smooth = True
            for e in bm.edges:
                if not e.is_manifold or e.calc_face_angle(math.pi) > math.radians(42):
                    e.smooth = False
            me = bpy.data.meshes.new(group)
            bm.to_mesh(me)
            bm.free()
            pivot = self.pivots.get(group)
            if pivot is not None:
                me.transform(Matrix.Translation(-Vector(pivot)))
            me.transform(LOGICAL_TO_BLENDER)
            for mat in mats:
                me.materials.append(mat.mat)
            obj = bpy.data.objects.new(group, me)
            if pivot is not None:
                obj.location = LOGICAL_TO_BLENDER @ Vector(pivot)
            for key, value in self.extras.get(group, {}).items():
                obj[key] = value
            bpy.context.scene.collection.objects.link(obj)
            objs.append(obj)
        return objs


# ─── Shared architecture kit ─────────────────────────────────────────────────

def wall_frame(w: dict):
    """Local frame for a wall rect: returns (along_x, length, thickness, mapper)."""
    along_x = w["w"] >= w["d"]
    L, T = (w["w"], w["d"]) if along_x else (w["d"], w["w"])

    def put(u, y, t, lu, hy, tt):
        if along_x:
            return (w["x"] + u, y, w["z"] + t), (lu, hy, tt)
        return (w["x"] + t, y, w["z"] + u), (tt, hy, lu)
    return along_x, L, T, put


def detailed_wall(W: World, group: str, w: dict, st: dict, h=WALL_H, faces=(-1, 1), paintings=None, sconces=True):
    along_x, L, T, put = wall_frame(w)
    W.box(group, st["wall"], *put(0, h / 2, 0, L, h, T), bevel=0.01)
    for side in faces:
        off = side * T / 2
        W.box(group, st["plinth"], *put(0, 0.1, off + side * 0.025, L, 0.2, 0.05), bevel=0.008)
        W.box(group, st["trim"], *put(0, 0.95, off + side * 0.02, L, 0.06, 0.04), bevel=0.01)
        W.box(group, st["trim"], *put(0, h - 0.1, off + side * 0.04, L, 0.08, 0.08), bevel=0.015)
        W.box(group, st["trim"], *put(0, h - 0.2, off + side * 0.025, L, 0.06, 0.05), bevel=0.01)
        n = max(1, round(L / 1.5))
        seg = L / n
        for i in range(n):
            u = -L / 2 + seg * (i + 0.5)
            if seg > 0.7:
                W.box(group, st["panel"], *put(u, 0.56, off + side * 0.012, seg - 0.28, 0.6, 0.024), bevel=0.008)
                if st.get("frames"):
                    for (du, dy, lu, hy) in ((0, 1.18, seg - 0.4, 0.035), (0, 2.18, seg - 0.4, 0.035), (-(seg - 0.4) / 2, 1.68, 0.035, 1.0), ((seg - 0.4) / 2, 1.68, 0.035, 1.0)):
                        W.box(group, st["trim"], *put(u + du, dy, off + side * 0.015, lu, hy, 0.03))
            if sconces and seg > 2.2 and i % 2 == 1:
                W.box(group, st["metal"], *put(u, 2.05, off + side * 0.03, 0.14, 0.24, 0.05), bevel=0.01)
                W.box(group, st["lamp"], *put(u, 2.17, off + side * 0.09, 0.16, 0.08, 0.1), bevel=0.02)
            if paintings is not None and side in paintings and seg > 1.6 and i % 2 == 0:
                pm = st["paintings"][(i + int(abs(w["x"] * 3 + w["z"] * 7))) % len(st["paintings"])]
                fw = min(1.3, seg - 0.6)
                W.box(group, st["frame"], *put(u, 1.62, off + side * 0.03, fw + 0.12, 0.92, 0.05), bevel=0.015)
                W.box(group, pm, *put(u, 1.62, off + side * 0.058, fw, 0.8, 0.01))
    # Pilasters on free ends make doorways read as architecture.
    for end in (-1, 1):
        W.box(group, st["trim"], *put(end * (L / 2 - 0.12), h / 2, 0, 0.26, h, T + 0.12), bevel=0.02)
        W.box(group, st["plinth"], *put(end * (L / 2 - 0.12), 0.12, 0, 0.32, 0.24, T + 0.16), bevel=0.015)


def door(W: World, gate: dict, st: dict, kind: str):
    """Static frame + Gate_<id> leaf (shown while closed)."""
    along_x, L, T, put = wall_frame(gate)
    gid = "Gate_" + gate["id"]
    if gate.get("crawl"):
        W.box("Wall_hdr_" + gate["id"], st["wall"], *put(0, (1.2 + WALL_H) / 2, 0, L, WALL_H - 1.2, T), bevel=0.01)
        W.box("Wall_hdr_" + gate["id"], st["trim"], *put(0, 1.22, 0, L + 0.1, 0.08, T + 0.1), bevel=0.01)
        W.box(gid, st["dark"], *put(0, 0.58, 0, L - 0.08, 1.12, 0.06))
        for k in range(9):
            W.box(gid, st["metal"], *put(0, 0.12 + k * 0.12, 0.04, L - 0.18, 0.035, 0.06), bevel=0.008)
        return
    W.box("Static", st["trim"], *put(0, 2.42, 0, L + 0.2, 0.36, T + 0.14), bevel=0.02)
    for end in (-1, 1):
        W.box("Static", st["trim"], *put(end * (L / 2 + 0.05), 1.15, 0, 0.14, 2.3, T + 0.14), bevel=0.015)
    if kind == "shutter":
        W.box(gid, st["hazard"], *put(0, 0.12, 0, L, 0.24, T * 0.6))
        for k in range(14):
            W.box(gid, st["metal"], *put(0, 0.32 + k * 0.145, 0, L - 0.04, 0.12, T * 0.5), bevel=0.02)
    elif kind == "glass":
        W.box(gid, st["metal"], *put(0, 1.15, 0, L, 2.3, 0.05), bevel=0.01)
        W.box(gid, st["glass"], *put(0, 1.25, 0, L - 0.3, 1.8, 0.07))
    else:
        for half in (-1, 1):
            W.box(gid, st["door"], *put(half * L / 4, 1.15, 0, L / 2 - 0.03, 2.28, 0.08), bevel=0.02)
            W.box(gid, st["glass"], *put(half * L / 4, 1.55, 0, L / 2 - 0.5, 0.9, 0.1))
            W.box(gid, st["metal"], *put(half * 0.18, 1.05, 0.07, 0.04, 0.6, 0.06), bevel=0.01)
            W.box(gid, st["metal"], *put(half * 0.18, 1.05, -0.07, 0.04, 0.6, 0.06), bevel=0.01)


VAULT_R, VAULT_CY = 1.9, 1.25


def vault_door(W: World, gate: dict, st: dict):
    """The Gilded Exchange's round vault door, for a gate in a wall running along x whose outside is -z.

    Wall_vaultportal is the static stepped portal (with corner piers matching the collision
    walls beside the gate); Gate_<id> is the door, exported with its origin on the hinge so the
    game swings it open by `swing` radians about +y instead of hiding it. Depth t is measured
    from the wall centre toward the outside, so z = gate z - t.
    """
    gx, gz, gid = gate["x"], gate["z"], "Gate_" + gate["id"]
    portal = "Wall_vaultportal"
    cy, R = VAULT_CY, VAULT_R
    z = lambda t: gz - t
    steel = Mat("VaultSteel", img=make_image("vault_steel", tex_brushed(512, (0.5, 0.52, 0.55), 91)), size=1.2, rough=0.22, metal=0.95)
    chrome = Mat("VaultChrome", (0.92, 0.93, 0.95), rough=0.18, metal=1.0)
    gun = Mat("VaultGunmetal", (0.16, 0.17, 0.19), rough=0.35, metal=0.9)
    brass, dark = st["trim"], st["dark"]

    def disc(group, mat, r, t0, t1, cx=gx, ccy=cy, floor=0.03, seg=96):
        if ccy - r >= floor:
            pts = [(cx + r * math.cos(2 * math.pi * i / seg), ccy + r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        else:
            a0 = math.asin((floor - ccy) / r)
            pts = [(cx + r * math.cos(a0 + (math.pi - 2 * a0) * i / seg), ccy + r * math.sin(a0 + (math.pi - 2 * a0) * i / seg)) for i in range(seg + 1)]
        W.prism(group, mat, pts, z(t1), z(t0))

    def on_face(r, a, t):
        return (gx + r * math.cos(a), cy + r * math.sin(a), z(t))

    # ── Portal: three stepped collars, a brass surround and a stepped Deco crest. ──
    PW, PH = 4.6, 3.55
    for r, t0, t1, mat in ((R + 0.08, 0.30, 0.62, steel), (R - 0.04, -0.02, 0.30, gun), (R - 0.14, -0.36, -0.02, steel)):
        W.collar(portal, mat, gx, cy, r, PW, PH, z(t1), z(t0))
    W.band(portal, brass, gx, cy, R + 0.08, R + 0.22, z(0.66), z(0.62), floor=0.0)
    W.band(portal, brass, gx, cy, R - 0.14, R - 0.04, z(-0.36), z(-0.40), floor=0.0)
    for side in (-1, 1):
        W.box(portal, brass, (gx + side * (PW / 2 - 0.08), PH / 2, z(0.65)), (0.16, PH, 0.07), bevel=0.01)
        W.box(portal, brass, (gx + side * (PW / 2 - 0.08), PH / 2, z(-0.39)), (0.16, PH, 0.07), bevel=0.01)
    W.box(portal, brass, (gx, PH - 0.08, z(0.65)), (PW, 0.16, 0.07), bevel=0.01)
    for k, width in enumerate((1.9, 1.2, 0.6)):
        W.box(portal, brass if k % 2 else steel, (gx, PH + 0.1 + k * 0.18, z(0.5)), (width, 0.18, 0.32 - k * 0.06), bevel=0.02)
    for k in range(44):
        a = 2 * math.pi * k / 44
        x, y, _ = on_face(R + 0.32, a, 0)
        if y > 0.12 and abs(x - gx) < PW / 2 - 0.22 and y < PH - 0.22:
            W.sphere(portal, chrome, (x, y, z(0.62)), 0.035, seg=10, rings=6, scale=(1, 1, 0.6))
    # Threshold: steel bridge plate with a hazard nose, flush with the portal floor.
    W.box(portal, steel, (gx, 0.012, z(0.13)), (3.1, 0.024, 0.98))
    W.box(portal, st["hazard"], (gx, 0.026, z(0.56)), (3.1, 0.006, 0.12))
    W.box(portal, st["hazard"], (gx, 0.026, z(-0.3)), (3.1, 0.006, 0.12))
    for side in (-1, 1):
        W.sphere(portal, st["lamp"], (gx + side * 1.5, 3.2, z(0.66)), 0.06, seg=12, rings=8)
    # Hinge: static barrel and brackets; the pivot sits just proud of the portal face.
    hx, ht = gx - 2.25, 0.75
    W.cyl(portal, chrome, (hx, 1.55, z(ht)), 0.07, 2.9, seg=20)
    for y0, y1 in ((0.2, 0.62), (1.42, 1.86), (2.6, 3.02)):
        W.cyl(portal, steel, (hx, (y0 + y1) / 2, z(ht)), 0.16, y1 - y0, seg=28)
        W.box(portal, steel, (hx + 0.02, (y0 + y1) / 2, z((ht + 0.6) / 2)), (0.3, y1 - y0, 0.16), bevel=0.02)
    W.pivots[gid] = (hx, 0.0, z(ht))
    W.extras[gid] = {"swing": math.pi}

    # ── Door: polished front slab over two stepped plugs, with the locking bolts on the first step. ──
    disc(gid, steel, R, 0.44, 0.80)
    disc(gid, gun, R - 0.10, 0.12, 0.44)
    disc(gid, steel, R - 0.20, -0.20, 0.12)
    disc(gid, steel, R - 0.35, -0.26, -0.20)
    for k in range(22):
        a = 2 * math.pi * k / 22 + 0.07
        if cy + (R - 0.1) * math.sin(a) < 0.18:
            continue
        W.pipe(gid, chrome, on_face(R - 0.14, a, 0.28), on_face(R + 0.06, a, 0.28), 0.055, seg=16)
    # Front face: rings, rivets and a brass sunburst around the capstan wheel and two dials.
    W.band(gid, chrome, gx, cy, R - 0.18, R - 0.04, z(0.83), z(0.80), floor=0.03)
    W.band(gid, brass, gx, cy, 1.2, 1.28, z(0.825), z(0.80))
    for k in range(40):
        a = 2 * math.pi * k / 40
        x, y, zz = on_face(R - 0.26, a, 0.80)
        if y > 0.1:
            W.sphere(gid, chrome, (x, y, zz), 0.032, seg=10, rings=6, scale=(1, 1, 0.55))
    for k in range(28):
        a = 2 * math.pi * k / 28 + math.pi / 28
        a_pt, b_pt = on_face(1.34, a, 0.81), on_face(1.58, a, 0.81)
        if min(a_pt[1], b_pt[1]) > 0.1:
            W.pipe(gid, brass, a_pt, b_pt, 0.016, seg=4)
    W.cyl(gid, chrome, (gx, cy, z(0.92)), 0.17, 0.24, seg=32, axis="Z")
    W.cyl(gid, brass, (gx, cy, z(0.82)), 0.3, 0.04, seg=40, axis="Z")
    for k in range(5):
        a = math.pi / 2 + 2 * math.pi * k / 5
        W.pipe(gid, chrome, on_face(0.12, a, 1.0), on_face(0.62, a, 1.0), 0.034, seg=14)
        W.sphere(gid, chrome, on_face(0.66, a, 1.0), 0.075, seg=16, rings=10)
    W.sphere(gid, chrome, (gx, cy, z(1.04)), 0.1, seg=18, rings=10)
    for a in (math.radians(58), math.radians(122)):
        x, y, _ = on_face(0.95, a, 0)
        W.cyl(gid, brass, (x, y, z(0.83)), 0.15, 0.06, seg=32, axis="Z")
        W.cyl(gid, dark, (x, y, z(0.862)), 0.12, 0.004, seg=32, axis="Z")
        for m in range(12):
            b = 2 * math.pi * m / 12
            W.box(gid, brass, (x + math.cos(b) * 0.1, y + math.sin(b) * 0.1, z(0.866)), (0.012, 0.012, 0.006))
        W.cyl(gid, chrome, (x, y, z(0.9)), 0.05, 0.07, seg=18, axis="Z")
    W.box(gid, brass, (gx, cy - 0.95, z(0.81)), (0.64, 0.17, 0.02), bevel=0.005)
    W.box(gid, dark, (gx, cy - 0.95, z(0.822)), (0.56, 0.09, 0.004))
    # Strap hinges from the knuckles across the door face.
    for y in (1.05, 2.2):
        W.cyl(gid, steel, (hx, y, z(ht)), 0.16, 0.5, seg=28)
        W.box(gid, steel, ((hx + gx - 1.15) / 2, y, z(0.84)), (gx - 1.15 - hx, 0.22, 0.09), bevel=0.02)
        W.box(gid, steel, (hx + 0.2, y, z((ht + 0.84) / 2)), (0.36, 0.22, abs(0.84 - ht) + 0.09), bevel=0.02)
    # Back (vault side): bolt linkage, gear train and time locks behind a glass cover.
    W.cyl(gid, brass, (gx, cy, z(-0.29)), 0.3, 0.06, seg=40, axis="Z")
    for k in range(18):
        a = 2 * math.pi * k / 18
        W.pipe(gid, brass, on_face(0.28, a, -0.29), on_face(0.36, a, -0.29), 0.022, seg=4)
    W.cyl(gid, chrome, (gx, cy, z(-0.33)), 0.08, 0.08, seg=20, axis="Z")
    for k in range(8):
        a = 2 * math.pi * k / 8 + math.pi / 8
        if cy + 1.4 * math.sin(a) < 0.2:
            continue
        W.pipe(gid, chrome, on_face(0.32, a, -0.3), on_face(1.38, a, -0.3), 0.025, seg=10)
        x, y, _ = on_face(1.42, a, 0)
        W.box(gid, gun, (x, y, z(-0.3)), (0.14, 0.14, 0.08), bevel=0.01)
    for dx in (-0.48, 0.0, 0.48):
        W.box(gid, brass, (gx + dx, cy + 0.72, z(-0.31)), (0.3, 0.24, 0.1), bevel=0.012)
        W.cyl(gid, st["screen"] if dx == 0 else dark, (gx + dx, cy + 0.72, z(-0.362)), 0.07, 0.004, seg=24, axis="Z")
    W.band(gid, brass, gx, cy, 1.3, 1.36, z(-0.26), z(-0.36))


def console(W: World, o: dict, st: dict, style: str):
    x, z = o["x"], o["z"]
    if style == "lectern":
        W.box("Static", st["trim"], (x, 0.04, z), (0.62, 0.08, 0.62), bevel=0.02)
        W.cyl("Static", st["metal"], (x, 0.48, z), 0.12, 0.8, seg=20)
        W.box("Static", st["dark"], (x, 0.92, z), (0.56, 0.12, 0.42), bevel=0.03)
        W.box("Static", st["screen"], (x, 0.99, z), (0.46, 0.02, 0.32))
    elif style == "server":
        W.box("Static", st["dark"], (x, 0.5, z), (0.58, 1.0, 0.58), bevel=0.03)
        for k in range(5):
            W.box("Static", st["screen"] if k % 2 else st["metal"], (x, 0.18 + k * 0.17, z + 0.295), (0.46, 0.06, 0.01))
        W.box("Static", st["metal"], (x, 1.03, z), (0.62, 0.06, 0.62), bevel=0.02)
    else:  # deco terminal
        W.box("Static", st["dark"], (x, 0.42, z), (0.6, 0.84, 0.5), bevel=0.04)
        W.box("Static", st["trim"], (x, 0.86, z), (0.66, 0.05, 0.56), bevel=0.02)
        W.box("Static", st["screen"], (x, 0.95, z + 0.05), (0.42, 0.18, 0.02), yaw=0)
        for k in range(4):
            W.box("Static", st["trim"], (x - 0.24 + k * 0.16, 0.42, z + 0.255), (0.03, 0.7, 0.01))


def cover_piece(W: World, c: dict, st: dict):
    x, z, w, d = c["x"], c["z"], c["w"], c["d"]
    h = c.get("height", 1.1)
    s = c["style"]
    g = "Cover"
    if s == "vitrine":
        W.box(g, st["plinth"], (x, 0.45, z), (w, 0.9, d), bevel=0.02)
        W.box(g, st["trim"], (x, 0.91, z), (w + 0.04, 0.03, d + 0.04), bevel=0.01)
        W.box(g, st["glass"], (x, 1.06, z), (w - 0.04, 0.3, d - 0.04))
        for k in range(3):
            W.sphere(g, st["metal"] if k % 2 else st["trim"], (x - w / 3 + k * w / 3, 1.0, z), 0.07 + 0.02 * k, scale=(1, 1.4, 1))
    elif s == "statue":
        W.box(g, st["plinth"], (x, 0.55, z), (w, 1.1, d), bevel=0.03)
        W.box(g, st["trim"], (x, 1.12, z), (w + 0.08, 0.05, d + 0.08), bevel=0.015)
        W.box(g, st["trim"], (x, 0.05, z), (w + 0.1, 0.1, d + 0.1), bevel=0.015)
        W.torus(g, st["metal"], (x, 1.75, z), 0.38, 0.09, seg=64, rseg=16, tilt=math.pi / 2 + 0.3, yaw=x)
        W.torus(g, st["metal"], (x, 1.75, z), 0.26, 0.07, seg=48, rseg=12, tilt=0.4, yaw=-x)
        W.sphere(g, st["metal"], (x, 1.75, z), 0.12)
    elif s == "desk":
        W.box(g, st["door"], (x, 0.75, z), (w, 0.06, d), bevel=0.015)
        W.box(g, st["door"], (x, 0.38, z - d / 2 + 0.04), (w, 0.72, 0.06))
        for e in (-1, 1):
            W.box(g, st["door"], (x + e * (w / 2 - 0.03), 0.38, z), (0.06, 0.72, d))
        for k in (-1, 0, 1):
            W.box(g, st["dark"], (x + k * 0.6, 1.0, z - 0.12), (0.5, 0.34, 0.04), bevel=0.01, yaw=k * 0.2)
            W.box(g, st["screen"], (x + k * 0.6, 1.0, z - 0.095), (0.44, 0.28, 0.01), yaw=k * 0.2)
    elif s == "workbench":
        W.box(g, st["door"], (x, 0.9, z), (w, 0.08, d), bevel=0.01)
        for ex in (-1, 1):
            for ez in (-1, 1):
                W.box(g, st["metal"], (x + ex * (w / 2 - 0.06), 0.45, z + ez * (d / 2 - 0.06)), (0.06, 0.9, 0.06))
        W.box(g, st["dark"], (x, 0.3, z), (w - 0.1, 0.04, d - 0.1))
        W.box(g, st["frame"], (x, 1.05, z - 0.5), (0.7, 0.22, 0.5), bevel=0.02)
        W.cyl(g, st["lamp"], (x + 0.2, 1.06, z + 0.8), 0.08, 0.24, seg=16)
    elif s == "crates":
        rng = random.Random(int(x * 13 + z * 7))
        W.box(g, st["crate"], (x, 0.55, z), (w, 1.1, d), bevel=0.03)
        for k in (-1, 1):
            W.box(g, st["dark"], (x, 0.55, z + k * (d / 2 + 0.005)), (w - 0.1, 0.06, 0.012))
            W.box(g, st["dark"], (x + k * (w / 2 + 0.005), 0.55, z), (0.012, 0.06, d - 0.1))
        if rng.random() < 0.8:
            W.box(g, st["crate"], (x + rng.uniform(-0.1, 0.1), 1.35, z + rng.uniform(-0.1, 0.1)), (w * 0.6, 0.5, d * 0.6), bevel=0.025, yaw=rng.uniform(-0.3, 0.3))
    elif s == "counter":
        W.box(g, st["panel"], (x, 0.5, z), (w, 1.0, d), bevel=0.02)
        W.box(g, st["plinth"], (x, 1.03, z), (w + 0.1, 0.06, d + 0.12), bevel=0.02)
        n = max(2, int(w / 1.2))
        for k in range(n + 1):
            W.box(g, st["metal"], (x - w / 2 + k * w / n, 1.35, z), (0.04, 0.6, 0.04))
            if k < n:
                W.box(g, st["glass"], (x - w / 2 + (k + 0.5) * w / n, 1.36, z), (w / n - 0.06, 0.54, 0.015))
        for k in range(n):
            W.box(g, st["trim"], (x - w / 2 + (k + 0.5) * w / n, 0.5, z + d / 2 + 0.01), (w / n - 0.2, 0.7, 0.02), bevel=0.01)
    elif s == "hvac":
        W.box(g, st["metal"], (x, 0.55, z), (w, 1.1, d), bevel=0.04)
        for k in range(int(w / 0.12)):
            W.box(g, st["dark"], (x - w / 2 + 0.1 + k * 0.12, 0.55, z + d / 2 + 0.01), (0.04, 0.8, 0.02))
        W.cyl(g, st["dark"], (x, 1.12, z), min(w, d) * 0.36, 0.05, seg=32)
        for k in range(3):
            a = k * 2 * math.pi / 3
            W.box(g, st["metal"], (x + math.cos(a) * 0.15, 1.16, z + math.sin(a) * 0.15), (0.3, 0.02, 0.08), yaw=-a)
    elif s == "van":
        W.box(g, st["van"], (x, 1.15, z - 0.35), (w, 1.7, d - 0.7), bevel=0.06)
        W.box(g, st["van"], (x, 0.95, z + d / 2 - 0.45), (w, 1.3, 0.9), bevel=0.15)
        W.box(g, st["glass"], (x, 1.35, z + d / 2 - 0.12), (w - 0.15, 0.5, 0.25), bevel=0.04)
        for ez in (-1, 1):
            for ex in (-1, 1):
                W.cyl(g, st["dark"], (x + ex * (w / 2 - 0.05), 0.34, z + ez * (d / 2 - 0.9)), 0.34, 0.24, seg=24, axis="X")
                W.cyl(g, st["metal"], (x + ex * (w / 2 + 0.06), 0.34, z + ez * (d / 2 - 0.9)), 0.16, 0.02, seg=16, axis="X")
        W.box(g, st["lamp"], (x - 0.6, 0.9, z + d / 2 + 0.01), (0.3, 0.12, 0.02))
        W.box(g, st["lamp"], (x + 0.6, 0.9, z + d / 2 + 0.01), (0.3, 0.12, 0.02))
        W.box(g, st["trim"], (x + w / 2 + 0.005, 1.2, z - 0.4), (0.01, 0.12, d - 1.2))
    else:
        W.box(g, st["plinth"], (x, h / 2, z), (w, h, d), bevel=0.03)


def tree(W: World, x, z, y0, st, rng):
    h = rng.uniform(2.6, 3.6)
    W.cyl("Static", st["bark"], (x, y0 + h / 2, z), 0.14, h, seg=10, r2=0.08)
    for k in range(5):
        W.sphere("Static", st["leaf"], (x + rng.uniform(-0.6, 0.6), y0 + h + rng.uniform(-0.3, 0.6), z + rng.uniform(-0.6, 0.6)), rng.uniform(0.7, 1.1), seg=10, rings=7, scale=(1, 0.85, 1))


def street_lamp(W: World, x, z, y0, st):
    W.cyl("Static", st["dark"], (x, y0 + 2.1, z), 0.06, 4.2, seg=12)
    W.cyl("Static", st["dark"], (x, y0 + 0.2, z), 0.14, 0.4, seg=12)
    W.box("Static", st["dark"], (x, y0 + 4.25, z), (0.36, 0.08, 0.36), bevel=0.02)
    W.box("Static", st["lamp"], (x, y0 + 4.1, z), (0.26, 0.24, 0.26), bevel=0.03)


def floor_slabs(W: World, m: dict, st: dict, mat_key="floor"):
    for f in m["floors"]:
        W.box("Floor", st[mat_key], (f["x"], -0.15, f["z"]), (f["w"], 0.3, f["d"]))


def outer_shell(W: World, st: dict, y_ground: float, door_spots: list, window_mat):
    """Perimeter walls whose inner faces sit on the 32 x 24 m play boundary, with an exterior facade."""
    T = 0.45
    sides = [dict(x=0, z=12 + T / 2, w=32 + 2 * T, d=T, n=(0, 1)), dict(x=0, z=-12 - T / 2, w=32 + 2 * T, d=T, n=(0, -1)),
             dict(x=16 + T / 2, z=0, w=T, d=24, n=(1, 0)), dict(x=-16 - T / 2, z=0, w=T, d=24, n=(-1, 0))]
    for i, s in enumerate(sides):
        group = f"Wall_outer_{i}"
        inward = -1 if (s["n"][0] + s["n"][1]) > 0 else 1
        detailed_wall(W, group, s, st, h=2.9, faces=(inward,), sconces=True)
        along_x, L, Tt, put = wall_frame(s)
        out = -inward
        drop = 2.9 - y_ground
        W.box(group, st["stone"], *put(0, (2.9 + y_ground) / 2, out * (Tt / 2 + 0.06), L + 0.12, drop, 0.12))
        W.box(group, st["trim"], *put(0, 3.0, 0, L + 0.5, 0.2, Tt + 0.5), bevel=0.04)
        W.box(group, st["trim"], *put(0, 3.18, 0, L + 0.3, 0.16, Tt + 0.3), bevel=0.03)
        bays = int(L / 3)
        for k in range(bays):
            u = -L / 2 + (k + 0.5) * L / bays
            if any(abs((s["x"] + u if along_x else s["z"] + u) - dp[1]) < 2.2 and dp[0] == i for dp in door_spots):
                continue
            W.box(group, st["trim"], *put(u - L / bays / 2, (2.9 + y_ground) / 2, out * (Tt / 2 + 0.16), 0.36, drop, 0.2), bevel=0.02)
            W.box(group, window_mat, *put(u, 1.3, out * (Tt / 2 + 0.125), 1.3, 2.0, 0.02))
            W.box(group, st["trim"], *put(u, 0.25, out * (Tt / 2 + 0.2), 1.6, 0.1, 0.2), bevel=0.02)
            W.box(group, st["trim"], *put(u, 2.4, out * (Tt / 2 + 0.2), 1.6, 0.14, 0.2), bevel=0.02)


def podium_and_grounds(W: World, st: dict, y0: float, rng, trees=24, lamps=12):
    # The podium stops under the 0.3 m floor slab: coplanar tops z-fight across the whole floor.
    W.box("Static", st["stone"], (0, (y0 - 0.31) / 2, 0), (32.9, -0.31 - y0, 24.9))
    W.box("Static", st["paver"], (0, y0 - 0.05, 0), (64, 0.1, 52))
    W.box("Static", st["grass"], (0, y0 - 0.12, 0), (260, 0.1, 260))
    for z in (-30, 30):
        W.box("Static", st["asphalt"], (0, y0 - 0.06, z), (260, 0.06, 9))
        for x in range(-120, 121, 6):
            W.box("Static", st["lamp"], (x, y0 - 0.025, z), (2.4, 0.01, 0.14))
    for i in range(trees):
        a = 2 * math.pi * i / trees + rng.uniform(-0.1, 0.1)
        r = rng.uniform(21, 26)
        tx, tz = math.cos(a) * r * 1.15, math.sin(a) * r * 0.85
        if abs(tz) > 24 or abs(tx) < 4 and tz > 0:
            continue
        tree(W, tx, tz, y0, st, rng)
    for i in range(lamps):
        a = 2 * math.pi * i / lamps
        street_lamp(W, math.cos(a) * 21, math.sin(a) * 17, y0, st)


# ─── Levels ──────────────────────────────────────────────────────────────────

def textures_common():
    return {
        "glass": Mat("Glass", (0.55, 0.7, 0.75), rough=0.05, metal=0.2, alpha=0.28),
        "dark": Mat("DarkMetal", (0.05, 0.055, 0.06), rough=0.4, metal=0.6),
        "hazard": Mat("Hazard", img=make_image("hazard", tex_hazard()), size=1.0, rough=0.6),
        "grass": Mat("Grass", img=make_image("grass", tex_grass()), size=6.0, rough=0.95),
        "asphalt": Mat("Asphalt", img=make_image("asphalt", tex_asphalt()), size=4.0, rough=0.9),
        "paver": Mat("Paver", img=make_image("paver", tex_paver()), size=3.0, rough=0.8),
        "bark": Mat("Bark", (0.2, 0.13, 0.08), rough=0.9),
        "leaf": Mat("Leaves", (0.09, 0.2, 0.08), rough=0.85),
        "crate": Mat("CrateWood", img=make_image("crate", tex_wood(512, (0.55, 0.38, 0.2), 31, planks=4)), size=1.0, rough=0.8),
    }


def build_museum(m: dict) -> World:
    W = World()
    c = textures_common()
    gold = make_image("brass", tex_brushed(512, (0.78, 0.6, 0.3)))
    st = dict(c,
              floor=Mat("MarbleFloor", img=make_image("marble_floor", tex_checker_marble()), size=2.0, rough=0.18),
              wall=Mat("Plaster", img=make_image("plaster", tex_plaster()), size=3.0, rough=0.85),
              panel=Mat("PanelPlaster", img=make_image("panel", tex_plaster(512, (0.8, 0.75, 0.66), 4)), size=3.0, rough=0.7),
              plinth=Mat("DarkMarble", img=make_image("dark_marble", marble(1024, (0.16, 0.17, 0.18), (0.6, 0.58, 0.55), 41)), size=1.5, rough=0.2),
              trim=Mat("Cornice", (0.92, 0.88, 0.8), rough=0.55),
              metal=Mat("Brass", img=gold, size=1.0, rough=0.28, metal=0.9),
              frame=Mat("GiltFrame", (0.72, 0.52, 0.22), rough=0.3, metal=0.85),
              lamp=Mat("WarmLamp", (1.0, 0.78, 0.48), emit=6.0),
              screen=Mat("Screen", (0.35, 0.75, 0.9), emit=3.0),
              door=Mat("Oak", img=make_image("oak", tex_wood(1024, (0.36, 0.22, 0.11), 5)), size=1.5, rough=0.5),
              stone=Mat("Ashlar", img=make_image("ashlar", tex_stone_block()), size=2.0, rough=0.85),
              van=Mat("Van", (0.8, 0.8, 0.82), rough=0.3, metal=0.4),
              paintings=[Mat(f"Painting{i}", img=make_image(f"painting{i}", tex_painting(i)), size=1.0, rough=0.6) for i in range(8)])
    st["frames"] = True
    windows = Mat("WarmWindows", img=make_image("museum_windows", tex_facade(512, (0.2, 0.17, 0.13), 51, 2, 2)), size=2.0, rough=0.2, emit=1.2)
    rng = random.Random(1)
    floor_slabs(W, m, st)
    gallery_faces = {}
    for i, w in enumerate(m["walls"]):
        if w.get("kind") in ("cover",) or w.get("height", 2.5) < 2:
            continue
        detailed_wall(W, f"Wall_{i}", w, st, paintings=(-1, 1))
    for g in m["gates"]:
        door(W, g, st, "double" if g["id"] != "return" else "glass")
    for o in m["objectives"]:
        if o["kind"] != "loot":
            console(W, o, st, "lectern")
    for cv in m["cover"]:
        cover_piece(W, cv, st)
    # The artifact vitrine; the game draws the cargo inside it until it is stolen.
    lx, lz = m["diamond"]["x"], m["diamond"]["z"]
    W.cyl("Static", st["plinth"], (lx, 0.2, lz), 0.62, 0.4, seg=48)
    W.cyl("Static", st["metal"], (lx, 0.41, lz), 0.66, 0.03, seg=48)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        W.cyl("Static", st["metal"], (lx + math.cos(a) * 0.5, 0.95, lz + math.sin(a) * 0.5), 0.02, 1.1, seg=8)
    W.box("Static", st["metal"], (lx, 1.5, lz), (0.78, 0.04, 0.78), bevel=0.01)
    # Grand stair, portico and pediment on the south entrance.
    y0 = -1.2
    podium_and_grounds(W, st, y0, rng)
    for k in range(6):
        W.box("Static", st["stone"], (0, y0 + 0.2 * k + 0.1, 12.45 + 3.0 - k * 0.5), (14 - k * 0.2, 0.2, 0.5 + k * 0.0 + 0.02))
    W.box("Static", st["stone"], (0, -0.05, 13.5), (13, 0.1, 2.1))
    for k in range(8):
        x = -6.3 + k * 1.8
        W.cyl("Static", st["trim"], (x, 0.12, 13.9), 0.42, 0.24, seg=32)
        W.cyl("Static", st["trim"], (x, 2.2, 13.9), 0.3, 4.0, seg=24, r2=0.26)
        W.box("Static", st["trim"], (x, 4.28, 13.9), (0.75, 0.18, 0.75), bevel=0.03)
    W.box("Static", st["trim"], (0, 4.55, 13.4), (15, 0.4, 2.0), bevel=0.04)
    pb = bmesh.new()
    verts = [pb.verts.new(v) for v in ((-7.6, 0, 1.0), (7.6, 0, 1.0), (0, 2.0, 1.0), (-7.6, 0, -1.0), (7.6, 0, -1.0), (0, 2.0, -1.0))]
    for f in ((0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)):
        pb.faces.new([verts[i] for i in f])
    W._merge(pb, "Static", st["trim"], Matrix.Translation((0, 4.75, 13.4)))
    W.box("Static", st["door"], (0, 1.5, 12.47), (3.2, 3.0, 0.08), bevel=0.02)
    W.box("Static", st["metal"], (0, 1.2, 12.53), (0.06, 0.8, 0.05))
    # Loading dock roll-up door to the north.
    W.box("Static", st["hazard"], (-10, 0.08, -12.47), (4.4, 0.16, 0.06))
    for k in range(16):
        W.box("Static", st["dark"], (-10, 0.25 + k * 0.155, -12.5), (4.2, 0.13, 0.05), bevel=0.02)
    outer_shell(W, st, y0, [(0, 0), (1, -10)], windows)
    return W


def build_bank(m: dict) -> World:
    W = World()
    c = textures_common()
    st = dict(c,
              floor=Mat("BankMarble", img=make_image("bank_floor", tex_bank_floor()), size=2.0, rough=0.15),
              wall=Mat("DecoPlaster", img=make_image("deco_plaster", tex_plaster(512, (0.78, 0.72, 0.6), 8)), size=3.0, rough=0.8),
              panel=Mat("Walnut", img=make_image("walnut", tex_wood(1024, (0.24, 0.12, 0.06), 6)), size=1.5, rough=0.35),
              plinth=Mat("GreenMarble", img=make_image("green_marble", marble(1024, (0.08, 0.2, 0.15), (0.75, 0.8, 0.72), 61, sharp=12)), size=1.5, rough=0.15),
              trim=Mat("DecoBrass", img=make_image("deco_brass", tex_brushed(512, (0.82, 0.62, 0.28), 62)), size=1.0, rough=0.25, metal=0.9),
              metal=Mat("Steel", img=make_image("steel", tex_brushed(512, (0.62, 0.64, 0.66), 63)), size=1.0, rough=0.3, metal=0.9),
              frame=Mat("DarkWalnut", (0.12, 0.07, 0.04), rough=0.4),
              lamp=Mat("DecoLamp", (1.0, 0.82, 0.55), emit=6.0),
              screen=Mat("GreenScreen", (0.3, 0.95, 0.55), emit=2.5),
              door=Mat("DoorWalnut", img=make_image("door_walnut", tex_wood(1024, (0.3, 0.15, 0.07), 7)), size=1.5, rough=0.4),
              stone=Mat("Granite", img=make_image("granite", tex_stone_block(1024, (0.5, 0.48, 0.45), 64)), size=2.0, rough=0.7),
              van=Mat("VanPaint", (0.1, 0.12, 0.16), rough=0.25, metal=0.5),
              paintings=[Mat(f"Portrait{i}", img=make_image(f"portrait{i}", tex_painting(i + 20)), size=1.0, rough=0.6) for i in range(4)])
    windows = Mat("BankWindows", img=make_image("bank_windows", tex_facade(512, (0.12, 0.1, 0.08), 71, 2, 2)), size=2.0, rough=0.2, emit=1.0)
    rng = random.Random(2)
    floor_slabs(W, m, st)
    # Freight bays get industrial concrete laid on top of the marble.
    conc = Mat("FreightConcrete", img=make_image("freight_conc", tex_concrete(1024, (0.42, 0.42, 0.4), 65)), size=4.0, rough=0.85)
    W.box("Floor", conc, (0, 0.006, -9.5), (32, 0.012, 5))
    W.box("Floor", conc, (12.5, 0.006, -2.5), (7, 0.012, 9))
    W.box("Floor", st["hazard"], (0, 0.017, -7.25), (4, 0.01, 0.15))
    for i, w in enumerate(m["walls"]):
        if w.get("kind") == "cover":
            continue
        if w.get("kind") == "solid" and w.get("height", 2.5) < 2.4:
            continue
        detailed_wall(W, f"Wall_{i}", w, st, paintings=(-1, 1) if w["z"] > 0 else None)
    for g in m["gates"]:
        if g["id"] == "rear":
            vault_door(W, g, st)
        else:
            door(W, g, st, "shutter" if g["id"].startswith("freight") else "double")
    for o in m["objectives"]:
        if o["kind"] != "loot":
            console(W, o, st, "deco")
    for cv in m["cover"]:
        cover_piece(W, cv, st)
    # Safe-deposit wall inside the vault, flush to the side walls.
    for side in (-1, 1):
        x = side * 3.8
        W.box("Static", st["metal"], (x, 1.3, -3.5), (0.12, 2.4, 6.6), bevel=0.01)
        for row in range(8):
            for col in range(11):
                W.box("Static", st["trim"], (x - side * 0.065, 0.3 + row * 0.28, -6.5 + col * 0.6), (0.01, 0.22, 0.5))
    # Chandeliers over the banking hall (high above the play space).
    for x in (-8, 0, 8):
        W.pipe("Static", st["trim"], (x, 4.6, 8.5), (x, 3.6, 8.5), 0.02)
        W.torus("Static", st["trim"], (x, 3.5, 8.5), 0.7, 0.04)
        for k in range(8):
            a = k * math.pi / 4
            W.sphere("Static", st["lamp"], (x + math.cos(a) * 0.7, 3.62, 8.5 + math.sin(a) * 0.7), 0.08)
    y0 = -0.8
    podium_and_grounds(W, st, y0, rng, trees=18, lamps=14)
    for k in range(4):
        W.box("Static", st["stone"], (0, y0 + 0.2 * k + 0.1, 12.45 + 2 - k * 0.5), (10 - k * 0.3, 0.2, 0.52))
    W.box("Static", st["door"], (0, 1.5, 12.47), (3.0, 3.0, 0.08), bevel=0.02)
    for k in range(5):
        W.box("Static", st["trim"], (-1.2 + k * 0.6, 1.5, 12.53), (0.04, 2.8, 0.04))
    W.box("Static", st["trim"], (0, 3.4, 12.6), (6, 0.5, 0.3), bevel=0.03)
    for x in (-2.5, 2.5):
        for k in range(4):
            W.box("Static", st["trim"], (x, 3.8 + k * 0.35, 12.6), (1.6 - k * 0.35, 0.3, 0.25), bevel=0.02)
    outer_shell(W, st, y0, [(0, 0), (2, 8)], windows)
    return W


def clip_floors(m: dict):
    """Split bridge rects so they never overlap the tower roofs (no z-fighting)."""
    towers = m["floors"][:3]
    pieces = []
    for f in m["floors"][3:]:
        along_x = f["w"] >= f["d"]
        lo, hi = (f["x"] - f["w"] / 2, f["x"] + f["w"] / 2) if along_x else (f["z"] - f["d"] / 2, f["z"] + f["d"] / 2)
        cuts = []
        for t in towers:
            if along_x and abs(t["z"] - f["z"]) < (t["d"] + f["d"]) / 2 - 0.01:
                cuts.append((t["x"] - t["w"] / 2, t["x"] + t["w"] / 2))
            if not along_x and abs(t["x"] - f["x"]) < (t["w"] + f["w"]) / 2 - 0.01:
                cuts.append((t["z"] - t["d"] / 2, t["z"] + t["d"] / 2))
        spans = [(lo, hi)]
        for a, b in cuts:
            nxt = []
            for s0, s1 in spans:
                if b <= s0 or a >= s1:
                    nxt.append((s0, s1))
                    continue
                if a > s0:
                    nxt.append((s0, a))
                if b < s1:
                    nxt.append((b, s1))
            spans = nxt
        for s0, s1 in spans:
            if s1 - s0 > 0.05:
                pieces.append(dict(x=(s0 + s1) / 2, z=f["z"], w=s1 - s0, d=f["d"]) if along_x else dict(x=f["x"], z=(s0 + s1) / 2, w=f["w"], d=s1 - s0))
    return towers, pieces


def build_sky(m: dict) -> World:
    W = World()
    c = textures_common()
    st = dict(c,
              floor=Mat("RoofConcrete", img=make_image("roof_concrete", tex_concrete()), size=4.0, rough=0.9),
              wall=Mat("PanelConcrete", img=make_image("panel_concrete", tex_concrete(512, (0.45, 0.48, 0.5), 66, 2)), size=2.5, rough=0.85),
              panel=Mat("SteelPanel", (0.3, 0.35, 0.4), rough=0.45, metal=0.6),
              plinth=Mat("DarkSteel", (0.12, 0.14, 0.16), rough=0.5, metal=0.7),
              trim=Mat("CyanTrim", (0.35, 0.42, 0.48), rough=0.35, metal=0.8),
              metal=Mat("RoofSteel", img=make_image("roof_steel", tex_brushed(512, (0.55, 0.58, 0.6), 67)), size=1.0, rough=0.35, metal=0.85),
              frame=Mat("Gunmetal", (0.2, 0.22, 0.25), rough=0.4, metal=0.8),
              lamp=Mat("CyanLamp", (0.45, 0.9, 1.0), emit=6.0),
              screen=Mat("CyanScreen", (0.3, 0.85, 1.0), emit=3.0),
              door=Mat("Composite", (0.25, 0.28, 0.3), rough=0.5),
              stone=Mat("TowerStone", (0.3, 0.33, 0.36), rough=0.7),
              van=Mat("VanPaint", (0.1, 0.12, 0.16), rough=0.25, metal=0.5))
    grate = Mat("Grating", img=make_image("grating", tex_concrete(512, (0.32, 0.34, 0.36), 68, 16)), size=1.0, rough=0.6, metal=0.6)
    facade = Mat("TowerFacade", img=make_image("tower_facade", tex_facade(1024, (0.1, 0.12, 0.15), 81, 6, 3, warm=False)), size=8.0, rough=0.15, emit=0.9)
    red = Mat("BeaconRed", (1.0, 0.15, 0.12), emit=8.0)
    yellow = Mat("PadYellow", (0.95, 0.75, 0.12), rough=0.6)
    white = Mat("PadWhite", (0.92, 0.92, 0.9), rough=0.6)
    towers, bridges = clip_floors(m)
    rng = random.Random(3)
    depth = 70
    for t in towers:
        W.box("Floor", st["floor"], (t["x"], -0.15, t["z"]), (t["w"], 0.3, t["d"]))
        W.box("Static", facade, (t["x"], -0.3 - depth / 2, t["z"]), (t["w"] + 1.4, depth, t["d"] + 1.4))
        W.box("Static", st["frame"], (t["x"], -0.35, t["z"]), (t["w"] + 1.6, 0.4, t["d"] + 1.6), bevel=0.04)
        for k in range(1, 9):
            W.box("Static", st["frame"], (t["x"], -0.3 - k * 8, t["z"]), (t["w"] + 1.5, 0.3, t["d"] + 1.5))
    for b in bridges:
        W.box("Floor", grate, (b["x"], -0.06, b["z"]), (b["w"], 0.12, b["d"]))
        along_x = b["w"] >= b["d"]
        L = b["w"] if along_x else b["d"]
        for side in (-1, 1):
            if along_x:
                W.box("Static", st["frame"], (b["x"], -0.55, b["z"] + side * (b["d"] / 2 - 0.1)), (b["w"], 0.9, 0.16))
            else:
                W.box("Static", st["frame"], (b["x"] + side * (b["w"] / 2 - 0.1), -0.55, b["z"]), (0.16, 0.9, b["d"]))
        n = max(2, int(L / 1.5))
        for k in range(n):
            u0, u1 = -L / 2 + k * L / n, -L / 2 + (k + 1) * L / n
            for side in (-1, 1):
                if along_x:
                    a = (b["x"] + u0, -0.12, b["z"] + side * (b["d"] / 2 - 0.1)); e = (b["x"] + u1, -0.95, b["z"] + side * (b["d"] / 2 - 0.1))
                else:
                    a = (b["x"] + side * (b["w"] / 2 - 0.1), -0.12, b["z"] + u0); e = (b["x"] + side * (b["w"] / 2 - 0.1), -0.95, b["z"] + u1)
                W.pipe("Static", st["metal"], a, e, 0.035, seg=8)
    # Parapets and glass rails on every exposed roof edge (exactly the collision boundary).
    floors = m["floors"]
    inside = lambda x, z: any(abs(x - f["x"]) < f["w"] / 2 - 0.01 and abs(z - f["z"]) < f["d"] / 2 - 0.01 for f in floors)
    for f in floors:
        for side in (-1, 1):
            for axis in ("x", "z"):
                length = f["w"] if axis == "x" else f["d"]
                steps = int(round(length / 0.5))
                for k in range(steps):
                    u = -length / 2 + (k + 0.5) * length / steps
                    if axis == "x":
                        px, pz = f["x"] + u, f["z"] + side * f["d"] / 2
                        out = (px, pz + side * 0.2)
                        size = (length / steps, 0.0, 0.12)
                    else:
                        px, pz = f["x"] + side * f["w"] / 2, f["z"] + u
                        out = (px + side * 0.2, pz)
                        size = (0.12, 0.0, length / steps)
                    if inside(*out):
                        continue
                    ox, oz = (0, side * 0.06) if axis == "x" else (side * 0.06, 0)
                    W.box("Static", st["wall"], (px + ox, 0.25, pz + oz), (size[0] or 0.12, 0.5, size[2] or 0.12))
                    W.box("Static", st["glass"], (px + ox, 0.8, pz + oz), ((size[0] or 0.12) * (0.98 if axis == "x" else 0.3), 0.6, (size[2] or 0.12) * (0.3 if axis == "x" else 0.98)))
                    if k % 2 == 0:
                        W.box("Static", st["metal"], (px + ox, 1.12, pz + oz), ((size[0] or 0.12) * (1.0 if axis == "x" else 0.6), 0.05, (size[2] or 0.12) * (0.6 if axis == "x" else 1.0)))
    for i, w in enumerate(m["walls"]):
        if w.get("kind") == "cover":
            continue
        detailed_wall(W, f"Wall_{i}", w, st, sconces=True)
    for g in m["gates"]:
        door(W, g, st, "glass" if g["id"] == "bridge" else "double")
    for o in m["objectives"]:
        if o["kind"] != "loot":
            console(W, o, st, "server")
    for cv in m["cover"]:
        cover_piece(W, cv, st)
    # Helipad markings around the extraction point.
    hx, hz = m["exit"]["x"], m["exit"]["z"]
    W.annulus("Static", yellow, (hx, 0.002, hz), 2.7, 2.95, h=0.01)
    W.annulus("Static", white, (hx, 0.002, hz), 3.4, 3.5, h=0.01)
    for dx in (-0.55, 0.55):
        W.box("Static", white, (hx + dx, 0.007, hz), (0.28, 0.01, 1.8))
    W.box("Static", white, (hx, 0.007, hz), (1.1, 0.01, 0.28))
    for k in range(16):
        a = 2 * math.pi * k / 16
        W.cyl("Static", st["lamp"], (hx + math.cos(a) * 3.2, 0.04, hz + math.sin(a) * 3.2), 0.06, 0.08, seg=12)
    # Power core cradle where the loot sits.
    lx, lz = m["diamond"]["x"], m["diamond"]["z"]
    W.cyl("Static", st["plinth"], (lx, 0.12, lz), 0.7, 0.24, seg=40)
    W.torus("Static", st["lamp"], (lx, 0.26, lz), 0.55, 0.035)
    for k in range(3):
        a = 2 * math.pi * k / 3
        W.box("Static", st["metal"], (lx + math.cos(a) * 0.6, 0.7, lz + math.sin(a) * 0.6), (0.12, 1.2, 0.12), bevel=0.02, yaw=-a)
    # Rooftop clutter on the ledges outside the parapets: masts, vents, dishes.
    for t in towers:
        for k in range(4):
            sx = t["x"] + (t["w"] / 2 + 0.45) * (1 if k % 2 else -1)
            sz = t["z"] + rng.uniform(-t["d"] / 2 + 1, t["d"] / 2 - 1)
            W.cyl("Static", st["metal"], (sx, 0.35, sz), 0.18, 0.7, seg=16)
            W.cyl("Static", st["frame"], (sx, 0.75, sz), 0.26, 0.1, seg=16)
        mx, mz = t["x"] + t["w"] / 2 + 0.4, t["z"] + t["d"] / 2 + 0.4
        W.cyl("Static", st["frame"], (mx, 3.0, mz), 0.06, 6.0, seg=10, r2=0.03)
        W.sphere("Static", red, (mx, 6.05, mz), 0.12)
        for k in range(4):
            W.pipe("Static", st["metal"], (mx, 1.0 + k * 1.3, mz), (mx + 0.5, 1.0 + k * 1.3 + 0.6, mz), 0.015, seg=6)
    dx, dz = towers[0]["x"] - towers[0]["w"] / 2 - 0.45, towers[0]["z"]
    W.cyl("Static", st["frame"], (dx, 0.6, dz), 0.08, 1.2, seg=10)
    W.cyl("Static", st["metal"], (dx - 0.1, 1.45, dz), 0.75, 0.22, seg=32, r2=0.12, axis="X", yaw=0.5)
    W.pipe("Static", st["frame"], (dx - 0.2, 1.45, dz), (dx - 0.75, 1.45, dz + 0.4), 0.02, seg=6)
    # Neighbouring skyline towers close by, for depth.
    for k in range(10):
        a = 2 * math.pi * k / 10 + 0.3
        r = rng.uniform(40, 58)
        x, z = math.cos(a) * r, math.sin(a) * r
        h = rng.uniform(-28, 8)
        w = rng.uniform(6, 11)
        W.box("Static", facade, (x, (h - 80) / 2, z), (w, h + 80, w))
        W.box("Static", st["frame"], (x, h + 0.2, z), (w + 0.4, 0.4, w + 0.4))
        if k % 3 == 0:
            W.sphere("Static", red, (x, h + 0.6, z), 0.2)
    return W


def setup_preview(level: int):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.02, 0.03, 0.06, 1)
    bg.inputs["Strength"].default_value = 0.6
    sun_data = bpy.data.lights.new("Moon", "SUN")
    sun_data.energy = 2.2
    sun_data.color = (0.75, 0.82, 1.0)
    sun = bpy.data.objects.new("Moon", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(15), math.radians(35))
    scene.collection.objects.link(sun)
    for x, z in ((-8, -2), (8, -2), (0, 8), (-8, 8), (8, 8), (0, -8)):
        ld = bpy.data.lights.new("Fill", "POINT")
        ld.energy = 400
        ld.color = (1.0, 0.85, 0.65) if level < 2 else (0.6, 0.85, 1.0)
        lo = bpy.data.objects.new("Fill", ld)
        lo.location = (x, -z, 4.5)
        scene.collection.objects.link(lo)
    cam_data = bpy.data.cameras.new("Preview")
    cam_data.lens = 28
    cam = bpy.data.objects.new("Preview", cam_data)
    cam.location = (20, -26, 20)
    cam.rotation_euler = (Vector((0, 0, -2)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam


def main():
    builders = [build_museum, build_bank, build_sky]
    for level, builder in enumerate(builders):
        if ONLY is not None and level != ONLY:
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        W = builder(MAPS[level])
        objs = W.build()
        tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        out = OUT / f"hd-world-{level}.glb"
        bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", use_selection=True, export_yup=True,
                                  export_apply=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
                                  export_image_format="JPEG", export_jpeg_quality=86, export_cameras=False, export_lights=False,
                                  export_animations=False, export_extras=True)
        ART.mkdir(exist_ok=True)
        if PREVIEW:
            setup_preview(level)
            bpy.context.scene.render.filepath = str(ART / f"hd-preview-{level}.png")
            bpy.ops.render.render(write_still=True)
        bpy.ops.wm.save_as_mainfile(filepath=str(ART / f"hd-world-{level}.blend"))
        print(f"LEVEL {level}: {len(objs)} nodes, {tris} triangles, {out.stat().st_size / 1e6:.2f} MB -> {out.name}")


if __name__ == "__main__":
    main()
