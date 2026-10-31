#!/usr/bin/env python3
"""Build the authored Laser Heist Blender assets.

This script is intentionally self contained so the game assets can be rebuilt on
any machine with Blender installed.  It creates a small warm-dusk museum diorama
and a rigged, animated thief, then exports compact GLBs alongside their editable
Blender source files.

Coordinate contract: x is horizontal, y is up, z is depth.  The museum floor is
24m x 16m with its top surface at y=0; all playable geometry is grounded there.
"""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "heist"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# Scene and material helpers
# ---------------------------------------------------------------------------


def clear_scene() -> None:
    """Start from a genuinely empty file, including stale datablocks."""

    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
        bpy.data.actions,
    ):
        for datablock in list(collection):
            try:
                collection.remove(datablock)
            except RuntimeError:
                # A datablock can still be held by Blender's context while the
                # previous operation is unwinding.  It is harmless to leave it
                # for the current file; the next build starts cleanly anyway.
                pass


def set_world() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world.color = (0.018, 0.025, 0.05)
    world = scene.world
    if world is not None:
        world.use_nodes = True
        background = world.node_tree.nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = (0.012, 0.019, 0.04, 1.0)
            background.inputs["Strength"].default_value = 0.22


def set_input(node, name: str, value) -> None:
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    metallic: float = 0.0,
    roughness: float = 0.42,
    transmission: float = 0.0,
    alpha: float = 1.0,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        set_input(bsdf, "Base Color", color)
        set_input(bsdf, "Metallic", metallic)
        set_input(bsdf, "Roughness", roughness)
        set_input(bsdf, "Alpha", alpha)
        set_input(bsdf, "Transmission Weight", transmission)
        set_input(bsdf, "IOR", 1.45)
        if emission is not None:
            set_input(bsdf, "Emission Color", emission)
            set_input(bsdf, "Emission Strength", emission_strength)
    # Blender 4.5 replaced the old blend_method property with a render-method
    # enum.  Setting whichever one exists keeps this file usable on 4.x LTS.
    if alpha < 0.999:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
        mat.use_screen_refraction = True if hasattr(mat, "use_screen_refraction") else False
    return mat


def assign_material(obj: bpy.types.Object, mat: bpy.types.Material) -> bpy.types.Object:
    if hasattr(obj.data, "materials"):
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


def apply_bevel(obj: bpy.types.Object, amount: float, segments: int = 2) -> None:
    if amount <= 0 or not hasattr(obj.data, "polygons"):
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new(name="SoftBevel", type="BEVEL")
    modifier.width = amount
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def smooth(obj: bpy.types.Object) -> bpy.types.Object:
    if hasattr(obj.data, "polygons"):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def add_box(
    name: str,
    location: tuple[float, float, float],
    dimensions: tuple[float, float, float],
    mat: bpy.types.Material,
    bevel: float = 0.0,
    *,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    smooth_faces: bool = False,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 3 if bevel > 0.09 else 2)
    if smooth_faces:
        smooth(obj)
    return obj


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 32,
    bevel: float = 0.0,
    # Blender's primitive cylinder axis is local Z. The script's logical
    # authoring convention treats an unrotated cylinder as vertical (logical
    # Y), so this default rotates the primitive into that axis before the
    # scene-wide Blender z-up conversion.
    rotation: tuple[float, float, float] = (math.pi / 2.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 3 if bevel > 0.08 else 2)
    return obj


def add_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    segments: int = 20,
    rings: int = 12,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, mat)
    return smooth(obj)


def add_torus(
    name: str,
    location: tuple[float, float, float],
    major_radius: float,
    minor_radius: float,
    mat: bpy.types.Material,
    *,
    # Torus rims default to a horizontal ring around logical Y. Explicit
    # rotations are used for upright sculptures, helmet rings, and cuffs.
    rotation: tuple[float, float, float] = (math.pi / 2.0, 0.0, 0.0),
    major_segments: int = 32,
    minor_segments: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    return smooth(obj)


def add_cone(
    name: str,
    location: tuple[float, float, float],
    radius1: float,
    radius2: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 20,
    bevel: float = 0.0,
    rotation: tuple[float, float, float] = (math.pi / 2.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 2)
    return smooth(obj)


def add_cylinder_between(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 12,
    bevel: float = 0.0,
) -> bpy.types.Object:
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    length = direction.length
    mid = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 2)
    return obj


def add_area_light(name: str, location: tuple[float, float, float], energy: float, color, size: float = 5.0) -> bpy.types.Object:
    bpy.ops.object.light_add(type="AREA", location=location)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.color = color
    light.data.shape = "DISK"
    light.data.size = size
    return light


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def orient_scene_to_gltf_axes() -> None:
    """Convert logical x/y-up/z-depth authoring into Blender's native axes.

    Blender is z-up, while the game contract is y-up.  The glTF exporter then
    performs the inverse conversion on export.  Applying this rotation to the
    scene before saving/exporting means the editable Blender source renders
    correctly and the final GLB lands in the exact Three.js coordinates that
    the runtime expects: (x, y, z) = (horizontal, up, depth).
    """

    # Blender may defer transform evaluation after the last primitive/camera
    # operation in background mode; force a depsgraph update before taking the
    # world matrices we are about to rotate.
    bpy.context.view_layer.update()
    logical_to_blender = Matrix.Rotation(math.pi / 2.0, 4, "X")
    for obj in list(bpy.context.scene.objects):
        obj.matrix_world = logical_to_blender @ obj.matrix_world
    # Re-aim preview cameras in Blender's native z-up space after the axis
    # conversion. This keeps source renders readable while leaving exported
    # mesh coordinates governed by the same logical contract.
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        if obj.type == "CAMERA":
            point_at(obj, (0.0, 0.0, 1.0))


def add_stage_camera(location: tuple[float, float, float], target: tuple[float, float, float], lens: float = 42.0) -> bpy.types.Object:
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    camera.data.lens = lens
    point_at(camera, target)
    bpy.context.scene.camera = camera
    return camera


def export_glb(path: Path, objects: Sequence[bpy.types.Object], *, apply_modifiers: bool = True) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        if obj and obj.name in bpy.data.objects:
            obj.hide_set(False)
            obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        # Applying an Armature modifier before export is unnecessary for a
        # skinned character and can make Blender's primitive extractor sample
        # animated zero-scale bone matrices. Static architecture benefits from
        # applying its already-baked bevels, while the thief keeps its skin live.
        export_apply=apply_modifiers,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_frame_range=True,
        export_skins=True,
        export_morph=False,
        export_optimize_animation_size=True,
    )


def save_blend(path: Path) -> None:
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


# ---------------------------------------------------------------------------
# Museum
# ---------------------------------------------------------------------------


def make_museum_materials() -> dict[str, bpy.types.Material]:
    return {
        "ivory": material("IvoryTerrazzo", (0.80, 0.72, 0.60, 1.0), roughness=0.30),
        "cream": material("PaleCream", (0.96, 0.82, 0.65, 1.0), roughness=0.34),
        "brass": material("WarmBrass", (0.72, 0.33, 0.08, 1.0), metallic=0.86, roughness=0.20),
        "glass": material(
            "AquamarineGlass",
            (0.10, 0.74, 0.70, 0.38),
            metallic=0.08,
            roughness=0.12,
            transmission=0.35,
            alpha=0.38,
            emission=(0.02, 0.20, 0.21, 1.0),
            emission_strength=0.28,
        ),
        "glass_dark": material(
            "SmokedAquamarineGlass",
            (0.03, 0.26, 0.29, 0.54),
            metallic=0.15,
            roughness=0.16,
            transmission=0.18,
            alpha=0.54,
        ),
        "walnut": material("DarkWalnut", (0.10, 0.055, 0.037, 1.0), roughness=0.34),
        "terrace": material("TerraceSlate", (0.10, 0.17, 0.20, 1.0), metallic=0.10, roughness=0.26),
        "plant": material("PlantGreen", (0.07, 0.23, 0.15, 1.0), roughness=0.72),
        "pot": material("PlanterCeramic", (0.82, 0.76, 0.65, 1.0), roughness=0.25),
        "black": material("ArchitecturalBlack", (0.018, 0.025, 0.028, 1.0), metallic=0.16, roughness=0.28),
        "warm_light": material(
            "WarmLight",
            (1.0, 0.35, 0.08, 1.0),
            metallic=0.05,
            roughness=0.28,
            emission=(1.0, 0.18, 0.03, 1.0),
            emission_strength=4.0,
        ),
    }


def add_planter(name: str, x: float, z: float, mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    objects: list[bpy.types.Object] = []
    objects.append(add_cylinder(f"{name}_Pot", (x, 0.34, z), 0.46, 0.68, mats["pot"], vertices=20, bevel=0.05))
    objects.append(add_torus(f"{name}_Rim", (x, 0.69, z), 0.39, 0.045, mats["brass"], major_segments=24, minor_segments=6))
    objects.append(add_sphere(f"{name}_Foliage", (x, 1.03, z), (0.40, 0.52, 0.40), mats["plant"], segments=16, rings=10))
    objects.append(add_cone(f"{name}_LeafTop", (x + 0.08, 1.40, z), 0.26, 0.04, 0.72, mats["plant"], vertices=12, bevel=0.025))
    return objects


def add_sculpture(name: str, x: float, z: float, mats: dict[str, bpy.types.Material], flip: bool = False) -> list[bpy.types.Object]:
    objects: list[bpy.types.Object] = []
    objects.append(add_cylinder(f"{name}_Pedestal", (x, 0.42, z), 0.62, 0.84, mats["walnut"], vertices=12, bevel=0.06))
    objects.append(add_cylinder(f"{name}_Cap", (x, 0.88, z), 0.46, 0.10, mats["brass"], vertices=24, bevel=0.025))
    # A pair of offset loops gives the miniature museum its signature sculptural
    # silhouette without putting a collision-sized object in the playable lanes.
    rot_a = (math.pi / 2, 0.10 if not flip else -0.10, 0.0)
    rot_b = (math.pi / 2, -0.36 if not flip else 0.36, 0.0)
    objects.append(add_torus(f"{name}_LoopA", (x, 1.42, z), 0.43, 0.105, mats["brass"], rotation=rot_a, major_segments=24, minor_segments=8))
    objects.append(add_torus(f"{name}_LoopB", (x + (0.14 if not flip else -0.14), 1.47, z), 0.35, 0.075, mats["cream"], rotation=rot_b, major_segments=24, minor_segments=8))
    return objects


def build_museum() -> list[bpy.types.Object]:
    clear_scene()
    set_world()
    mats = make_museum_materials()
    assets: list[bpy.types.Object] = []

    def keep(obj: bpy.types.Object) -> bpy.types.Object:
        assets.append(obj)
        return obj

    # Ground floor: top face is exactly y=0, leaving a simple, stable collision
    # plane for the runtime.  Thin brass inlays sell the terrazzo without adding
    # meaningful navigation geometry.
    keep(add_box("Floor", (0.0, -0.09, 0.0), (24.0, 0.18, 16.0), mats["ivory"], bevel=0.08))
    for x in (-10.0, -4.0, 2.0, 8.0):
        keep(add_box(f"FloorInlay_X_{x:g}", (x, 0.012, 0.0), (0.025, 0.018, 15.0), mats["brass"]))
    for z in (-4.0, 4.0):
        keep(add_box(f"FloorInlay_Z_{z:g}", (0.0, 0.014, z), (23.0, 0.018, 0.025), mats["brass"]))

    # Dusk windows and their brass mullions form the rear architectural read.
    keep(add_box("BackWindowWall", (0.0, 2.80, -7.90), (22.65, 5.35, 0.14), mats["glass_dark"], bevel=0.03))
    for index, x in enumerate((-10.8, -7.2, -3.6, 0.0, 3.6, 7.2, 10.8)):
        keep(add_box(f"BackWindowMullion_{index:02d}", (x, 2.82, -7.78), (0.085, 5.55, 0.18), mats["brass"], bevel=0.018))
    keep(add_box("BackWindowSill", (0.0, 0.35, -7.72), (22.6, 0.16, 0.42), mats["cream"], bevel=0.04))
    keep(add_box("BackWindowHeader", (0.0, 5.56, -7.78), (22.7, 0.18, 0.24), mats["brass"], bevel=0.03))

    # Perimeter low glass rail; the center lanes remain open and readable.
    for z, label in ((-7.40, "Back"), (7.40, "Front")):
        keep(add_box(f"PerimeterRail_{label}_Glass", (0.0, 0.65, z), (22.65, 1.16, 0.075), mats["glass"], bevel=0.025))
        for index, x in enumerate((-11.3, -7.5, -3.7, 0.1, 3.9, 7.7, 11.3)):
            keep(add_cylinder(f"PerimeterRail_{label}_Post_{index:02d}", (x, 0.68, z), 0.055, 1.35, mats["brass"], vertices=12, bevel=0.015))
    for x, label in ((-11.40, "Left"), (11.40, "Right")):
        keep(add_box(f"PerimeterRail_{label}_Glass", (x, 0.65, 0.0), (0.075, 1.16, 14.7), mats["glass"], bevel=0.025))
        for index, z in enumerate((-6.9, -3.45, 0.0, 3.45, 6.9)):
            keep(add_cylinder(f"PerimeterRail_{label}_Post_{index:02d}", (x, 0.68, z), 0.055, 1.35, mats["brass"], vertices=12, bevel=0.015))

    # Columns are kept to the perimeter and support the upper-gallery read.
    for index, x in enumerate((-11.0, -7.0, -3.0, 1.0, 5.0, 9.0, 11.0)):
        keep(add_cylinder(f"BackColumn_{index:02d}", (x, 1.80, -7.35), 0.18, 3.60, mats["ivory"], vertices=16, bevel=0.035))
        keep(add_torus(f"BackColumnRing_{index:02d}", (x, 3.42, -7.35), 0.20, 0.035, mats["brass"], major_segments=20, minor_segments=6))
    for index, x in enumerate((-11.0, 11.0)):
        for z in (-6.0, 0.0, 6.0):
            keep(add_cylinder(f"SideColumn_{index}_{z:g}", (x, 1.72, z), 0.20, 3.44, mats["ivory"], vertices=16, bevel=0.035))

    # Security partition at x=-4.0.  It deliberately leaves the z[-2,2] opening
    # clear; there is no door leaf or animated barrier baked into this asset.
    for z, side in ((-5.0, "South"), (5.0, "North")):
        keep(add_box(f"SecurityPartition_{side}_Glass", (-4.0, 1.45, z), (0.14, 2.90, 6.0), mats["glass"], bevel=0.035))
        for local_index, z_post in enumerate((z - 3.0, z + 3.0)):
            keep(add_cylinder(f"SecurityPartition_{side}_Post_{local_index}", (-4.0, 1.48, z_post), 0.095, 3.05, mats["brass"], vertices=12, bevel=0.025))
        keep(add_box(f"SecurityPartition_{side}_Header", (-4.0, 2.95, z), (0.20, 0.17, 6.0), mats["brass"], bevel=0.025))
    for z in (-2.0, 2.0):
        keep(add_cylinder(f"SecurityOpeningPost_{z:g}", (-4.0, 1.48, z), 0.095, 3.05, mats["brass"], vertices=12, bevel=0.025))
    keep(add_box("SecurityOpeningHeader", (-4.0, 2.95, 0.0), (0.20, 0.17, 4.0), mats["brass"], bevel=0.025))

    # Upper mezzanine / second-floor silhouette: decorative and non-playable,
    # raised well above y=0 so all gameplay remains on the flat ground floor.
    keep(add_box("UpperGalleryDeck", (4.3, 3.62, -5.80), (14.5, 0.20, 3.05), mats["cream"], bevel=0.08))
    keep(add_box("UpperGalleryFrontGlass", (4.3, 4.20, -4.32), (14.2, 1.04, 0.075), mats["glass"], bevel=0.025))
    for index, x in enumerate((-2.4, 1.2, 4.8, 8.4, 10.8)):
        keep(add_cylinder(f"UpperGalleryPost_{index:02d}", (x, 4.23, -4.32), 0.05, 1.16, mats["brass"], vertices=12, bevel=0.015))
    keep(add_box("UpperGalleryBackTrim", (4.3, 4.02, -7.22), (14.4, 0.14, 0.18), mats["brass"], bevel=0.025))
    # Three small display steps suggest stairs without occupying the ground-floor
    # middle lanes used by the game.
    for index in range(4):
        keep(add_box(f"UpperGalleryStep_{index:02d}", (-7.5 + index * 0.48, 0.10 + index * 0.10, -5.25 - index * 0.22), (0.48, 0.20 + index * 0.20, 1.12), mats["ivory"], bevel=0.045))
    keep(add_box("UpperSkylight", (4.0, 5.36, -6.95), (7.4, 0.12, 0.12), mats["glass"], bevel=0.02))

    # Sculptures and planters stay near the z±6 perimeter, leaving the central
    # route and the extraction line visually clean.
    for name, x, z, flip in (
        ("SculptureWest", -7.2, -5.95, False),
        ("SculptureEast", 7.5, -5.95, True),
        ("SculptureNorth", 0.0, 5.95, False),
    ):
        for obj in add_sculpture(name, x, z, mats, flip):
            keep(obj)
    for name, x, z in (
        ("PlanterWest", -10.25, -6.35),
        ("PlanterNorthWest", -10.25, 6.35),
        ("PlanterNorthEast", 10.25, 6.35),
        ("PlanterSouthEast", 10.25, -6.35),
    ):
        for obj in add_planter(name, x, z, mats):
            keep(obj)

    # The central base has its top face at y=.80 exactly.  The gem and any
    # animated case/laser effects are runtime content and are intentionally not
    # part of this GLB.
    keep(add_cylinder("CentralDisplayBase", (5.0, 0.26, 0.0), 1.28, 0.52, mats["walnut"], vertices=32, bevel=0.08))
    keep(add_cylinder("CentralDisplayBrassPlinth", (5.0, 0.59, 0.0), 1.06, 0.14, mats["brass"], vertices=32, bevel=0.035))
    keep(add_cylinder("CentralDisplayTop", (5.0, 0.75, 0.0), 0.82, 0.10, mats["cream"], vertices=32, bevel=0.03))
    keep(add_torus("CentralDisplayTopRing", (5.0, 0.82, 0.0), 0.82, 0.045, mats["brass"], major_segments=32, minor_segments=8))
    for index, angle in enumerate((0.0, math.pi / 2, math.pi, 3 * math.pi / 2)):
        keep(add_cylinder(f"CentralDisplayFramePost_{index}", (5.0 + math.cos(angle) * 0.80, 1.32, math.sin(angle) * 0.80), 0.032, 1.0, mats["brass"], vertices=10, bevel=0.01))

    # Extraction terrace inside the same floor, visually distinct but kept low.
    keep(add_cylinder("ExtractionTerracePad", (10.0, 0.07, -5.0), 1.38, 0.14, mats["terrace"], vertices=8, bevel=0.055))
    keep(add_torus("ExtractionTerraceBrassRing", (10.0, 0.16, -5.0), 1.18, 0.055, mats["brass"], major_segments=32, minor_segments=8))
    keep(add_torus("ExtractionTerraceInnerRing", (10.0, 0.17, -5.0), 0.70, 0.025, mats["glass"], major_segments=28, minor_segments=6))
    for index, angle in enumerate((0.0, math.pi / 2, math.pi, 3 * math.pi / 2)):
        keep(add_cylinder(f"ExtractionTerracePost_{index}", (10.0 + math.cos(angle) * 1.08, 0.70, -5.0 + math.sin(angle) * 1.08), 0.04, 1.2, mats["brass"], vertices=10, bevel=0.012))

    # Low luminous architectural strips create the warm dusk accent.
    for x, z, dims in (
        (-10.9, -7.54, (3.2, 0.035, 0.04)),
        (4.0, -7.54, (5.2, 0.035, 0.04)),
        (8.3, 4.35, (3.6, 0.035, 0.04)),
    ):
        keep(add_box("WarmArchitecturalStrip", (x, 0.045, z), dims, mats["warm_light"], bevel=0.01))

    # Warm stage lighting is saved in the .blend for art direction but excluded
    # from the GLB.  It also makes quick human inspection pleasant.
    key = add_area_light("DuskKey", (1.0, 10.0, 6.0), 1250.0, (1.0, 0.34, 0.18), 7.0)
    point_at(key, (0.0, 0.0, 0.0))
    fill = add_area_light("AquamarineFill", (-7.0, 5.0, -3.0), 900.0, (0.05, 0.65, 0.68), 5.0)
    point_at(fill, (0.0, 1.0, -2.0))
    rim = add_area_light("WindowRim", (8.0, 3.2, -6.0), 850.0, (1.0, 0.22, 0.08), 4.0)
    point_at(rim, (3.0, 1.0, -1.0))
    camera = add_stage_camera((18.0, 15.0, 19.0), (0.0, 1.0, 0.0), 44.0)
    camera.data.dof.use_dof = False

    # Only the geometry list is exported; stage camera and lights remain in the
    # editable source for a readable art-direction file.
    return assets


# ---------------------------------------------------------------------------
# Rigged thief
# ---------------------------------------------------------------------------


def make_thief_materials() -> dict[str, bpy.types.Material]:
    return {
        "suit": material("JumpsuitBlack", (0.012, 0.016, 0.020, 1.0), metallic=0.08, roughness=0.33),
        "helmet": material("HelmetBlack", (0.008, 0.011, 0.016, 1.0), metallic=0.12, roughness=0.24),
        "accent": material(
            "Accent",
            (0.04, 0.68, 0.72, 1.0),
            metallic=0.18,
            roughness=0.22,
            emission=(0.01, 0.20, 0.22, 1.0),
            emission_strength=0.45,
        ),
        "ivory": material("MaskIvory", (0.92, 0.74, 0.55, 1.0), roughness=0.30),
        "eye": material("EyeBlack", (0.002, 0.004, 0.006, 1.0), metallic=0.0, roughness=0.18),
        "visor": material("VisorAquamarine", (0.02, 0.24, 0.28, 0.80), metallic=0.16, roughness=0.10, transmission=0.18, alpha=0.80),
        "backpack": material("BackpackBlack", (0.028, 0.035, 0.042, 1.0), metallic=0.12, roughness=0.30),
        "sole": material("BootRubber", (0.018, 0.023, 0.028, 1.0), roughness=0.45),
    }


def create_thief_armature() -> bpy.types.Object:
    arm_data = bpy.data.armatures.new("ThiefRig")
    arm = bpy.data.objects.new("Thief", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    definitions = [
        ("root", (0.0, 0.0, 0.0), (0.0, 0.16, 0.0), None),
        ("pelvis", (0.0, 0.16, 0.0), (0.0, 0.50, 0.0), "root"),
        ("spine", (0.0, 0.50, 0.0), (0.0, 0.83, 0.0), "pelvis"),
        ("chest", (0.0, 0.83, 0.0), (0.0, 1.08, 0.0), "spine"),
        ("neck", (0.0, 1.08, 0.0), (0.0, 1.17, 0.0), "chest"),
        ("head", (0.0, 1.17, 0.0), (0.0, 1.38, 0.0), "neck"),
        ("upper_arm.L", (-0.23, 0.96, 0.0), (-0.46, 0.79, 0.0), "chest"),
        ("forearm.L", (-0.46, 0.79, 0.0), (-0.56, 0.62, 0.0), "upper_arm.L"),
        ("hand.L", (-0.56, 0.62, 0.0), (-0.59, 0.56, -0.01), "forearm.L"),
        ("upper_arm.R", (0.23, 0.96, 0.0), (0.46, 0.79, 0.0), "chest"),
        ("forearm.R", (0.46, 0.79, 0.0), (0.56, 0.62, 0.0), "upper_arm.R"),
        ("hand.R", (0.56, 0.62, 0.0), (0.59, 0.56, -0.01), "forearm.R"),
        ("thigh.L", (-0.15, 0.48, 0.0), (-0.17, 0.23, 0.0), "pelvis"),
        ("shin.L", (-0.17, 0.23, 0.0), (-0.17, 0.055, 0.0), "thigh.L"),
        ("foot.L", (-0.17, 0.07, -0.02), (-0.17, 0.035, -0.22), "shin.L"),
        ("thigh.R", (0.15, 0.48, 0.0), (0.17, 0.23, 0.0), "pelvis"),
        ("shin.R", (0.17, 0.23, 0.0), (0.17, 0.055, 0.0), "thigh.R"),
        ("foot.R", (0.17, 0.07, -0.02), (0.17, 0.035, -0.22), "shin.R"),
    ]
    edit_bones: dict[str, bpy.types.EditBone] = {}
    for name, head, tail, parent in definitions:
        bone = arm_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        if parent:
            bone.parent = edit_bones[parent]
            bone.use_connect = False
        edit_bones[name] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.rotation_mode = "XYZ"
    return arm


def skin_object(obj: bpy.types.Object, arm: bpy.types.Object, bone_name: str) -> bpy.types.Object:
    if not hasattr(obj.data, "vertices"):
        return obj
    group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    group.add([vertex.index for vertex in obj.data.vertices], 1.0, "REPLACE")
    modifier = obj.modifiers.new(name="ThiefArmature", type="ARMATURE")
    modifier.object = arm
    # glTF's skin exporter expects the skinned mesh to be parented to the
    # armature object. Preserve its world transform while adding that parent.
    if obj.parent is None:
        world_matrix = obj.matrix_world.copy()
        obj.parent = arm
        obj.matrix_world = world_matrix
    return obj


def capsule_piece(
    name: str,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    radius: float,
    mat: bpy.types.Material,
    arm: bpy.types.Object,
    bone: str,
) -> list[bpy.types.Object]:
    objects = [add_cylinder_between(name, start, end, radius, mat, vertices=12, bevel=min(radius * 0.55, 0.055))]
    objects.append(add_sphere(f"{name}_CapA", start, (radius, radius, radius), mat, segments=12, rings=8))
    objects.append(add_sphere(f"{name}_CapB", end, (radius, radius, radius), mat, segments=12, rings=8))
    for obj in objects:
        skin_object(obj, arm, bone)
    return objects


def make_thief_actions(arm: bpy.types.Object) -> list[bpy.types.Action]:
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 41
    animation_bones = [bone.name for bone in arm.pose.bones]

    def clear_pose() -> None:
        for pose_bone in arm.pose.bones:
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = (0.0, 0.0, 0.0)
            pose_bone.location = (0.0, 0.0, 0.0)

    def write_keyframes(action: bpy.types.Action, frames: Iterable[int], values_fn) -> None:
        arm.animation_data_create()
        arm.animation_data.action = action
        clear_pose()
        for frame in frames:
            scene.frame_set(frame)
            values_fn(frame)
            for bone_name in animation_bones:
                pose_bone = arm.pose.bones[bone_name]
                pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
                pose_bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)
        # Keyframes on a stylized character look best with gentle spline motion;
        # the runtime can still sample these clips at arbitrary rates.
        for curve in action.fcurves:
            for keyframe in curve.keyframe_points:
                keyframe.interpolation = "BEZIER"

    idle = bpy.data.actions.new("Idle")
    idle.use_fake_user = True

    def idle_pose(frame: int) -> None:
        t = (frame - 1) / 20.0
        sway = math.sin(t * math.pi * 2.0) * 0.025
        bob = math.sin(t * math.pi * 2.0) * 0.010
        arm.pose.bones["root"].location.y = bob
        arm.pose.bones["spine"].rotation_euler[2] = sway
        arm.pose.bones["head"].rotation_euler[2] = -sway * 0.65
        arm.pose.bones["upper_arm.L"].rotation_euler[0] = -0.055 + sway
        arm.pose.bones["upper_arm.R"].rotation_euler[0] = 0.055 - sway
        arm.pose.bones["forearm.L"].rotation_euler[0] = -0.08
        arm.pose.bones["forearm.R"].rotation_euler[0] = 0.08

    write_keyframes(idle, (1, 21, 41), idle_pose)

    walk = bpy.data.actions.new("Walk")
    walk.use_fake_user = True

    def walk_pose(frame: int) -> None:
        phase = (frame - 1) / 10.0 * math.pi
        swing = math.sin(phase) * 0.52
        opposite = -swing
        arm.pose.bones["root"].location.y = max(0.0, math.sin(phase * 2.0)) * 0.035
        arm.pose.bones["spine"].rotation_euler[2] = math.sin(phase) * 0.035
        arm.pose.bones["head"].rotation_euler[2] = -math.sin(phase) * 0.025
        arm.pose.bones["thigh.L"].rotation_euler[0] = swing
        arm.pose.bones["shin.L"].rotation_euler[0] = -max(0.0, swing) * 0.38
        arm.pose.bones["foot.L"].rotation_euler[0] = -swing * 0.22
        arm.pose.bones["thigh.R"].rotation_euler[0] = opposite
        arm.pose.bones["shin.R"].rotation_euler[0] = -max(0.0, opposite) * 0.38
        arm.pose.bones["foot.R"].rotation_euler[0] = -opposite * 0.22
        arm.pose.bones["upper_arm.L"].rotation_euler[0] = opposite * 0.72
        arm.pose.bones["forearm.L"].rotation_euler[0] = opposite * 0.18
        arm.pose.bones["upper_arm.R"].rotation_euler[0] = swing * 0.72
        arm.pose.bones["forearm.R"].rotation_euler[0] = swing * 0.18

    write_keyframes(walk, (1, 11, 21, 31, 41), walk_pose)
    arm.animation_data.action = idle
    scene.frame_set(1)
    return [idle, walk]


def build_thief() -> tuple[list[bpy.types.Object], bpy.types.Object]:
    clear_scene()
    set_world()
    mats = make_thief_materials()
    arm = create_thief_armature()
    assets: list[bpy.types.Object] = [arm]

    def keep(obj: bpy.types.Object, bone: str) -> bpy.types.Object:
        skin_object(obj, arm, bone)
        assets.append(obj)
        return obj

    # Rounded black body and oversized helmet.
    keep(add_box("Torso", (0.0, 0.72, 0.0), (0.54, 0.58, 0.38), mats["suit"], bevel=0.16, smooth_faces=True), "spine")
    keep(add_sphere("Pelvis", (0.0, 0.48, 0.0), (0.29, 0.20, 0.22), mats["suit"], segments=16, rings=10), "pelvis")
    keep(add_sphere("Helmet", (0.0, 1.27, 0.0), (0.39, 0.34, 0.36), mats["helmet"], segments=20, rings=12), "head")
    keep(add_torus("HelmetAccentRing", (0.0, 1.29, -0.13), 0.285, 0.035, mats["accent"], rotation=(0.0, 0.0, 0.0), major_segments=28, minor_segments=8), "head")
    keep(add_box("ChestAccent", (0.0, 0.79, -0.205), (0.29, 0.18, 0.035), mats["accent"], bevel=0.025), "chest")
    keep(add_box("BeltAccent", (0.0, 0.56, -0.20), (0.38, 0.07, 0.035), mats["accent"], bevel=0.018), "pelvis")

    # The exposed eye shapes face -z, matching the museum's readable camera
    # direction.  They are separate meshes so their silhouette stays crisp.
    for side, x in (("L", -0.13), ("R", 0.13)):
        keep(add_sphere(f"EyeWhite_{side}", (x, 1.30, -0.326), (0.105, 0.115, 0.038), mats["ivory"], segments=16, rings=10), "head")
        keep(add_sphere(f"EyePupil_{side}", (x, 1.30, -0.361), (0.047, 0.060, 0.016), mats["eye"], segments=12, rings=8), "head")
    keep(add_box("VisorBridge", (0.0, 1.18, -0.315), (0.30, 0.075, 0.035), mats["visor"], bevel=0.025), "head")

    # Backpack and harness, kept separate from the torso to make the profile
    # readable when the character is turned in the 3D view.
    keep(add_box("Backpack", (0.0, 0.77, 0.28), (0.37, 0.44, 0.18), mats["backpack"], bevel=0.075), "spine")
    keep(add_box("BackpackAccent", (0.0, 0.78, 0.385), (0.19, 0.25, 0.028), mats["accent"], bevel=0.018), "spine")
    for x in (-0.20, 0.20):
        keep(add_box(f"Harness_{x:g}", (x, 0.82, 0.10), (0.045, 0.43, 0.045), mats["accent"], bevel=0.012, rotation=(0.0, 0.0, x * 0.30)), "chest")

    # Limbs are capsule-like articulated pieces with one-bone weights.  This is
    # intentionally low-poly and tiny enough for quick multiplayer loading.
    for side, sign in (("L", -1.0), ("R", 1.0)):
        upper = capsule_piece(
            f"UpperArm_{side}",
            (sign * 0.24, 0.95, 0.0),
            (sign * 0.45, 0.79, 0.0),
            0.105,
            mats["suit"],
            arm,
            f"upper_arm.{side}",
        )
        lower = capsule_piece(
            f"Forearm_{side}",
            (sign * 0.45, 0.79, 0.0),
            (sign * 0.56, 0.62, 0.0),
            0.092,
            mats["suit"],
            arm,
            f"forearm.{side}",
        )
        hand = keep(add_sphere(f"Glove_{side}", (sign * 0.58, 0.57, -0.01), (0.11, 0.10, 0.10), mats["accent"], segments=12, rings=8), f"hand.{side}")
        # Add a small cuff accent to each arm.
        keep(add_torus(f"Cuff_{side}", (sign * 0.47, 0.75, 0.0), 0.098, 0.018, mats["accent"], rotation=(0.0, math.pi / 2, 0.0), major_segments=16, minor_segments=6), f"forearm.{side}")
        assets.extend(upper)
        assets.extend(lower)

        thigh = capsule_piece(
            f"Thigh_{side}",
            (sign * 0.15, 0.46, 0.0),
            (sign * 0.17, 0.23, 0.0),
            0.125,
            mats["suit"],
            arm,
            f"thigh.{side}",
        )
        shin = capsule_piece(
            f"Shin_{side}",
            (sign * 0.17, 0.23, 0.0),
            (sign * 0.17, 0.055, 0.0),
            0.105,
            mats["suit"],
            arm,
            f"shin.{side}",
        )
        assets.extend(thigh)
        assets.extend(shin)
        keep(add_box(f"Boot_{side}", (sign * 0.17, 0.075, -0.105), (0.22, 0.13, 0.34), mats["sole"], bevel=0.065, rotation=(0.0, 0.0, sign * 0.04)), f"foot.{side}")
        keep(add_box(f"BootAccent_{side}", (sign * 0.17, 0.13, -0.275), (0.18, 0.04, 0.035), mats["accent"], bevel=0.012), f"foot.{side}")

    # A small floating light on the backpack is an art-direction detail, not a
    # gameplay indicator; it follows the spine with the rest of the pack.
    keep(add_sphere("BackpackBeacon", (0.0, 0.82, 0.405), (0.045, 0.045, 0.025), mats["accent"], segments=12, rings=8), "spine")

    actions = make_thief_actions(arm)

    # Stage setup for inspecting the source file.  These objects are excluded
    # from the export selection.
    key = add_area_light("ThiefKey", (2.5, 5.0, 4.0), 550.0, (1.0, 0.36, 0.18), 3.0)
    point_at(key, (0.0, 0.8, 0.0))
    fill = add_area_light("ThiefFill", (-2.0, 3.0, -3.0), 400.0, (0.05, 0.68, 0.70), 2.5)
    point_at(fill, (0.0, 0.8, 0.0))
    add_box("PreviewGround", (0.0, -0.07, 0.0), (2.8, 0.14, 2.8), make_museum_materials()["terrace"], bevel=0.06)
    # Front-facing source preview (logical -z is the thief's face direction).
    add_stage_camera((2.7, 2.15, -3.0), (0.0, 0.75, 0.0), 52.0)
    return assets, arm


# ---------------------------------------------------------------------------
# Optional helicopter asset
# ---------------------------------------------------------------------------


def build_helicopter() -> list[bpy.types.Object]:
    clear_scene()
    set_world()
    dark = material("HelicopterBlack", (0.018, 0.022, 0.028, 1.0), metallic=0.25, roughness=0.22)
    glass = material("HelicopterGlass", (0.06, 0.48, 0.50, 0.52), metallic=0.10, roughness=0.10, transmission=0.24, alpha=0.52)
    brass = material("RotorBrass", (0.72, 0.30, 0.06, 1.0), metallic=0.82, roughness=0.18)
    accent = material("Accent", (0.05, 0.68, 0.72, 1.0), metallic=0.16, roughness=0.22, emission=(0.02, 0.22, 0.24, 1.0), emission_strength=0.4)
    objects: list[bpy.types.Object] = []
    objects.append(add_box("HelicopterBody", (0.0, 0.68, 0.0), (2.8, 0.86, 1.05), dark, bevel=0.32, smooth_faces=True))
    objects.append(add_sphere("HelicopterCockpit", (0.0, 0.82, -0.55), (1.0, 0.52, 0.40), glass, segments=20, rings=12))
    objects.append(add_box("HelicopterTail", (0.0, 0.83, 1.65), (0.34, 0.34, 2.25), dark, bevel=0.12, rotation=(math.radians(-4.0), 0.0, 0.0)))
    objects.append(add_cylinder_between("HelicopterTailBoom", (0.0, 0.72, 0.54), (0.0, 0.83, 1.70), 0.16, dark, vertices=12, bevel=0.05))
    objects.append(add_cylinder("HelicopterRotorMast", (0.0, 1.30, 0.05), 0.09, 0.65, brass, vertices=12, bevel=0.02))
    objects.append(add_box("HelicopterRotorBladeA", (0.0, 1.65, 0.05), (3.8, 0.06, 0.12), brass, bevel=0.025))
    objects.append(add_box("HelicopterRotorBladeB", (0.0, 1.65, 0.05), (0.12, 0.06, 3.8), brass, bevel=0.025))
    objects.append(add_cylinder("HelicopterTailRotorHub", (0.22, 0.86, 1.88), 0.08, 0.15, brass, vertices=12, bevel=0.02, rotation=(0.0, math.pi / 2, 0.0)))
    objects.append(add_box("HelicopterTailRotorA", (0.22, 0.86, 1.88), (0.04, 0.70, 0.10), accent, bevel=0.02))
    objects.append(add_box("HelicopterTailRotorB", (0.22, 0.86, 1.88), (0.04, 0.10, 0.70), accent, bevel=0.02))
    for x in (-0.84, 0.84):
        objects.append(add_cylinder_between(f"HelicopterSkidPost_{x:g}", (x, 0.40, -0.15), (x, 0.18, 0.20), 0.055, brass, vertices=10, bevel=0.015))
        objects.append(add_cylinder_between(f"HelicopterSkid_{x:g}", (x, 0.16, -0.45), (x, 0.16, 0.55), 0.05, brass, vertices=10, bevel=0.015))
    key = add_area_light("HelicopterKey", (2.5, 5.0, 3.0), 450.0, (1.0, 0.34, 0.16), 3.0)
    point_at(key, (0.0, 0.5, 0.0))
    add_stage_camera((4.2, 2.7, 4.6), (0.0, 0.7, 0.5), 52.0)
    return objects


def main() -> None:
    # Build each source and export immediately so Blender's current scene never
    # accidentally leaks into a different asset's GLB selection.
    museum = build_museum()
    orient_scene_to_gltf_axes()
    save_blend(OUT_DIR / "museum.blend")
    export_glb(OUT_DIR / "museum.glb", museum)

    thief, _arm = build_thief()
    orient_scene_to_gltf_axes()
    save_blend(OUT_DIR / "thief.blend")
    export_glb(OUT_DIR / "thief.glb", thief, apply_modifiers=False)

    helicopter = build_helicopter()
    orient_scene_to_gltf_axes()
    save_blend(OUT_DIR / "helicopter.blend")
    export_glb(OUT_DIR / "helicopter.glb", helicopter)

    # Leave the final source scene on the optional helicopter for a quick visual
    # inspection if the script was launched interactively.
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_DIR / "helicopter.blend"))
    print(f"[heist-assets] wrote {OUT_DIR}")


if __name__ == "__main__":
    main()

