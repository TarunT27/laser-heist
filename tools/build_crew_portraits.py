"""Studio portraits of the crew operative for the crew-select screen, one accent tint per role.

Run:  ~/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/build_crew_portraits.py

Loads public/heist/crew.glb (the same model the game animates), poses it on the Idle clip,
and writes transparent WebP files to public/heist/portraits/: hero-<role>.webp (900 x 1100,
head and shoulders) and thumb-<role>.webp (320 x 320, head).
"""
from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "heist" / "portraits"
# Linear base colours for the Accent material; they read as blue, violet, orange and green on screen.
ROLES = {"hacker": (0.02, 0.2, 0.72), "infiltrator": (0.2, 0.07, 0.62), "carrier": (0.82, 0.24, 0.02), "lookout": (0.02, 0.4, 0.17)}


def area(scene, name, loc, target, energy, size, rgb=(1, 1, 1)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.size, data.color = energy, size, rgb
    light = bpy.data.objects.new(name, data)
    light.location = loc
    light.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(light)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / "public" / "heist" / "crew.glb"))
    # The loot duffel and the preview dome are not part of a portrait.
    for o in bpy.data.objects:
        if o.name.startswith("Loot_") or o.name == "Icosphere":
            o.hide_render = True
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    armature.animation_data_create().action = bpy.data.actions["Idle"]
    scene = bpy.context.scene
    scene.frame_set(24)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.quality = 88
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("Studio")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.82, 0.83, 0.85, 1)
    background.inputs["Strength"].default_value = 0.25
    area(scene, "Key", (-1.1, -1.6, 2.2), (0, 0, 1.5), 95, 1.6, (1, 0.97, 0.93))
    area(scene, "Fill", (1.4, -1.3, 1.4), (0, 0, 1.45), 22, 2.0, (0.92, 0.95, 1))
    area(scene, "Rim", (0.9, 1.2, 2.1), (0, 0, 1.55), 260, 0.8)
    area(scene, "Top", (0, 0.2, 2.8), (0, 0, 1.5), 25, 1.5)
    camera_data = bpy.data.cameras.new("Portrait")
    camera = bpy.data.objects.new("Portrait", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    accent = bpy.data.materials["Accent"].node_tree.nodes["Principled BSDF"]
    OUT.mkdir(parents=True, exist_ok=True)

    def shoot(path, resolution, location, target, lens):
        scene.render.resolution_x, scene.render.resolution_y = resolution
        camera_data.lens = lens
        camera.location = location
        camera.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)

    for role, rgb in ROLES.items():
        accent.inputs["Base Color"].default_value = (*rgb, 1)
        shoot(OUT / f"hero-{role}.webp", (900, 1100), (0.3, -1.12, 1.7), (0.03, 0, 1.47), 46)
        shoot(OUT / f"thumb-{role}.webp", (320, 320), (0.2, -1.1, 1.66), (0.0, 0, 1.6), 80)
    print(f"PORTRAITS -> {OUT}")


if __name__ == "__main__":
    main()
