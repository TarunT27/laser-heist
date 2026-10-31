"""Build the original Laser Heist helicopter source and GLB.

Coordinates in this file are expressed in the exported game convention:
X = lateral, Y = up, +Z = nose/forward. Blender's standard Z-up axes are
converted at the boundary by target_to_blender().
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "art" / "helicopter.blend"
GLB_PATH = ROOT / "public" / "heist" / "helicopter.glb"
QA_DIR = ROOT / "docs" / "laser" / "qa"

ASSET_OBJECTS: list[bpy.types.Object] = []
MATERIALS: dict[str, bpy.types.Material] = {}


def target_to_blender(point: tuple[float, float, float] | Vector) -> tuple[float, float, float]:
    """Map game coordinates (X, Y-up, +Z-forward) into Blender (Z-up, -Y-forward)."""
    x, y, z = point
    return (x, -z, y)


def new_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.4,
    coat: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = min(roughness, 0.22)
    MATERIALS[name] = mat
    return mat


def build_materials() -> None:
    new_material("Archive Green Enamel", (0.045, 0.125, 0.105, 1.0), metallic=0.46, roughness=0.27, coat=0.34)
    new_material("Graphite Composite", (0.022, 0.032, 0.032, 1.0), metallic=0.42, roughness=0.31, coat=0.18)
    new_material("Warm Ivory", (0.77, 0.68, 0.51, 1.0), metallic=0.24, roughness=0.31, coat=0.18)
    new_material("Brushed Brass", (0.54, 0.31, 0.12, 1.0), metallic=0.82, roughness=0.24, coat=0.24)
    new_material("Smoked Teal Glazing", (0.018, 0.075, 0.09, 1.0), metallic=0.48, roughness=0.15, coat=0.7)
    new_material("Rotor Carbon", (0.035, 0.048, 0.046, 1.0), metallic=0.48, roughness=0.27, coat=0.22)
    new_material("Rubber", (0.009, 0.012, 0.013, 1.0), metallic=0.08, roughness=0.53)
    new_material("Warm Light", (1.0, 0.63, 0.25, 1.0), metallic=0.12, roughness=0.2, coat=0.24)
    new_material("Navigation Red", (0.55, 0.035, 0.02, 1.0), metallic=0.12, roughness=0.2, coat=0.38)
    new_material("Navigation Green", (0.035, 0.42, 0.17, 1.0), metallic=0.12, roughness=0.2, coat=0.38)


def mesh_object(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    material: bpy.types.Material,
    *,
    parent: bpy.types.Object | None = None,
    smooth: bool = True,
    recalc_normals: bool = True,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata([target_to_blender(v) for v in vertices], [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    if recalc_normals and faces:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    if parent:
        obj.parent = parent
        obj.location = (0.0, 0.0, 0.0)
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    ASSET_OBJECTS.append(obj)
    return obj


def empty_object(name: str, parent: bpy.types.Object, target_position=(0.0, 0.0, 0.0)) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.empty_display_type = "ARROWS"
    obj.empty_display_size = 0.24
    obj.location = target_to_blender(target_position)
    obj.parent = parent
    ASSET_OBJECTS.append(obj)
    return obj


def loft_surface(
    name: str,
    profiles: list[tuple[float, float, float, float]],
    material: bpy.types.Material,
    *,
    segments: int = 40,
    parent: bpy.types.Object | None = None,
    relative_to: tuple[float, float, float] | None = None,
    cap_ends: bool = True,
) -> bpy.types.Object:
    """Elliptical loft profiles are (z, centerY, halfWidth, halfHeight)."""
    verts: list[tuple[float, float, float]] = []
    for z, cy, rx, ry in profiles:
        for j in range(segments):
            a = 2.0 * math.pi * j / segments
            verts.append((rx * math.sin(a), cy + ry * math.cos(a), z))
    faces: list[tuple[int, ...]] = []
    rows = len(profiles)
    for i in range(rows - 1):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            c = (i + 1) * segments + (j + 1) % segments
            d = (i + 1) * segments + j
            faces.append((a, b, c, d))
    if cap_ends:
        first = len(verts)
        z, cy, _, _ = profiles[0]
        verts.append((0.0, cy, z))
        last = len(verts)
        z, cy, _, _ = profiles[-1]
        verts.append((0.0, cy, z))
        for j in range(segments):
            faces.append((first, (j + 1) % segments, j))
            base = (rows - 1) * segments
            faces.append((last, base + j, base + (j + 1) % segments))
    if relative_to:
        px, py, pz = relative_to
        verts = [(x - px, y - py, z - pz) for x, y, z in verts]
    return mesh_object(name, verts, faces, material, parent=parent)


def interpolate_profile(profiles: list[tuple[float, float, float, float]], z: float) -> tuple[float, float, float]:
    """Interpolate center height and ellipse radii at a body station."""
    if z >= profiles[0][0]:
        _, cy, rx, ry = profiles[0]
        return cy, rx, ry
    if z <= profiles[-1][0]:
        _, cy, rx, ry = profiles[-1]
        return cy, rx, ry
    for a, b in zip(profiles, profiles[1:]):
        if a[0] >= z >= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            return tuple(a[i] + (b[i] - a[i]) * t for i in (1, 2, 3))
    raise ValueError(f"No profile interval for z={z}")


def loft_point(
    profiles: list[tuple[float, float, float, float]],
    z: float,
    theta: float,
    side: int = 1,
    offset: float = 0.0,
) -> tuple[float, float, float]:
    cy, rx, ry = interpolate_profile(profiles, z)
    return (
        side * (rx + offset) * math.sin(theta),
        cy + (ry + offset) * math.cos(theta),
        z,
    )


def loft_patch(
    name: str,
    profiles: list[tuple[float, float, float, float]],
    z0: float,
    z1: float,
    theta0: float,
    theta1: float,
    material: bpy.types.Material,
    *,
    side: int = 1,
    offset: float = 0.024,
    rows: int = 5,
    columns: int = 9,
    parent: bpy.types.Object | None = None,
    relative_to: tuple[float, float, float] | None = None,
) -> bpy.types.Object:
    verts: list[tuple[float, float, float]] = []
    for i in range(rows):
        z = z0 + (z1 - z0) * i / (rows - 1)
        for j in range(columns):
            theta = theta0 + (theta1 - theta0) * j / (columns - 1)
            verts.append(loft_point(profiles, z, theta, side, offset))
    faces = []
    for i in range(rows - 1):
        for j in range(columns - 1):
            a = i * columns + j
            faces.append((a, a + 1, a + columns + 1, a + columns))
    if relative_to:
        px, py, pz = relative_to
        verts = [(x - px, y - py, z - pz) for x, y, z in verts]
    return mesh_object(name, verts, faces, material, parent=parent)


def loft_ribbon(
    name: str,
    profiles: list[tuple[float, float, float, float]],
    z0: float,
    z1: float,
    theta0: float,
    theta1: float,
    material: bpy.types.Material,
    *,
    side: int = 1,
    offset: float = 0.032,
) -> bpy.types.Object:
    zs = [z0 + (z1 - z0) * i / 28 for i in range(29)]
    verts = []
    for z in zs:
        verts.extend([
            loft_point(profiles, z, theta0, side, offset),
            loft_point(profiles, z, theta1, side, offset),
        ])
    faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(zs) - 1)]
    return mesh_object(name, verts, faces, material)


def tube_mesh(
    name: str,
    points: list[tuple[float, float, float]],
    radius: float,
    material: bpy.types.Material,
    *,
    segments: int = 8,
    parent: bpy.types.Object | None = None,
    relative_to: tuple[float, float, float] | None = None,
    closed: bool = False,
) -> bpy.types.Object:
    points_v = [Vector(p) for p in points]
    count = len(points_v)
    ring_count = count if closed else count - 1
    verts: list[tuple[float, float, float]] = []
    for i, center in enumerate(points_v):
        if closed:
            tangent = (points_v[(i + 1) % count] - points_v[(i - 1) % count]).normalized()
        elif i == 0:
            tangent = (points_v[1] - points_v[0]).normalized()
        elif i == count - 1:
            tangent = (points_v[-1] - points_v[-2]).normalized()
        else:
            tangent = (points_v[i + 1] - points_v[i - 1]).normalized()
        reference = Vector((0.0, 1.0, 0.0))
        if abs(tangent.dot(reference)) > 0.91:
            reference = Vector((1.0, 0.0, 0.0))
        u = tangent.cross(reference).normalized()
        v = tangent.cross(u).normalized()
        for j in range(segments):
            a = 2.0 * math.pi * j / segments
            p = center + radius * (math.cos(a) * u + math.sin(a) * v)
            verts.append((p.x, p.y, p.z))
    faces = []
    for i in range(ring_count):
        ni = (i + 1) % count
        for j in range(segments):
            faces.append((i * segments + j, i * segments + (j + 1) % segments,
                          ni * segments + (j + 1) % segments, ni * segments + j))
    if not closed:
        faces.append(tuple(reversed(tuple(range(segments)))))
        faces.append(tuple((count - 1) * segments + j for j in range(segments)))
    if relative_to:
        px, py, pz = relative_to
        verts = [(x - px, y - py, z - pz) for x, y, z in verts]
    return mesh_object(name, verts, faces, material, parent=parent)


def sphere_mesh(
    name: str,
    center: tuple[float, float, float],
    scale: tuple[float, float, float],
    material: bpy.types.Material,
    *,
    segments: int = 24,
    rings: int = 12,
    parent: bpy.types.Object | None = None,
    relative_to: tuple[float, float, float] | None = None,
) -> bpy.types.Object:
    cx, cy, cz = center
    sx, sy, sz = scale
    verts = []
    for i in range(rings + 1):
        phi = math.pi * i / rings
        for j in range(segments):
            theta = 2.0 * math.pi * j / segments
            verts.append((
                cx + sx * math.sin(phi) * math.cos(theta),
                cy + sy * math.cos(phi),
                cz + sz * math.sin(phi) * math.sin(theta),
            ))
    faces = []
    for i in range(rings):
        for j in range(segments):
            a = i * segments + j
            b = i * segments + (j + 1) % segments
            c = (i + 1) * segments + (j + 1) % segments
            d = (i + 1) * segments + j
            faces.append((a, b, c, d))
    if relative_to:
        px, py, pz = relative_to
        verts = [(x - px, y - py, z - pz) for x, y, z in verts]
    return mesh_object(name, verts, faces, material, parent=parent)


def axis_cylinder(
    name: str,
    center: tuple[float, float, float],
    axis: str,
    length: float,
    radius: float,
    material: bpy.types.Material,
    *,
    segments: int = 20,
    parent: bpy.types.Object | None = None,
    relative_to: tuple[float, float, float] | None = None,
) -> bpy.types.Object:
    cx, cy, cz = center
    verts = []
    for end in (-0.5, 0.5):
        for i in range(segments):
            a = 2.0 * math.pi * i / segments
            q = radius * math.cos(a)
            r = radius * math.sin(a)
            if axis == "Y":
                verts.append((cx + q, cy + end * length, cz + r))
            elif axis == "X":
                verts.append((cx + end * length, cy + q, cz + r))
            else:
                verts.append((cx + q, cy + r, cz + end * length))
    faces = [tuple(range(segments - 1, -1, -1)), tuple(range(segments, 2 * segments))]
    for i in range(segments):
        faces.append((i, (i + 1) % segments, segments + (i + 1) % segments, segments + i))
    if relative_to:
        px, py, pz = relative_to
        verts = [(x - px, y - py, z - pz) for x, y, z in verts]
    return mesh_object(name, verts, faces, material, parent=parent, smooth=True)


def prism_along_x(
    name: str,
    outline_yz: list[tuple[float, float]],
    thickness: float,
    material: bpy.types.Material,
    *,
    center_x: float = 0.0,
) -> bpy.types.Object:
    n = len(outline_yz)
    verts = [(center_x - thickness / 2, y, z) for y, z in outline_yz]
    verts += [(center_x + thickness / 2, y, z) for y, z in outline_yz]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        faces.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
    return mesh_object(name, verts, faces, material, smooth=False)


def wing_slab(
    name: str,
    outline_xz: list[tuple[float, float]],
    center_y: float,
    thickness: float,
    material: bpy.types.Material,
) -> bpy.types.Object:
    n = len(outline_xz)
    verts = [(x, center_y - thickness / 2, z) for x, z in outline_xz]
    verts += [(x, center_y + thickness / 2, z) for x, z in outline_xz]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        faces.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
    return mesh_object(name, verts, faces, material, smooth=False)


def blade_polygon_main(angle: float, parent: bpy.types.Object, rotor_pivot: tuple[float, float, float]) -> None:
    radial = Vector((math.cos(angle), 0.0, math.sin(angle)))
    chord = Vector((-math.sin(angle), 0.0, math.cos(angle)))
    stations = [(0.30, 0.17, 0.0), (0.62, 0.20, 0.0), (2.85, 0.14, -0.035), (3.70, 0.105, -0.095), (3.94, 0.06, -0.13)]
    outline: list[Vector] = []
    for r, half_chord, sweep in stations:
        center = radial * r + chord * sweep
        outline.append(center + chord * half_chord)
    for r, half_chord, sweep in reversed(stations):
        center = radial * r + chord * sweep
        outline.append(center - chord * half_chord)
    top_y, bottom_y = 0.024, -0.024
    verts = [(v.x, top_y, v.z) for v in outline] + [(v.x, bottom_y, v.z) for v in outline]
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        faces.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
    mesh_object(f"MainRotorBlade{int(round(angle / (math.pi / 2))) + 1}", verts, faces, MATERIALS["Rotor Carbon"], parent=parent, smooth=False)
    # Small ivory tip bars are visible on the long carbon blades.
    tip_center = radial * 3.76 + chord * -0.10
    band_outline = [
        tip_center + radial * -0.055 + chord * 0.112,
        tip_center + radial * 0.055 + chord * 0.112,
        tip_center + radial * 0.055 - chord * 0.112,
        tip_center + radial * -0.055 - chord * 0.112,
    ]
    band_verts = [(v.x, 0.028, v.z) for v in band_outline]
    mesh_object(f"MainRotorTipBand{int(round(angle / (math.pi / 2))) + 1}", band_verts, [(0, 1, 2, 3)], MATERIALS["Warm Ivory"], parent=parent, smooth=False)


def blade_polygon_tail(angle: float, parent: bpy.types.Object, pivot: tuple[float, float, float]) -> None:
    # Tail rotor blades lie in the local YZ plane; their pivot spins about +X.
    radial = Vector((0.0, math.cos(angle), math.sin(angle)))
    chord = Vector((0.0, -math.sin(angle), math.cos(angle)))
    stations = [(0.08, 0.085), (0.20, 0.105), (0.42, 0.075), (0.51, 0.046)]
    outline: list[Vector] = []
    for r, half_chord in stations:
        center = radial * r
        outline.append(center + chord * half_chord)
    for r, half_chord in reversed(stations):
        center = radial * r
        outline.append(center - chord * half_chord)
    thickness = 0.018
    verts = [(thickness, v.y, v.z) for v in outline] + [(-thickness, v.y, v.z) for v in outline]
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        faces.append((i, (i + 1) % n, n + (i + 1) % n, n + i))
    mesh_object(f"TailRotorBlade{int(round(angle / (math.pi / 2))) + 1}", verts, faces, MATERIALS["Rotor Carbon"], parent=parent, smooth=False)


def add_side_door_and_windows(profiles, root, side: int) -> None:
    # Broad cabin glazing and the sliding-door frame follow the curved shell.
    window_spans = [(0.62, 0.27), (0.14, -0.20), (-0.34, -0.68), (-0.82, -1.02)]
    for i, (z0, z1) in enumerate(window_spans):
        theta0 = 0.76 if i < 3 else 0.89
        theta1 = 1.48 if i < 3 else 1.43
        loft_patch(
            f"CabinSideWindow{'Right' if side > 0 else 'Left'}{i + 1}",
            profiles, z0, z1, theta0, theta1, MATERIALS["Smoked Teal Glazing"],
            side=side, offset=0.035, rows=5, columns=8, parent=root,
        )
        # Fine enamel borders catch the warm studio light.
        for theta in (theta0, theta1):
            pts = [loft_point(profiles, z0 + (z1 - z0) * j / 10, theta, side, 0.045) for j in range(11)]
            tube_mesh(f"WindowFrame{side}_{i}_{theta:.2f}", pts, 0.018, MATERIALS["Graphite Composite"], parent=root)
    # A distinct sliding cargo door seam behind the passenger windows.
    door_top, door_bottom = 0.77, 2.28
    door_front, door_back = 0.82, -1.08
    door_points = [
        (door_front, door_top), (door_front, (door_top + door_bottom) / 2),
        (door_front, door_bottom), (0.4, door_bottom), (-0.35, door_bottom),
        (door_back, door_bottom), (door_back, 1.88), (door_back, 1.36),
        (door_back, door_top), (-0.38, door_top), (0.34, door_top),
        (door_front, door_top),
    ]
    seam = [loft_point(profiles, z, theta, side, 0.052) for z, theta in door_points]
    tube_mesh(f"SlidingDoorSeam{'R' if side > 0 else 'L'}", seam, 0.018, MATERIALS["Brushed Brass"], parent=root)
    # Recessed handle and short lower step are small but legible at gameplay scale.
    handle = [
        loft_point(profiles, -0.13, 1.34, side, 0.058),
        loft_point(profiles, -0.13, 1.50, side, 0.058),
    ]
    tube_mesh(f"DoorHandle{'R' if side > 0 else 'L'}", handle, 0.024, MATERIALS["Warm Ivory"], parent=root)
    x = side * 0.92
    tube_mesh(f"CrewStep{'R' if side > 0 else 'L'}", [
        (x, 0.62, -0.58), (x + side * 0.12, 0.48, -0.58), (x + side * 0.12, 0.48, -0.08),
    ], 0.035, MATERIALS["Brushed Brass"], parent=root)


def add_stripe_and_emblem(profiles, root, side: int) -> None:
    loft_ribbon(f"BrassCabinStripe{side}", profiles, -1.02, 2.22, 1.49, 1.56, MATERIALS["Brushed Brass"], side=side)
    loft_ribbon(f"IvoryPinstripe{side}", profiles, -0.90, 2.12, 1.40, 1.425, MATERIALS["Warm Ivory"], side=side, offset=0.04)
    # Diamond medallion: a small embossed mark along the tail end of the cabin.
    center_z, center_theta = -0.88, 1.50
    diamond = [
        (center_z + 0.16, center_theta),
        (center_z, center_theta - 0.20),
        (center_z - 0.16, center_theta),
        (center_z, center_theta + 0.20),
    ]
    verts = [loft_point(profiles, z, theta, side, 0.062) for z, theta in diamond]
    mesh_object(f"ArchiveDiamondMark{side}", verts, [(0, 1, 2, 3)], MATERIALS["Warm Ivory"], parent=root, smooth=False)
    # Recessed center creates a little depth without text or decals.
    inner = [
        (center_z + 0.075, center_theta),
        (center_z, center_theta - 0.095),
        (center_z - 0.075, center_theta),
        (center_z, center_theta + 0.095),
    ]
    verts = [loft_point(profiles, z, theta, side, 0.069) for z, theta in inner]
    mesh_object(f"ArchiveDiamondInset{side}", verts, [(0, 1, 2, 3)], MATERIALS["Brushed Brass"], parent=root, smooth=False)


def create_studio() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1050
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.world = bpy.data.worlds.new("Night Studio") if bpy.data.worlds.get("Night Studio") is None else bpy.data.worlds["Night Studio"]
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.018, 0.028, 0.03, 1.0)
    bg.inputs["Strength"].default_value = 0.45

    ground_mat = new_material("Studio Ground", (0.025, 0.035, 0.036, 1.0), metallic=0.26, roughness=0.5)
    ground_verts = [(-120, 0, -120), (120, 0, -120), (120, 0, 120), (-120, 0, 120)]
    ground = mesh_object("PreviewGround", ground_verts, [(0, 1, 2, 3)], ground_mat, smooth=False)
    ASSET_OBJECTS.remove(ground)

    def area_light(name, position, power, color, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = target_to_blender(position)
        direction = Vector(target_to_blender((0.0, 1.1, -0.1))) - obj.location
        obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    area_light("Key Softbox", (6.0, 8.5, 8.0), 1550, (1.0, 0.72, 0.48), 7.0)
    area_light("Cool Fill", (-6.5, 5.0, 1.0), 1200, (0.25, 0.62, 0.69), 6.0)
    area_light("Tail Rim", (-2.0, 7.0, -8.0), 1900, (0.86, 0.58, 0.32), 5.0)
    area_light("Top Strip", (1.0, 11.0, -1.0), 1100, (0.74, 0.88, 0.78), 5.5)

    def camera(name, position, target, ortho_scale):
        data = bpy.data.cameras.new(name)
        data.type = "ORTHO"
        data.ortho_scale = ortho_scale
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = target_to_blender(position)
        target_v = Vector(target_to_blender(target))
        obj.rotation_euler = (target_v - obj.location).to_track_quat("-Z", "Y").to_euler()
        return obj

    hero = camera("Hero Camera", (9.0, 6.1, 10.5), (0.0, 1.5, -0.35), 12.2)
    profile = camera("Profile Camera", (12.0, 5.0, 1.2), (0.0, 1.45, -0.7), 12.0)
    top = camera("Top Camera", (0.1, 15.0, -0.6), (0.0, 0.0, -0.55), 11.0)
    scene.camera = hero
    return ground, hero, profile, top


def build_asset() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    build_materials()
    root = bpy.data.objects.new("HelicopterRoot", None)
    scene.collection.objects.link(root)
    root.empty_display_type = "CIRCLE"
    root.empty_display_size = 0.34
    ASSET_OBJECTS.append(root)

    # Main body: a shaped cabin/nose with a broad shoulder and tapered aft end.
    fuselage_profiles = [
        (2.46, 1.17, 0.06, 0.08),
        (2.36, 1.20, 0.30, 0.33),
        (2.13, 1.25, 0.57, 0.51),
        (1.77, 1.31, 0.79, 0.66),
        (1.25, 1.34, 0.96, 0.75),
        (0.63, 1.35, 1.00, 0.77),
        (0.04, 1.33, 0.91, 0.72),
        (-0.55, 1.28, 0.74, 0.62),
        (-1.03, 1.20, 0.48, 0.47),
        (-1.34, 1.14, 0.19, 0.27),
        (-1.40, 1.13, 0.06, 0.14),
    ]
    loft_surface("FuselageShell", fuselage_profiles, MATERIALS["Archive Green Enamel"], segments=56, parent=root)
    # Graphite belly fairing follows the lower section of the cabin.
    loft_patch("LowerBellyFairing", fuselage_profiles, 1.45, -1.14, 2.20, 3.95, MATERIALS["Graphite Composite"], side=1, offset=0.016, rows=18, columns=22, parent=root)
    # The same belly wrap on the opposite side.
    loft_patch("LowerBellyFairingLeft", fuselage_profiles, 1.45, -1.14, 2.20, 3.95, MATERIALS["Graphite Composite"], side=-1, offset=0.016, rows=18, columns=22, parent=root)

    # Curved top/front windscreen and pilot side panes are surface-matched to the shell.
    loft_patch("ForwardCanopyGlass", fuselage_profiles, 2.28, 1.31, -1.13, 1.13, MATERIALS["Smoked Teal Glazing"], offset=0.04, rows=9, columns=19, parent=root)
    for theta in (-1.13, -0.55, 0.0, 0.55, 1.13):
        pts = [loft_point(fuselage_profiles, 2.27 - 0.96 * i / 18, theta, 1, 0.052) for i in range(19)]
        tube_mesh(f"CanopyFrame{theta:+.2f}", pts, 0.027 if theta == 0 else 0.021, MATERIALS["Graphite Composite"], parent=root)
    for side in (-1, 1):
        loft_patch(f"PilotSideGlass{side}", fuselage_profiles, 1.83, 1.24, 0.76, 1.53, MATERIALS["Smoked Teal Glazing"], side=side, offset=0.042, rows=7, columns=8, parent=root)
        for theta in (0.76, 1.53):
            pts = [loft_point(fuselage_profiles, 1.83 - 0.59 * i / 12, theta, side, 0.055) for i in range(13)]
            tube_mesh(f"PilotSideFrame{side}_{theta:.2f}", pts, 0.021, MATERIALS["Graphite Composite"], parent=root)
        add_side_door_and_windows(fuselage_profiles, root, side)
        add_stripe_and_emblem(fuselage_profiles, root, side)

    # Main sensor/search lamp and paired warm marker lamps on the sculpted nose.
    sphere_mesh("NoseSearchlightBezel", (0.0, 0.83, 2.19), (0.22, 0.13, 0.12), MATERIALS["Graphite Composite"], parent=root)
    sphere_mesh("NoseSearchlightLens", (0.0, 0.85, 2.255), (0.135, 0.075, 0.045), MATERIALS["Warm Light"], parent=root)
    for side in (-1, 1):
        sphere_mesh(f"NoseMarker{side}", (side * 0.48, 1.31, 2.14), (0.055, 0.05, 0.055), MATERIALS["Warm Ivory"], parent=root, segments=16, rings=8)

    # Long tapered boom and a modest service-fin/stabilizer assembly.
    tail_profiles = [
        (-0.94, 1.43, 0.39, 0.36),
        (-1.50, 1.47, 0.32, 0.31),
        (-2.25, 1.56, 0.25, 0.24),
        (-3.10, 1.67, 0.19, 0.20),
        (-3.95, 1.77, 0.15, 0.16),
        (-4.55, 1.83, 0.12, 0.14),
        (-4.73, 1.84, 0.08, 0.11),
    ]
    loft_surface("TaperedTailBoom", tail_profiles, MATERIALS["Archive Green Enamel"], segments=36, parent=root)
    # Raised metallic dorsal stripe makes the boom taper easy to read at distance.
    boom_line = [(0.0, interpolate_profile(tail_profiles, z)[0] + interpolate_profile(tail_profiles, z)[2] + 0.018, z) for z in (-1.1, -1.8, -2.6, -3.4, -4.2, -4.58)]
    tube_mesh("BoomDorsalPinstripe", boom_line, 0.018, MATERIALS["Brushed Brass"], parent=root)

    fin_outline = [
        (1.40, -3.87),
        (2.77, -4.42),
        (2.69, -4.91),
        (1.45, -4.45),
    ]
    prism_along_x("TailFin", fin_outline, 0.20, MATERIALS["Archive Green Enamel"])
    # Ivory/brass fin flash and a narrow trailing-edge detail.
    prism_along_x("TailFinIvoryFlash", [
        (2.22, -4.56), (2.62, -4.72), (2.59, -4.83), (2.18, -4.67),
    ], 0.212, MATERIALS["Warm Ivory"])
    tube_mesh("TailFinTrailingEdge", [
        (0.108, 1.47, -4.44), (0.108, 2.66, -4.90),
    ], 0.025, MATERIALS["Brushed Brass"], parent=root)

    wing_slab("HorizontalStabilizer", [
        (-1.18, -3.72), (-0.88, -3.96), (0.88, -3.96), (1.18, -3.72),
        (0.86, -3.28), (-0.86, -3.28),
    ], 1.47, 0.15, MATERIALS["Graphite Composite"])
    for side in (-1, 1):
        tube_mesh(f"StabilizerLeadingEdge{side}", [
            (side * 0.98, 1.49, -3.89), (side * 0.16, 1.49, -3.72),
        ], 0.022, MATERIALS["Brushed Brass"], parent=root)
    sphere_mesh("TailBeacon", (0.0, 2.72, -4.75), (0.10, 0.09, 0.11), MATERIALS["Navigation Red"], parent=root)

    # Twin compact turbine cowlings, exhausts, intakes, and a center gearbox fairing.
    for side in (-1, 1):
        engine_profiles = [
            (-1.22, 2.00, 0.11, 0.13),
            (-1.02, 2.12, 0.18, 0.22),
            (-0.58, 2.19, 0.23, 0.27),
            (-0.16, 2.18, 0.21, 0.24),
            (0.04, 2.10, 0.13, 0.16),
        ]
        shifted = [(z, cy, rx, ry) for z, cy, rx, ry in engine_profiles]
        obj = loft_surface(f"TurbineCowling{side}", shifted, MATERIALS["Graphite Composite"], segments=28, parent=root)
        # Cowling mesh is centered, then shifted laterally as one object.
        obj.location = target_to_blender((side * 0.43, 0.0, 0.0))
        for index, z in enumerate((-0.84, -0.70, -0.56, -0.42)):
            tube_mesh(f"EngineCoolingLouver{side}_{index}", [
                (side * 0.53, 2.395, z), (side * 0.65, 2.39, z + 0.018),
            ], 0.012, MATERIALS["Brushed Brass"], parent=root)
        axis_cylinder(f"EngineExhaustSleeve{side}", (side * 0.43, 2.10, -1.15), "Z", 0.22, 0.12, MATERIALS["Brushed Brass"], parent=root)
        axis_cylinder(f"EngineExhaustDark{side}", (side * 0.43, 2.10, -1.275), "Z", 0.035, 0.078, MATERIALS["Graphite Composite"], parent=root)
    sphere_mesh("GearboxFairing", (0.0, 2.21, -0.32), (0.34, 0.24, 0.52), MATERIALS["Archive Green Enamel"], parent=root)

    # A fixed mast supports the named, separately pivoted four-blade main rotor.
    axis_cylinder("MainRotorMast", (0.0, 2.40, 0.02), "Y", 0.66, 0.095, MATERIALS["Brushed Brass"], parent=root)
    axis_cylinder("MastLowerCollar", (0.0, 2.20, 0.02), "Y", 0.10, 0.16, MATERIALS["Graphite Composite"], parent=root)
    axis_cylinder("MastUpperCollar", (0.0, 2.70, 0.02), "Y", 0.10, 0.17, MATERIALS["Warm Ivory"], parent=root)
    main_pivot = (0.0, 2.80, 0.02)
    main_rotor = empty_object("MainRotor", root, main_pivot)
    main_compat = empty_object("HelicopterRotorBladeA", main_rotor)
    sphere_mesh("MainRotorHub", (0.0, 0.0, 0.0), (0.24, 0.14, 0.24), MATERIALS["Brushed Brass"], parent=main_compat)
    axis_cylinder("MainRotorHubCap", (0.0, 0.105, 0.0), "Y", 0.08, 0.12, MATERIALS["Warm Ivory"], parent=main_compat)
    for i in range(4):
        blade_polygon_main(i * math.pi / 2 + math.pi / 4, main_compat, main_pivot)
    # Counterweight and collar accents stay within the rotating assembly.
    for angle in (0.0, math.pi / 2, math.pi, 3 * math.pi / 2):
        x, z = 0.31 * math.cos(angle), 0.31 * math.sin(angle)
        axis_cylinder(f"BladeRootCollar{int(angle * 100)}", (x, 0.0, z), "Y", 0.075, 0.095, MATERIALS["Warm Ivory"], parent=main_compat)

    # Landing skids: two long oval rails, four angled supports, and cross braces.
    for side in (-1, 1):
        sx = side * 0.78
        skid_path = [
            (sx, 0.13, 1.28), (sx, 0.11, 1.04), (sx, 0.095, 0.86),
            (sx, 0.095, -1.38), (sx, 0.11, -1.63), (sx, 0.13, -1.78),
        ]
        tube_mesh(f"LandingSkidRail{side}", skid_path, 0.065, MATERIALS["Graphite Composite"], parent=root)
        # Brass end caps and fore/aft saddle braces.
        for z in (1.18, -1.65):
            tube_mesh(f"SkidEndCap{side}_{z}", [
                (sx, 0.13, z - 0.05), (sx, 0.13, z + 0.05),
            ], 0.069, MATERIALS["Brushed Brass"], parent=root)
        for z in (0.72, -0.98):
            tube_mesh(f"SkidStrut{side}_{z}", [
                (side * 0.47, 0.72, z + 0.17), (side * 0.58, 0.42, z), (sx, 0.18, z - 0.13),
            ], 0.055, MATERIALS["Warm Ivory"], parent=root)
            sphere_mesh(f"SkidSaddle{side}_{z}", (sx, 0.18, z - 0.13), (0.105, 0.07, 0.13), MATERIALS["Brushed Brass"], parent=root, segments=16, rings=8)
    tube_mesh("FrontSkidCrossBrace", [(-0.78, 0.22, 0.70), (0.0, 0.29, 0.70), (0.78, 0.22, 0.70)], 0.040, MATERIALS["Brushed Brass"], parent=root)
    tube_mesh("RearSkidCrossBrace", [(-0.78, 0.22, -1.00), (0.0, 0.29, -1.00), (0.78, 0.22, -1.00)], 0.040, MATERIALS["Brushed Brass"], parent=root)

    # Tail rotor has a distinct local +X spin axis. A stationary guard is fixed to the fin.
    tail_pivot = (0.25, 2.02, -4.42)
    tail_rotor = empty_object("TailRotor", root, tail_pivot)
    # Fixed circular guard/duct around the compact tail rotor.
    guard_points = [
        (0.23, tail_pivot[1] + 0.59 * math.cos(2 * math.pi * i / 48),
         tail_pivot[2] + 0.59 * math.sin(2 * math.pi * i / 48))
        for i in range(48)
    ]
    tube_mesh("TailRotorGuard", guard_points, 0.035, MATERIALS["Graphite Composite"], parent=root, closed=True)
    # Two hardpoints bridge the guard to the fin.
    tube_mesh("TailGuardSupportUpper", [(0.12, 2.47, -4.19), (0.23, 2.48, -4.18)], 0.042, MATERIALS["Brushed Brass"], parent=root)
    tube_mesh("TailGuardSupportLower", [(0.12, 1.57, -4.65), (0.23, 1.56, -4.66)], 0.042, MATERIALS["Brushed Brass"], parent=root)
    axis_cylinder("TailRotorHub", (0.0, 0.0, 0.0), "X", 0.28, 0.11, MATERIALS["Brushed Brass"], parent=tail_rotor)
    sphere_mesh("TailRotorHubCap", (0.16, 0.0, 0.0), (0.07, 0.13, 0.13), MATERIALS["Warm Ivory"], parent=tail_rotor)
    for i in range(4):
        blade_polygon_tail(i * math.pi / 2 + math.pi / 4, tail_rotor, tail_pivot)

    # Antennas, strobes, door fasteners, and navigation lamps.
    tube_mesh("DorsalAntenna", [(0.0, 2.07, -1.05), (0.0, 2.50, -1.18)], 0.018, MATERIALS["Brushed Brass"], parent=root)
    tube_mesh("TailAntenna", [(0.0, 1.96, -4.38), (0.0, 2.18, -4.47)], 0.015, MATERIALS["Brushed Brass"], parent=root)
    for side, material in ((-1, MATERIALS["Navigation Red"]), (1, MATERIALS["Navigation Green"])):
        sphere_mesh(f"TailNavigationLamp{side}", (side * 1.08, 1.52, -3.66), (0.08, 0.055, 0.09), material, parent=root, segments=16, rings=8)
        sphere_mesh(f"LandingLight{side}", (side * 0.76, 0.56, 1.52), (0.11, 0.075, 0.11), MATERIALS["Warm Light"], parent=root, segments=16, rings=8)
    # Small structural rivets along door sill and nose/cabin shoulder.
    for side in (-1, 1):
        for z in (0.64, 0.18, -0.28, -0.73, -1.00):
            cy, rx, ry = interpolate_profile(fuselage_profiles, z)
            sphere_mesh(
                f"DoorFastener{side}_{z:.2f}",
                (side * (rx + 0.053) * math.sin(2.19), cy + (ry + 0.053) * math.cos(2.19), z),
                (0.027, 0.027, 0.027), MATERIALS["Warm Ivory"], segments=12, rings=6, parent=root,
            )


def export_glb() -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in ASSET_OBJECTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(obj for obj in ASSET_OBJECTS if obj.name == "HelicopterRoot")
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
    )
    bpy.ops.object.select_all(action="DESELECT")


def render_previews(ground, hero, profile, top) -> None:
    scene = bpy.context.scene
    QA_DIR.mkdir(parents=True, exist_ok=True)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100
    render_jobs = [
        ("helicopter-hero.png", hero, 1600, 1050),
        ("helicopter-profile.png", profile, 1600, 1050),
        ("helicopter-top.png", top, 1450, 1000),
    ]
    for filename, camera, width, height in render_jobs:
        scene.camera = camera
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.filepath = str(QA_DIR / filename)
        bpy.ops.render.render(write_still=True)


def main() -> None:
    build_asset()
    export_glb()
    ground, hero, profile, top = create_studio()
    bpy.context.scene.camera = hero
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    render_previews(ground, hero, profile, top)
    print(f"[helicopter] wrote {GLB_PATH}")
    print(f"[helicopter] saved editable source {BLEND_PATH}")
    print(f"[helicopter] wrote previews in {QA_DIR}")


if __name__ == "__main__":
    main()
