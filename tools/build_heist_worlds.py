"""Authored modular environments for the three playable heist contracts.
Run with Blender --background --python tools/build_heist_worlds.py.
"""
import sys, math, random
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import build_heist_assets as h
import bpy
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'heist'; ART=ROOT/'art'; ART.mkdir(exist_ok=True)

def make(level):
 h.clear_scene(); h.set_world(); objects=[]
 def keep(o): objects.append(o); return o
 colors=[((.68,.60,.46,1),(.92,.84,.68,1),(.62,.34,.10,1),(.18,.42,.40,1)),((.20,.25,.22,1),(.58,.56,.45,1),(.70,.40,.12,1),(.07,.18,.17,1)),((.08,.14,.20,1),(.23,.32,.39,1),(.30,.42,.49,1),(.02,.31,.36,1))][level]
 floor=h.material('FloorStone',colors[0],roughness=.24,metallic=.13)
 ivory=h.material('Architecture',colors[1],roughness=.42)
 gold=h.material('ArchitecturalMetal',colors[2],metallic=.82,roughness=.22)
 dark=h.material('Obsidian',(.018,.027,.03,1),roughness=.35,metallic=.15)
 glass=h.material('Glass',colors[3],roughness=.09,metallic=.15,alpha=.2,transmission=.18)
 green=h.material('Foliage',(.025,.13,.07,1),roughness=.7)
 light=h.material('WarmLight' if level<2 else 'CoolLight',(1,.55,.21,1) if level<2 else (.05,.7,.83,1),emission=(1,.55,.21,1) if level<2 else (.05,.7,.83,1),emission_strength=2)
 pale=h.material('StoneFleck',(.47,.43,.34,1),roughness=.6)
 def box(n,p,s,m=ivory,b=.03): return keep(h.add_box(n,p,s,m,bevel=b))
 def cyl(n,p,r,d,m=gold):return keep(h.add_cylinder(n,p,r,d,m,bevel=.025))
 def ball(n,p,s,m=green):return keep(h.add_sphere(n,p,s,m,segments=12,rings=8))
 box('Floor',(0,-.2,0),(32,.4,24),floor)
 box('Foundation',(0,-1.0,0),(33,1.2,25),dark)
 # Structured stone flooring, genuine geometric seams and subtle flecks.
 for x in range(-16,17,4):box('FloorInlay',(x,.006,0),(.018,.01,24),gold,0)
 for z in range(-12,13,4):box('FloorInlay',(0,.007,z),(32,.01,.018),gold,0)
 rng=random.Random(240+level)
 if level==0:
  for i in range(520):
   x,z=rng.uniform(-15.9,15.9),rng.uniform(-11.9,11.9)
   keep(h.add_cone('TerrazzoChip',(x,.012,z),rng.uniform(.012,.04),rng.uniform(.01,.025),.003,pale,vertices=3,bevel=0))
 # Tall window walls, buttresses, frame grids and indirect light coves.
 for x in [-16,16]:
  box('GlassSide',(x,2.5,0),(.08,5,24),glass,0)
  box('SidePlinth',(x,.25,0),(.3,.5,24))
  box('SideCornice',(x,5,0),(.5,.22,24))
  box('CoveLight',(x-.12*(1 if x>0 else -1),4.82,0),(.05,.06,23.8),light,0)
  for z in range(-12,13,4):
   box('WindowMullion',(x,2.6,z),(.15,5.2,.09),gold,.015)
  box('WindowTransom',(x,2.0,0),(.12,.06,24),gold,.01)
 box('PanoramaGlass',(0,2.5,-12),(32,5,.08),glass,0)
 box('RearCornice',(0,5,-12),(32,.22,.5))
 box('RearCove',(0,4.82,-11.85),(32,.06,.06),light,0)
 for x in range(-16,17,4):box('RearMullion',(x,2.6,-12),(.09,5.2,.15),gold,.01)
 box('RearTransom',(0,2,-12),(32,.06,.12),gold,.01)
 # Entrance balustrade and central open approach.
 for x in [-10,10]:
  box('EntranceRailGlass',(x,.65,12),(12,1.3,.08),glass,0)
  box('EntranceRailCap',(x,1.32,12),(12,.06,.14),gold,.01)
 for x in [-14,14]:
  for z in [-10,9]:
   cyl('ColumnBase',(x,.12,z),.55,.24)
   cyl('FlutedColumn',(x,2.5,z),.32,4.8,ivory)
   cyl('ColumnCapital',(x,4.8,z),.5,.22)
   for a in range(12):
    ang=a*math.tau/12;cyl('ColumnFlute',(x+math.cos(ang)*.32,2.5,z+math.sin(ang)*.32),.026,4.5,gold)
 # Distinct decorative architecture per map, all outside the action lanes.
 for i,(x,z) in enumerate([(-13,0),(-13,-5),(14,-7),(6,-10)]):
  cyl('ExhibitPlinth',(x,.42,z),.75,.84,dark)
  cyl('ExhibitRim',(x,.85,z),.78,.06,gold)
  if level==0:
   tor=keep(h.add_torus('LoopSculpture',(x,1.9,z),.72,.14,gold,rotation=(.2+i*.4,0,.3),major_segments=40,minor_segments=10));tor.scale=(1,1.5,.6)
   ball('SculpturePearl',(x,1.2,z),(.25,.25,.25),ivory)
  elif level==1:
   for j in range(3):box('GoldBars',(x+(j-1)*.3,1,z),(.25,.25,.6),gold,.04)
   box('DisplayGlass',(x,1.25,z),(1.4,.8,1.2),glass,.02)
  else:
   cyl('DataCore',(x,1.6,z),.48,1.4,dark)
   for j in range(5):cyl('CoreLuminousRing',(x,1.05+j*.25,z),.5,.04,light)
 # Leafy plants with readable leaf silhouette.
 for x,z in [(-14,6),(14,8),(-14,-10),(14,-10)]:
  cyl('PlanterBase',(x,.35,z),.42,.7,ivory)
  cyl('Soil',(x,.71,z),.35,.04,dark)
  for j in range(9):
   ang=j*2.4;px=x+math.cos(ang)*.27;pz=z+math.sin(ang)*.27
   keep(h.add_cylinder_between('PlantStem',(x,.7,z),(px,1.5+j*.04,pz),.015,green))
   leaf=ball('Leaf',(px,1.3+j*.045,pz),(.13,.35,.055));leaf.rotation_euler=(.4*math.sin(ang),ang,.4*math.cos(ang))
 # Diamond plinth, clear main interaction radius; player never needs center.
 cyl('VaultPlinth',(0,.42,-6),.8,.84,dark)
 cyl('VaultGoldRim',(0,.85,-6),.84,.07,gold)
 cyl('VaultHalo',(0,.9,-6),.63,.04,light)
 # Extraction terrace outline; actual win area unobstructed.
 for x in [-14,-8]:box('ExtractionLight',(x,.035,-8),(.045,.05,6),light,0)
 for z in [-11,-5]:box('ExtractionLight',(-11,.035,z),(6,.05,.045),light,0)
 # Benches, museum signage panels, or bank counters are perimeter details.
 for x in [-7,7]:
  box('BenchSeat',(x,.55,10),(3,.18,.7),dark,.1)
  for dx in [-1.1,1.1]:box('BenchLeg',(x+dx,.26,10),(.12,.5,.5),gold,.02)
 if level==1:
  for x in [-13,13]:
   box('BankArtDecoPanel',(x,2,11.6),(3,3.5,.15),dark)
   for dx in [-1,-.5,0,.5,1]:box('DecoDetail',(x+dx,2,11.48),(.045,3.3,.02),gold,0)
 if level==2:
  for x in [-14,14]:
   for z in [-3,1]:
    box('ServerCabinet',(x,1.4,z),(1.2,2.8,1.1),dark,.08)
    for j in range(8):box('ServerSlot',(x, .35+j*.3,z+.56),(.9,.08,.035),gold,.005)
    for j in range(8):box('ServerLED',(x+.35,.35+j*.3,z+.585),(.04,.04,.02),light,0)
 # Real fixture geometry and brass ceiling ribbons; no opaque ceiling hiding space.
 for x in [-8,8]:
  box('CeilingRibbon',(x,5,0),(.12,.18,24),gold,.02)
  for z in [-7,0,7]:
   cyl('SpotHousing',(x,4.75,z),.16,.35,dark)
   cyl('SpotLens',(x,4.55,z),.14,.025,light)
 # Merge static meshes by material to reduce draw calls. Keep glass separate.
 batches={}
 for o in objects:
  if o.type=='MESH':batches.setdefault(o.data.materials[0].name,[]).append(o)
 joined=[]
 for name,parts in batches.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in parts:o.select_set(True)
  bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();o=parts[0];o.name='World_'+name;joined.append(o)
 h.orient_scene_to_gltf_axes()
 h.save_blend(ART/('world-'+str(level)+'.blend'))
 h.export_glb(OUT/('world-'+str(level)+'.glb'),joined)
 print('WORLD',level,'OK')
for level in range(3):make(level)
