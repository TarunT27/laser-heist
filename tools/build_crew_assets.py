#!/usr/bin/env python3
"""Author and export the reusable Laser Heist human crew character.

The authoring coordinates in this file are logical game coordinates (x across,
y up, z depth). Blender itself is z-up, so the whole scene receives the same
90-degree X conversion used by the existing heist assets before the GLB export.
The character's face is at +z in the exported GLTF, and the armature root is at
the soles (y=0).
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Iterable, Sequence

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
GLB_PATH = ROOT / "public" / "heist" / "crew.glb"
BLEND_PATH = ROOT / "art" / "crew.blend"
README_PATH = ROOT / "public" / "heist" / "crew_README.md"
GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)


def clear_scene() -> None:
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.armatures, bpy.data.actions):
        for datablock in list(collection):
            try:
                collection.remove(datablock)
            except RuntimeError:
                pass


def set_input(node, name: str, value) -> None:
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    *,
    roughness: float = 0.42,
    metallic: float = 0.0,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = color
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        set_input(bsdf, "Base Color", color)
        set_input(bsdf, "Roughness", roughness)
        set_input(bsdf, "Metallic", metallic)
        if emission is not None:
            set_input(bsdf, "Emission Color", emission)
            set_input(bsdf, "Emission Strength", emission_strength)
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
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 3 if bevel >= 0.07 else 2)
    return obj


def add_cylinder(
    name: str,
    location: tuple[float, float, float],
    radius: float,
    depth: float,
    mat: bpy.types.Material,
    *,
    vertices: int = 16,
    bevel: float = 0.0,
    rotation: tuple[float, float, float] = (math.pi / 2.0, 0.0, 0.0),
) -> bpy.types.Object:
    # Primitive cylinders are local-Z in Blender; logical Y-up is local-Y
    # before the scene-wide Blender-axis conversion.
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 3 if bevel >= 0.06 else 2)
    return obj


def add_sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    segments: int = 16,
    rings: int = 10,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location, rotation=rotation)
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
    rotation: tuple[float, float, float] = (math.pi / 2.0, 0.0, 0.0),
    major_segments: int = 24,
    minor_segments: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius, major_segments=major_segments, minor_segments=minor_segments, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
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
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=direction.length, location=(start_v + end_v) * 0.5)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    assign_material(obj, mat)
    apply_bevel(obj, bevel, 2)
    return obj


def add_capsule(name: str, start: tuple[float, float, float], end: tuple[float, float, float], radius: float, mat: bpy.types.Material) -> list[bpy.types.Object]:
    return [
        add_cylinder_between(name, start, end, radius, mat, vertices=12, bevel=min(radius * 0.5, 0.035)),
        add_sphere(f"{name}_CapA", start, (radius, radius, radius), mat, segments=12, rings=8),
        add_sphere(f"{name}_CapB", end, (radius, radius, radius), mat, segments=12, rings=8),
    ]


def add_area_light(name: str, location: tuple[float, float, float], energy: float, color, size: float = 3.0) -> bpy.types.Object:
    bpy.ops.object.light_add(type="AREA", location=location)
    obj = bpy.context.object
    obj.name = name
    obj.data.energy = energy
    obj.data.color = color
    obj.data.shape = "DISK"
    obj.data.size = size
    return obj


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def orient_scene_to_gltf_axes() -> None:
    """Map logical x/y-up/z-depth into Blender z-up before GLTF export."""

    bpy.context.view_layer.update()
    logical_to_blender = Matrix.Rotation(math.pi / 2.0, 4, "X")
    for obj in list(bpy.context.scene.objects):
        obj.matrix_world = logical_to_blender @ obj.matrix_world
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        if obj.type == "CAMERA":
            point_at(obj, (0.0, 0.0, 0.90))


def export_glb(path: Path, objects: Sequence[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True, export_apply=False, export_yup=True, export_cameras=False, export_lights=False, export_materials="EXPORT", export_texcoords=False, export_normals=True, export_tangents=False, export_animations=True, export_animation_mode="ACTIONS", export_frame_range=True, export_skins=True, export_morph=False, export_optimize_animation_size=True)


def make_materials() -> dict[str, bpy.types.Material]:
    return {
        "jacket": make_material("CharcoalJacket", (0.035, 0.050, 0.065, 1.0), roughness=0.38),
        "jacket_edge": make_material("JacketEdge", (0.085, 0.105, 0.125, 1.0), roughness=0.48),
        "pants": make_material("CargoPants", (0.024, 0.032, 0.043, 1.0), roughness=0.52),
        "boots": make_material("BootLeather", (0.012, 0.017, 0.023, 1.0), roughness=0.30, metallic=0.08),
        "sole": make_material("BootSole", (0.008, 0.011, 0.015, 1.0), roughness=0.62),
        "skin": make_material("Skin", (0.56, 0.275, 0.155, 1.0), roughness=0.47),
        "skin_light": make_material("SkinHighlight", (0.70, 0.38, 0.23, 1.0), roughness=0.43),
        "hair": make_material("Hair", (0.018, 0.011, 0.010, 1.0), roughness=0.35),
        "mask": make_material("EyeMask", (0.010, 0.016, 0.023, 1.0), roughness=0.23, metallic=0.08),
        "eye": make_material("EyeWhite", (0.92, 0.86, 0.70, 1.0), roughness=0.33),
        "pupil": make_material("EyePupil", (0.002, 0.004, 0.006, 1.0), roughness=0.18),
        "accent": make_material("Accent", (0.035, 0.48, 0.58, 1.0), roughness=0.28, metallic=0.18, emission=(0.01, 0.14, 0.18, 1.0), emission_strength=0.30),
        "metal": make_material("ZipMetal", (0.58, 0.31, 0.09, 1.0), roughness=0.24, metallic=0.80),
        "shirt": make_material("Shirt", (0.016, 0.026, 0.035, 1.0), roughness=0.48),
        "preview_floor": make_material("PreviewFloor", (0.08, 0.12, 0.15, 1.0), roughness=0.37),
    }


def create_armature() -> bpy.types.Object:
    arm_data = bpy.data.armatures.new("CrewRig")
    arm = bpy.data.objects.new("Crew", arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    definitions = [
        ("root", (0.0, 0.0, 0.0), (0.0, 0.12, 0.0), None),
        ("pelvis", (0.0, 0.12, 0.0), (0.0, 0.54, 0.0), "root"),
        ("spine", (0.0, 0.50, 0.0), (0.0, 0.88, 0.0), "pelvis"),
        ("chest", (0.0, 0.88, 0.0), (0.0, 1.20, 0.0), "spine"),
        ("neck", (0.0, 1.20, 0.0), (0.0, 1.36, 0.0), "chest"),
        ("head", (0.0, 1.34, 0.0), (0.0, 1.68, 0.0), "neck"),
        ("upper_arm.L", (-0.27, 1.10, 0.0), (-0.49, 0.91, 0.0), "chest"),
        ("forearm.L", (-0.49, 0.91, 0.0), (-0.61, 0.69, 0.0), "upper_arm.L"),
        ("hand.L", (-0.61, 0.69, 0.0), (-0.63, 0.61, 0.05), "forearm.L"),
        ("upper_arm.R", (0.27, 1.10, 0.0), (0.49, 0.91, 0.0), "chest"),
        ("forearm.R", (0.49, 0.91, 0.0), (0.61, 0.69, 0.0), "upper_arm.R"),
        ("hand.R", (0.61, 0.69, 0.0), (0.63, 0.61, 0.05), "forearm.R"),
        ("thigh.L", (-0.17, 0.54, 0.0), (-0.19, 0.27, 0.0), "pelvis"),
        ("shin.L", (-0.19, 0.27, 0.0), (-0.19, 0.055, 0.0), "thigh.L"),
        ("foot.L", (-0.19, 0.08, 0.02), (-0.19, 0.04, 0.30), "shin.L"),
        ("thigh.R", (0.17, 0.54, 0.0), (0.19, 0.27, 0.0), "pelvis"),
        ("shin.R", (0.19, 0.27, 0.0), (0.19, 0.055, 0.0), "thigh.R"),
        ("foot.R", (0.19, 0.08, 0.02), (0.19, 0.04, 0.30), "shin.R"),
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
    return arm


def skin(obj: bpy.types.Object, arm: bpy.types.Object, bone: str) -> bpy.types.Object:
    if hasattr(obj.data, "vertices"):
        group = obj.vertex_groups.new(name=bone)
        group.add([vertex.index for vertex in obj.data.vertices], 1.0, "REPLACE")
        modifier = obj.modifiers.new(name="CrewArmature", type="ARMATURE")
        modifier.object = arm
        world = obj.matrix_world.copy()
        obj.parent = arm
        obj.matrix_world = world
    return obj


def key_action(arm: bpy.types.Object, action: bpy.types.Action, frames: Iterable[int], pose_fn) -> None:
    scene = bpy.context.scene
    arm.animation_data_create()
    arm.animation_data.action = action
    for frame in frames:
        scene.frame_set(frame)
        for pose_bone in arm.pose.bones:
            pose_bone.rotation_mode = "XYZ"
            pose_bone.rotation_euler = (0.0, 0.0, 0.0)
            pose_bone.location = (0.0, 0.0, 0.0)
        pose_fn(frame)
        for pose_bone in arm.pose.bones:
            pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
            pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)
    for curve in action.fcurves:
        for keyframe in curve.keyframe_points:
            keyframe.interpolation = "BEZIER"
    action.use_fake_user = True


def build_actions(arm: bpy.types.Object) -> list[bpy.types.Action]:
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = 43
    idle = bpy.data.actions.new("Idle")

    def idle_pose(frame: int) -> None:
        phase = (frame - 1) / 20.0 * math.pi * 2.0
        sway = math.sin(phase) * 0.018
        arm.pose.bones["root"].location.y = math.sin(phase) * 0.008
        arm.pose.bones["spine"].rotation_euler[2] = sway
        arm.pose.bones["head"].rotation_euler[2] = -sway * 0.60
        arm.pose.bones["upper_arm.L"].rotation_euler[0] = -0.04 + sway
        arm.pose.bones["upper_arm.R"].rotation_euler[0] = 0.04 - sway

    key_action(arm, idle, (1, 21, 41), idle_pose)
    walk = bpy.data.actions.new("Walk")

    def walk_pose(frame: int) -> None:
        phase = (frame - 1) / 10.0 * math.pi
        swing = math.sin(phase) * 0.48
        arm.pose.bones["root"].location.y = max(0.0, math.sin(phase * 2.0)) * 0.025
        arm.pose.bones["thigh.L"].rotation_euler[0] = swing
        arm.pose.bones["shin.L"].rotation_euler[0] = -max(0.0, swing) * 0.48
        arm.pose.bones["thigh.R"].rotation_euler[0] = -swing
        arm.pose.bones["shin.R"].rotation_euler[0] = -max(0.0, -swing) * 0.48
        arm.pose.bones["upper_arm.L"].rotation_euler[0] = -swing * 0.72
        arm.pose.bones["upper_arm.R"].rotation_euler[0] = swing * 0.72
        arm.pose.bones["forearm.L"].rotation_euler[0] = -swing * 0.12
        arm.pose.bones["forearm.R"].rotation_euler[0] = swing * 0.12

    key_action(arm, walk, (1, 11, 21, 31, 41), walk_pose)
    run = bpy.data.actions.new("Run")

    def run_pose(frame: int) -> None:
        phase = (frame - 1) / 6.0 * math.pi
        swing = math.sin(phase) * 0.76
        arm.pose.bones["root"].location.y = max(0.0, math.sin(phase * 2.0)) * 0.045
        arm.pose.bones["spine"].rotation_euler[2] = math.sin(phase) * 0.045
        arm.pose.bones["thigh.L"].rotation_euler[0] = swing
        arm.pose.bones["shin.L"].rotation_euler[0] = -max(0.0, swing) * 0.68
        arm.pose.bones["thigh.R"].rotation_euler[0] = -swing
        arm.pose.bones["shin.R"].rotation_euler[0] = -max(0.0, -swing) * 0.68
        arm.pose.bones["upper_arm.L"].rotation_euler[0] = -swing * 0.84
        arm.pose.bones["upper_arm.R"].rotation_euler[0] = swing * 0.84

    key_action(arm, run, (1, 7, 13, 19, 25, 31, 37, 43), run_pose)
    crouch = bpy.data.actions.new("Crouch")

    def crouch_pose(frame: int) -> None:
        amount = 0.0 if frame in (1, 41) else math.sin(math.pi * min(frame - 1, 41 - frame) / 20.0)
        arm.pose.bones["root"].location.y = -0.10 * amount
        arm.pose.bones["pelvis"].rotation_euler[0] = 0.18 * amount
        arm.pose.bones["spine"].rotation_euler[0] = -0.20 * amount
        arm.pose.bones["thigh.L"].rotation_euler[0] = 0.70 * amount
        arm.pose.bones["thigh.R"].rotation_euler[0] = 0.70 * amount
        arm.pose.bones["shin.L"].rotation_euler[0] = -1.12 * amount
        arm.pose.bones["shin.R"].rotation_euler[0] = -1.12 * amount
        arm.pose.bones["upper_arm.L"].rotation_euler[0] = -0.20 * amount
        arm.pose.bones["upper_arm.R"].rotation_euler[0] = -0.20 * amount

    key_action(arm, crouch, (1, 11, 21, 31, 41), crouch_pose)
    arm.animation_data.action = idle
    scene.frame_set(1)
    return [idle, walk, run, crouch]


def build_crew() -> tuple[list[bpy.types.Object], bpy.types.Object]:
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.world.color = (0.006, 0.012, 0.025)
    if scene.world:
        scene.world.use_nodes = True
        background = scene.world.node_tree.nodes.get("Background")
        if background:
            background.inputs["Color"].default_value = (0.006, 0.012, 0.025, 1.0)
            background.inputs["Strength"].default_value = 0.25
    mats = make_materials()
    arm = create_armature()
    assets: list[bpy.types.Object] = [arm]

    def keep(obj: bpy.types.Object, bone: str) -> bpy.types.Object:
        skin(obj, arm, bone)
        assets.append(obj)
        return obj

    # Fitted jacket with a human-scale torso, shaped hem, shoulder yoke, and
    # front zipper. Accent is limited to a few small utility details.
    keep(add_box("JacketBody", (0.0, 0.91, 0.0), (0.66, 0.67, 0.43), mats["jacket"], bevel=0.14), "spine")
    keep(add_box("JacketHem", (0.0, 0.61, 0.0), (0.59, 0.25, 0.40), mats["jacket"], bevel=0.09), "pelvis")
    keep(add_box("ShirtOpening", (0.0, 1.16, 0.205), (0.34, 0.15, 0.026), mats["shirt"], bevel=0.02), "chest")
    keep(add_box("FrontZipper", (0.0, 0.92, 0.232), (0.025, 0.53, 0.022), mats["metal"], bevel=0.008), "chest")
    keep(add_box("ZipperPull", (0.0, 0.77, 0.244), (0.08, 0.075, 0.03), mats["accent"], bevel=0.018), "chest")
    keep(add_box("Collar.L", (-0.14, 1.20, 0.205), (0.19, 0.09, 0.25), mats["jacket_edge"], bevel=0.025, rotation=(0.0, 0.0, -0.35)), "chest")
    keep(add_box("Collar.R", (0.14, 1.20, 0.205), (0.19, 0.09, 0.25), mats["jacket_edge"], bevel=0.025, rotation=(0.0, 0.0, 0.35)), "chest")
    keep(add_box("ShoulderStripe.L", (-0.31, 1.13, 0.025), (0.065, 0.12, 0.26), mats["accent"], bevel=0.018, rotation=(0.0, 0.0, -0.16)), "chest")
    keep(add_box("ShoulderStripe.R", (0.31, 1.13, 0.025), (0.065, 0.12, 0.26), mats["accent"], bevel=0.018, rotation=(0.0, 0.0, 0.16)), "chest")
    for side, x in (("L", -0.19), ("R", 0.19)):
        keep(add_box(f"PocketFlap_{side}", (x, 0.84, 0.238), (0.18, 0.075, 0.032), mats["jacket_edge"], bevel=0.018), "spine")
        keep(add_box(f"PocketSeam_{side}", (x, 0.78, 0.235), (0.18, 0.028, 0.022), mats["metal"], bevel=0.007), "spine")
    keep(add_box("WaistBelt", (0.0, 0.62, 0.205), (0.51, 0.065, 0.035), mats["jacket_edge"], bevel=0.015), "pelvis")
    keep(add_box("WaistBuckle", (0.0, 0.62, 0.232), (0.10, 0.09, 0.035), mats["metal"], bevel=0.012), "pelvis")

    # Human head, hair, hood rim, ears, nose, and a small eye mask. Face parts
    # are deliberately on logical +z, the exported forward direction.
    keep(add_sphere("Neck", (0.0, 1.29, 0.0), (0.16, 0.15, 0.15), mats["skin"], segments=14, rings=9), "neck")
    keep(add_sphere("Head", (0.0, 1.57, 0.025), (0.245, 0.285, 0.245), mats["skin"], segments=20, rings=14), "head")
    keep(add_sphere("HairCap", (0.0, 1.755, -0.025), (0.255, 0.13, 0.23), mats["hair"], segments=18, rings=10), "head")
    keep(add_box("HairFringe", (0.0, 1.685, 0.232), (0.35, 0.085, 0.045), mats["hair"], bevel=0.032), "head")
    for side, x in (("L", -0.285), ("R", 0.285)):
        keep(add_sphere(f"Ear_{side}", (x, 1.57, 0.02), (0.052, 0.088, 0.070), mats["skin"], segments=12, rings=8), "head")
    keep(add_box("EyeMask", (0.0, 1.62, 0.235), (0.39, 0.088, 0.028), mats["mask"], bevel=0.032), "head")
    for side, x in (("L", -0.105), ("R", 0.105)):
        keep(add_sphere(f"Eye_{side}", (x, 1.63, 0.265), (0.047, 0.041, 0.022), mats["eye"], segments=14, rings=9), "head")
        keep(add_sphere(f"Pupil_{side}", (x, 1.63, 0.289), (0.021, 0.024, 0.010), mats["pupil"], segments=10, rings=7), "head")
    keep(add_sphere("Nose", (0.0, 1.55, 0.272), (0.042, 0.065, 0.052), mats["skin_light"], segments=14, rings=9), "head")
    keep(add_box("MouthShadow", (0.0, 1.46, 0.252), (0.075, 0.018, 0.014), mats["mask"], bevel=0.006), "head")

    # Compact pack and harness, visible in profile without overwhelming the
    # fitted silhouette.
    keep(add_box("CompactPack", (0.0, 0.91, -0.285), (0.44, 0.48, 0.18), mats["jacket"], bevel=0.085), "spine")
    keep(add_box("PackTop", (0.0, 1.14, -0.292), (0.28, 0.08, 0.20), mats["jacket_edge"], bevel=0.025), "spine")
    keep(add_box("PackAccent", (0.0, 0.94, -0.385), (0.17, 0.23, 0.028), mats["accent"], bevel=0.014), "spine")
    for x in (-0.21, 0.21):
        keep(add_box(f"Harness_{x:g}", (x, 0.96, 0.08), (0.045, 0.48, 0.045), mats["jacket_edge"], bevel=0.012, rotation=(0.0, 0.0, x * 0.22)), "chest")

    # Articulated jacket sleeves, gloves, cargo legs, knee panels, and boots.
    for side, sign in (("L", -1.0), ("R", 1.0)):
        for obj in add_capsule(f"JacketUpperArm_{side}", (sign * 0.27, 1.10, 0.0), (sign * 0.49, 0.91, 0.0), 0.105, mats["jacket"]):
            keep(obj, f"upper_arm.{side}")
        for obj in add_capsule(f"JacketForearm_{side}", (sign * 0.49, 0.91, 0.0), (sign * 0.61, 0.69, 0.0), 0.092, mats["jacket"]):
            keep(obj, f"forearm.{side}")
        keep(add_torus(f"Cuff_{side}", (sign * 0.50, 0.88, 0.0), 0.095, 0.019, mats["accent"], rotation=(0.0, math.pi / 2.0, 0.0), major_segments=16, minor_segments=6), f"forearm.{side}")
        keep(add_sphere(f"Glove_{side}", (sign * 0.62, 0.65, 0.055), (0.105, 0.095, 0.12), mats["boots"], segments=14, rings=9), f"hand.{side}")
        keep(add_box(f"CargoThigh_{side}", (sign * 0.18, 0.43, 0.0), (0.255, 0.39, 0.27), mats["pants"], bevel=0.085), f"thigh.{side}")
        keep(add_box(f"CargoPocket_{side}", (sign * 0.295, 0.48, 0.02), (0.075, 0.22, 0.20), mats["jacket_edge"], bevel=0.025), f"thigh.{side}")
        keep(add_box(f"KneePanel_{side}", (sign * 0.18, 0.275, 0.145), (0.18, 0.12, 0.035), mats["jacket_edge"], bevel=0.018), f"thigh.{side}")
        for obj in add_capsule(f"CargoShin_{side}", (sign * 0.19, 0.27, 0.0), (sign * 0.19, 0.055, 0.0), 0.105, mats["pants"]):
            keep(obj, f"shin.{side}")
        keep(add_box(f"Boot_{side}", (sign * 0.19, 0.10, 0.095), (0.27, 0.20, 0.40), mats["boots"], bevel=0.070), f"foot.{side}")
        keep(add_box(f"BootSole_{side}", (sign * 0.19, 0.025, 0.13), (0.30, 0.055, 0.43), mats["sole"], bevel=0.018), f"foot.{side}")
        keep(add_box(f"BootToeAccent_{side}", (sign * 0.19, 0.12, 0.30), (0.18, 0.045, 0.035), mats["accent"], bevel=0.012), f"foot.{side}")

    build_actions(arm)
    add_box("PreviewGround", (0.0, -0.045, 0.0), (3.2, 0.09, 3.2), mats["preview_floor"], bevel=0.04)
    key = add_area_light("CrewKey", (2.6, 4.0, 4.2), 650.0, (1.0, 0.38, 0.19), 3.0)
    point_at(key, (0.0, 0.9, 0.0))
    fill = add_area_light("CrewFill", (-2.4, 2.5, 2.5), 470.0, (0.05, 0.50, 0.65), 2.5)
    point_at(fill, (0.0, 1.0, 0.1))
    rim = add_area_light("CrewRim", (0.0, 3.6, -2.5), 300.0, (0.95, 0.18, 0.08), 2.0)
    point_at(rim, (0.0, 1.1, 0.0))
    bpy.ops.object.camera_add(location=(2.65, 2.25, 3.5))
    camera = bpy.context.object
    camera.name = "CrewPreviewCamera"
    camera.data.lens = 58.0
    point_at(camera, (0.0, 0.92, 0.12))
    scene.camera = camera
    return assets, arm


def write_readme(actions: Sequence[bpy.types.Action]) -> None:
    README_PATH.write_text(
        "# Laser Heist crew character\n\n"
        "Authored locally in Blender 4.5.14 LTS by `tools/build_crew_assets.py`; no external or paid model provider is used.\n\n"
        "## Runtime contract\n\n"
        "- `crew.glb` uses Three.js/glTF coordinates: x horizontal, y up, z depth.\n"
        "- Character origin is at the soles (`y=0`); modeled height is approximately 1.8m.\n"
        "- Face direction is +z. Eyes, nose, mask, collar opening, and boot toes are authored on +z.\n"
        "- `Accent` is intentionally limited to shoulder stripes, zipper pull, pack detail, cuffs, and boot toe details for per-player recoloring.\n"
        "- `Skin` is a separate material for per-character skin variation.\n"
        "- Armature contains 18 human-proportion bones and exports `Idle`, `Walk`, `Run`, and `Crouch` actions.\n\n"
        "## Look\n\n"
        "A realistic stylized human thief: fitted charcoal jacket with collar, zipper, tailored seams and pockets; compact backpack; gloves; cargo trousers with knee panels; leather boots; human head with hair, ears, nose, exposed eyes and a small eye mask. Geometry is smooth beveled/sculpted and texture-free for compact multiplayer loading.\n\n"
        "## Provenance and rebuild\n\n"
        "- Editable source: `art/crew.blend`.\n"
        "- Runtime asset: `public/heist/crew.glb`.\n"
        "- Rebuild from the project root with `blender -b --python tools/build_crew_assets.py`.\n"
        "- Validation: GLB binary inspection, Blender re-import, skin/bone/action enumeration, finite accessor scan, file-size check, and front-facing source render.\n"
        f"- Actions authored: {', '.join(action.name for action in actions)}.\n",
        encoding="utf-8",
    )


def main() -> None:
    assets, _arm = build_crew()
    actions = [action for action in bpy.data.actions if action.name in {"Idle", "Walk", "Run", "Crouch"}]
    orient_scene_to_gltf_axes()
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    export_glb(GLB_PATH, assets)
    write_readme(actions)
    print(f"[crew-assets] wrote {GLB_PATH} and {BLEND_PATH}")


if __name__ == "__main__":
    main()

