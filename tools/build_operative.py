"""Build the production crew from a licensed humanoid and retargeted animation.
Blender coordinates are x across, -y forward, z up. GLB ships +z forward/y up.
Run prepare_crew_animation.py first. Imported source and license hashes are retained.
"""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/heist/crew.glb'; BLEND=ROOT/'art/crew.blend'; QA=ROOT/'docs/laser/qa'; QA.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.scene.render.fps=30
bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/vendor/quaternius/rigged-base.glb'))
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
body=bpy.data.objects['SuperHero_Male'];assets=[arm]+[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name in ['SuperHero_Male','Eyes','Eyebrows']]
arm.data.pose_position='REST'

def material(name,color,rough=.65,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal;return m
skin=material('Skin',(.43,.24,.15),.65)
cloth=material('Charcoal woven jacket',(.024,.034,.041),.85)
pants=material('Graphite cargo fabric',(.016,.024,.030),.92)
leather=material('Gloves and boot leather',(.009,.013,.016),.52)
trim=material('Rubber trim',(.038,.047,.052),.7)
metal=material('Brushed steel',(.26,.30,.31),.3,.7)
accent=material('Accent',(.11,.52,.44),.55)
hair=material('Hair',(.018,.012,.009),.9)
eye=material('Eye ivory',(.67,.63,.52),.3)
pupil=material('Iris',(.015,.025,.021),.3)
mask=material('Woven face covering',(.008,.016,.021),.95)
for o in assets:
 if o.type=='MESH':
  o.data.materials.clear()
  for p in o.data.polygons:p.use_smooth=True
bpy.data.objects['Eyebrows'].data.materials.append(hair)
bpy.data.objects['Eyes'].data.materials.append(eye)
for m in [skin,cloth,pants,leather,trim]:body.data.materials.append(m)
# Sculpt clothing volume into the rigged base. Keep the face's anatomical mesh.
for v in body.data.vertices:
 x,y,z=v.co
 if z<1.50:
  hand=abs(x)>.715
  if not hand:
   inflate=.014 if z>.95 else .009
   v.co+=v.normal*inflate
   if .99<z<1.43 and abs(x)<.26 and y<0:v.co.y=min(v.co.y,-.105)
for p in body.data.polygons:
 c=sum((body.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
 p.material_index=0 if c.z>1.60 else 3 if c.z<.19 or abs(c.x)>.715 else 1 if c.z>1.01 else 2

def bind(obj,bone):
 g=obj.vertex_groups.new(name=bone);g.add(list(range(len(obj.data.vertices))),1,'REPLACE');mod=obj.modifiers.new('Skin','ARMATURE');mod.object=arm;obj.parent=arm;assets.append(obj);return obj

def box(name,loc,size,mat,bone,bevel=.01):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 if bevel:
  mod=o.modifiers.new('Tailored edges','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in o.data.polygons:p.use_smooth=True
 return bind(o,bone)

def sphere(name,loc,scale,mat,bone):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=10,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 for p in o.data.polygons:p.use_smooth=True
 return bind(o,bone)

def shoe(side):
 # Longitudinal sections give the shoe an actual last: low rounded toe,
 # narrowed waist, raised instep and fitted heel instead of a beveled cube.
 bone='foot_l' if side==1 else 'foot_r';cx=side*.115
 parts=[]
 def mesh_part(name,verts,faces,mat):
  me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.materials.append(mat);me.update()
  bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
  ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
  for p in me.polygons:p.use_smooth=True
  parts.append(ob);return ob
 sections=[(-.181,.008,.052,.044),(-.172,.038,.071,.033),(-.147,.063,.085,.028),(-.105,.071,.099,.027),(-.055,.065,.125,.028),(-.005,.060,.171,.030),(.045,.057,.198,.032),(.092,.056,.191,.030),(.124,.048,.153,.029),(.140,.022,.110,.033),(.144,.006,.084,.040)]
 vs=[];fs=[];n=20
 for y,w,top,bottom in sections:
  for i in range(n):
   a=i/n*math.tau;sn=math.sin(a)
   vs.append((cx+w*math.cos(a),y,bottom+(top-bottom)*(sn+1)/2))
 for j in range(len(sections)-1):
  for i in range(n):fs.append((j*n+i,(j+1)*n+i,(j+1)*n+(i+1)%n,j*n+(i+1)%n))
 fs.extend([tuple(reversed(range(n))),tuple((len(sections)-1)*n+i for i in range(n))])
 upper=mesh_part('Shoe woven upper',vs,fs,cloth)
 bpy.ops.object.select_all(action='DESELECT');upper.select_set(True);bpy.context.view_layer.objects.active=upper
 smooth=upper.modifiers.new('Soft shoe last','SUBSURF');smooth.levels=1;bpy.ops.object.modifier_apply(modifier=smooth.name)
 # A fitted knit collar covers the trouser cut and follows the ankle joint.
 vs=[];fs=[];n=24
 for z,rx,ry in [(.145,.059,.069),(.185,.058,.064),(.219,.054,.058)]:
  for i in range(n):
   a=i/n*math.tau;vs.append((cx+rx*math.cos(a),.065+ry*math.sin(a),z))
 for j in range(2):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 mesh_part('Shoe fitted ankle collar',vs,fs,cloth)
 # The sole follows the toe/waist/heel outline, with a gentle toe spring.
 outline=[(0,-.185),(.040,-.176),(.065,-.151),(.075,-.108),(.071,-.065),(.064,-.015),(.060,.052),(.060,.101),(.047,.135),(.022,.149),(0,.152),(-.022,.149),(-.047,.135),(-.060,.101),(-.060,.052),(-.064,-.015),(-.071,-.065),(-.075,-.108),(-.065,-.151),(-.040,-.176)]
 for name,mat,zs in [('Shoe rubber outsole',leather,[(.98,.008),(1.02,.014),(1.02,.025)]),('Shoe sculpted midsole',trim,[(1.02,.025),(1,.039),(.95,.044)])]:
  vs=[];fs=[];n=len(outline)
  for scale,z in zs:
   for x,y in outline:
    spring=max(0,(-y-.12))*.22
    vs.append((cx+x*scale,y,z+spring))
  for j in range(len(zs)-1):
   for i in range(n):fs.append((j*n+i,(j+1)*n+i,(j+1)*n+(i+1)%n,j*n+(i+1)%n))
  fs.extend([tuple(reversed(range(n))),tuple((len(zs)-1)*n+i for i in range(n))]);mesh_part(name,vs,fs,mat)
 # Raised stitched eyestays and crossed cords read as footwear at close range.
 def cord(name,points,radius,mat):
  cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.bevel_depth=radius;cu.bevel_resolution=2
  sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
  for p,co in zip(sp.points,points):p.co=(*co,1)
  ob=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
  bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH');parts.append(bpy.context.object)
 rows=[(-.083,.111),(-.060,.127),(-.037,.148),(-.014,.169),(.009,.184)]
 for sign in [-1,1]:cord('Shoe stitched eyestay',[(cx+sign*.029,y,z-.006) for y,z in rows],.005,leather)
 for i in range(len(rows)-1):
  y,z=rows[i];ny,nz=rows[i+1]
  for sign in [-1,1]:cord('Shoe laces',[(cx+sign*.028,y,z),(cx,(y+ny)/2,(z+nz)/2+.004),(cx-sign*.028,ny,nz)],.0024,trim)
 # One skinned render object per shoe, retaining three material regions.
 bpy.ops.object.select_all(action='DESELECT')
 for ob in parts:ob.select_set(True)
 bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();ob=bpy.context.object;ob.name='Tailored sneaker '+('left' if side==1 else 'right');bind(ob,bone)
 calf=ob.vertex_groups.new(name='calf_l' if side==1 else 'calf_r')
 for v in ob.data.vertices:
  blend=max(0,min(1,(v.co.z-.14)/.075))
  if blend:calf.add([v.index],blend,'REPLACE');ob.vertex_groups[bone].add([v.index],1-blend,'REPLACE')

def shell(name,select,mat,offset):
 # A fitted layer retains the source skin weights, including all head/finger deformation.
 polys=[p for p in body.data.polygons if select(sum((body.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices))]
 indices=sorted({i for p in polys for i in p.vertices});mapping={i:j for j,i in enumerate(indices)}
 verts=[body.data.vertices[i].co+body.data.vertices[i].normal*offset for i in indices];faces=[[mapping[i] for i in p.vertices] for p in polys]
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.materials.append(mat);o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
 for g in body.vertex_groups:o.vertex_groups.new(name=g.name)
 for ni,oi in enumerate(indices):
  for g in body.data.vertices[oi].groups:o.vertex_groups[g.group].add([ni],g.weight,'REPLACE')
 for p in mesh.polygons:p.use_smooth=True
 mod=o.modifiers.new('Skin','ARMATURE');mod.object=arm;o.parent=arm;assets.append(o);return o
shell('Close cropped hair',lambda c:c.z>1.744 or (c.z>1.675 and c.y>.035),hair,.004)
# Continuous cloth rings produce a clean mask edge instead of polygon cut-outs.
def ring_piece(name,levels,mat,bone):
 vs=[];fs=[];n=24
 for z,w,front,back in levels:
  for i in range(n):
   a=i/n*math.tau;vs.append((math.cos(a)*w,math.sin(a)*(front if math.sin(a)<0 else back),z))
 for j in range(len(levels)-1):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 me=bpy.data.meshes.new(name);me.from_pydata(vs,[],fs);me.materials.append(mat);ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
 for p in me.polygons:p.use_smooth=True
 return bind(ob,bone)
ring_piece('Sculpted face covering',[(1.562,.058,.080,.05),(1.59,.085,.098,.065),(1.635,.096,.118,.072),(1.674,.088,.137,.06)],mask,'Head')
ring_piece('Jacket collar',[(1.477,.085,.075,.095),(1.525,.078,.065,.083),(1.54,.073,.060,.080)],cloth,'neck_01')
# Remove the underlying bare feet before fitting rigid, rounded boot meshes.
bm=bmesh.new();bm.from_mesh(body.data)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,.17),plane_no=(0,0,1),clear_inner=True,clear_outer=False)
bm.to_mesh(body.data);bm.free();body.data.update()
# Subtle eyes rather than the old protruding cartoon spheres.
for s in [-1,1]:sphere('Iris', (s*.032,-.081,1.697),(.010,.004,.010),pupil,'Head')
# A stitched, weighted jacket shell forms a coherent torso silhouette.
rings=[(.985,.185,.128,.15),(1.05,.205,.139,.162),(1.18,.225,.153,.17),(1.32,.263,.163,.18),(1.40,.274,.14,.165)]
verts=[];faces=[];N=24
for z,w,front,back in rings:
 for i in range(N):
  a=i/N*math.tau;y=math.sin(a)*(front if math.sin(a)<0 else back);verts.append((math.cos(a)*w,y,z))
for j in range(len(rings)-1):
 for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
mesh=bpy.data.meshes.new('Tailored jacket');mesh.from_pydata(verts,[],faces);mesh.materials.append(cloth);o=bpy.data.objects.new('Tailored jacket',mesh);bpy.context.collection.objects.link(o)
for n in ['pelvis','spine_01','spine_02','spine_03']:o.vertex_groups.new(name=n)
for i,v in enumerate(mesh.vertices):
 z=v.co.z
 if z<1.07:w={'pelvis':.65,'spine_01':.35}
 elif z<1.20:w={'spine_01':.5,'spine_02':.5}
 else:w={'spine_02':.2,'spine_03':.8}
 for n,k in w.items():o.vertex_groups[n].add([i],k,'REPLACE')
for p in mesh.polygons:p.use_smooth=True
mod=o.modifiers.new('Skin','ARMATURE');mod.object=arm;o.parent=arm;assets.append(o)
# Tailored details are bound to the matching anatomical joints.
box('Zip', (0,-.158,1.22),(.009,.012,.34),metal,'spine_02',.003)
box('Zip pull',(0,-.17,1.38),(.024,.013,.036),accent,'spine_03',.004)
for s in [-1,1]:
 box('Chest pocket',(s*.135,-.158,1.31),(.115,.025,.11),trim,'spine_03',.012)
 box('Pocket seam',(s*.135,-.174,1.35),(.09,.008,.009),metal,'spine_03',.002)
 box('Cargo pocket',(s*.193,.018,.79),(.065,.16,.19),cloth,'thigh_l' if s==1 else 'thigh_r',.02)
 box('Knee reinforcement',(s*.115,-.064,.57),(.14,.05,.13),trim,'thigh_l' if s==1 else 'thigh_r',.025)
 shoe(s)
 # Rest-pose arm stripe sits around the sleeve, bends with the upper arm.
 box('Crew sleeve panel',(s*.30,-.018,1.468),(.055,.014,.10),accent,'upperarm_l' if s==1 else 'upperarm_r',.009)
 # Shoulder harness front straps.
 box('Harness strap',(s*.145,-.165,1.235),(.032,.020,.31),leather,'spine_02',.007)
 box('Harness buckle',(s*.145,-.181,1.17),(.043,.012,.044),metal,'spine_02',.006)
box('Utility belt',(0,-.003,1.005),(.39,.295,.045),leather,'pelvis',.016)
box('Belt buckle',(0,-.158,1.005),(.053,.018,.041),metal,'pelvis',.006)
box('Slim technical backpack',(0,.208,1.24),(.31,.14,.38),cloth,'spine_02',.045)
box('Backpack inset',(0,.286,1.25),(.23,.020,.27),trim,'spine_02',.025)
box('Backpack emblem',(0,.30,1.31),(.09,.008,.032),accent,'spine_02',.004)
for s in [-1,1]:box('Pack zipper',(s*.132,.28,1.24),(.006,.009,.25),metal,'spine_02',.002)
# A padded, rounded duffel sits over the regular day pack while the crew carry
# the take. Every object here has the Loot_ prefix so the runtime can toggle
# the complete bag as one visible group. The body is a lofted superellipse,
# not a box: its tapered ends and soft, slightly flattened cross-section read
# as packed canvas while staying within a compact 0.48 x 0.42 x 0.24 m volume.
loot_canvas=material('Loot charcoal olive canvas',(.048,.061,.044),.9)
loot_panel=material('Loot reinforced olive canvas',(.065,.076,.052),.88)
loot_webbing=material('Loot dark olive webbing',(.105,.122,.079),.86)
loot_stitch=material('Loot muted stitch',(.19,.205,.145),.82)
loot_hardware=material('Loot brushed gunmetal',(.19,.225,.205),.36,.62)
loot_gold=material('Loot aged gold seal',(.50,.31,.085),.42,.48)
loot_dark=material('Loot zipper tape',(.012,.020,.016),.67,.08)
LOOT_CY=.345; LOOT_CZ=1.25; LOOT_RY=.12; LOOT_RZ=.21; LOOT_POWER=.68
LOOT_PROFILE=[(-.24,.32),(-.225,.62),(-.205,.81),(-.175,.93),(-.13,.98),(-.07,1.0),(0,1.0),(.07,1.0),(.13,.98),(.175,.93),(.205,.81),(.225,.62),(.24,.32)]

def bind_loot(obj):
 # Blend across the lower and upper thoracic bones so the bag follows posture
 # instead of being rigidly pinned to the lower spine.
 low=obj.vertex_groups.new(name='spine_02');high=obj.vertex_groups.new(name='spine_03')
 for v in obj.data.vertices:
  t=max(0,min(1,((obj.matrix_world @ v.co).z-1.105)/.31));t=t*t*(3-2*t)
  if 1-t>1e-5:low.add([v.index],1-t,'REPLACE')
  if t>1e-5:high.add([v.index],t,'REPLACE')
 mod=obj.modifiers.new('Loot spine skin','ARMATURE');mod.object=arm;obj.parent=arm;assets.append(obj);return obj

def loot_mesh(name,verts,faces,mat,smooth=True):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.materials.append(mat);me.update()
 bm=bmesh.new();bm.from_mesh(me);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
 obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj)
 if smooth:
  for p in me.polygons:p.use_smooth=True
 return bind_loot(obj)

def loot_box(name,loc,size,mat,bevel=.005):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);obj=bpy.context.object;obj.name=name;obj.dimensions=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);obj.data.materials.append(mat)
 if bevel:
  mod=obj.modifiers.new('Soft tailored edge','BEVEL');mod.width=bevel;mod.segments=3;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in obj.data.polygons:p.use_smooth=True
 return bind_loot(obj)

def loot_curve(name,points,radius,mat,cyclic=False):
 cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=2;cu.bevel_depth=radius;cu.bevel_resolution=2
 sp=cu.splines.new('POLY');sp.points.add(len(points)-1)
 for p,co in zip(sp.points,points):p.co=(*co,1)
 sp.use_cyclic_u=cyclic
 obj=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(obj);obj.data.materials.append(mat)
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.ops.object.convert(target='MESH')
 obj=bpy.context.object;obj.name=name;return bind_loot(obj)

def loot_width_scale(x):
 ax=max(-.24,min(.24,x))
 for i in range(len(LOOT_PROFILE)-1):
  x0,v0=LOOT_PROFILE[i];x1,v1=LOOT_PROFILE[i+1]
  if x0<=ax<=x1:
   t=(ax-x0)/(x1-x0);t=t*t*(3-2*t);return v0+(v1-v0)*t
 return .32

def loot_back_y(x,z,offset=0):
 scale=loot_width_scale(x);rz=LOOT_RZ*scale;ry=LOOT_RY*scale
 q=max(0,min(.999,(abs(z-LOOT_CZ)/max(rz,.001))**(1/LOOT_POWER)))
 return LOOT_CY+ry*max(0,1-q*q)**(LOOT_POWER/2)+offset

def loot_cross_section(x,theta,offset=0):
 scale=loot_width_scale(x);c=math.cos(theta);s=math.sin(theta)
 y=LOOT_CY+LOOT_RY*scale*math.copysign(abs(c)**LOOT_POWER,c)
 z=LOOT_CZ+LOOT_RZ*scale*math.copysign(abs(s)**LOOT_POWER,s)
 length=math.hypot(y-LOOT_CY,z-LOOT_CZ)
 if length:y+=(y-LOOT_CY)/length*offset;z+=(z-LOOT_CZ)/length*offset
 return y,z

# Padded shell: cross-section loops are densely sampled and taper at the ends.
bag_rings=LOOT_PROFILE;ring_n=32;verts=[];faces=[]
for x,scale in bag_rings:
 for j in range(ring_n):
  y,z=loot_cross_section(x,j/ring_n*math.tau)
  verts.append((x,y,z))
for i in range(len(bag_rings)-1):
 for j in range(ring_n):faces.append((i*ring_n+j,(i+1)*ring_n+j,(i+1)*ring_n+(j+1)%ring_n,i*ring_n+(j+1)%ring_n))
faces.append(tuple(reversed(range(ring_n))))
faces.append(tuple((len(bag_rings)-1)*ring_n+j for j in range(ring_n)))
loot_mesh('Loot_DuffleBody',verts,faces,loot_canvas)

# Soft oval end panels and a narrow double row of perimeter piping make the
# duffel construction legible in a three-quarter view.
for side,label in [(-1,'L'),(1,'R')]:
 x=side*.226
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=(x,LOOT_CY,LOOT_CZ));obj=bpy.context.object
 obj.name='Loot_EndPanel_'+label;obj.scale=(.018,.103,.157);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 obj.data.materials.append(loot_panel)
 for p in obj.data.polygons:p.use_smooth=True
 bind_loot(obj)
 points=[]
 for j in range(48):
  theta=j/48*math.tau;y,z=loot_cross_section(side*.202,theta,.004);points.append((side*.204,y,z))
 loot_curve('Loot_EndPanelSeam_'+label,points,.0024,loot_stitch,True)

# The broad rear patch is a curved grid that sits just above the shell rather
# than a flat plate floating off the bag.
verts=[];faces=[];NX=13;NZ=11
for iz in range(NZ):
 z=1.155+iz/(NZ-1)*.19
 for ix in range(NX):
  x=-.116+ix/(NX-1)*.232
  verts.append((x,loot_back_y(x,z,.004),z))
for iz in range(NZ-1):
 for ix in range(NX-1):
  a=iz*NX+ix;faces.append((a,a+1,a+NX+1,a+NX))
loot_mesh('Loot_RearAdminPanel',verts,faces,loot_panel)

panel_edge=[]
for x,z in [(-.118,1.17),(-.118,1.32),(-.106,1.343),(0,1.347),(.106,1.343),(.118,1.32),(.118,1.17),(.105,1.155),(0,1.153),(-.105,1.155)]:
 panel_edge.append((x,loot_back_y(x,z,.008),z))
loot_curve('Loot_AdminPanelStitch',panel_edge,.002,loot_stitch,True)

# Compression webbing wraps around the padded section at two stations. The
# loop meshes keep the straps flush on the curved front, sides and back.
for side,label in [(-1,'L'),(1,'R')]:
 cx=side*.132;band_width=.028;verts=[];faces=[];N=64
 for j in range(N):
  theta=j/N*math.tau;y,z=loot_cross_section(cx,theta,.008)
  verts.extend([(cx-band_width/2,y,z),(cx+band_width/2,y,z)])
 for j in range(N):faces.append((j*2,(j*2+1),((j+1)%N)*2+1,((j+1)%N)*2))
 loot_mesh('Loot_CompressionWebbing_'+label,verts,faces,loot_webbing)
 # Brushed side-release style frames and crossbars lie on the rear-facing run.
 bx=cx; bz=LOOT_CZ; halfw=.022;halfh=.021
 frame=[(bx-halfw,loot_back_y(bx-halfw,bz-halfh,.016),bz-halfh),
        (bx-halfw,loot_back_y(bx-halfw,bz+halfh,.016),bz+halfh),
        (bx+halfw,loot_back_y(bx+halfw,bz+halfh,.016),bz+halfh),
        (bx+halfw,loot_back_y(bx+halfw,bz-halfh,.016),bz-halfh)]
 loot_curve('Loot_BuckleFrame_'+label,frame,.003,loot_hardware,True)
 loot_curve('Loot_BuckleBar_'+label,[(bx,loot_back_y(bx,bz-halfh,.019),bz-halfh),(bx,loot_back_y(bx,bz+halfh,.019),bz+halfh)],.0025,loot_hardware)

# A stitched rear zipper, compact pull and tamper seal signal secured valuables
# without exposing a jewel or putting a large emblem on the bag.
zip_left=[];zip_right=[]
for i in range(25):
 x=-.12+i/24*.24
 zip_left.append((x,loot_back_y(x,1.367,.007),1.367))
 zip_right.append((x,loot_back_y(x,1.379,.007),1.379))
loot_curve('Loot_ZipperTrack',zip_left,.0032,loot_dark)
loot_curve('Loot_ZipperTrackEdge',zip_right,.0022,loot_stitch)
teeth_v=[];teeth_f=[]
for i in range(15):
 x=-.101+i/14*.202;z=1.373;y=loot_back_y(x,z,.009);dx=.003;dy=.002;dz=.003
 base=len(teeth_v);teeth_v.extend([(x-dx,y-dy,z-dz),(x+dx,y-dy,z-dz),(x+dx,y+dy,z-dz),(x-dx,y+dy,z-dz),(x-dx,y-dy,z+dz),(x+dx,y-dy,z+dz),(x+dx,y+dy,z+dz),(x-dx,y+dy,z+dz)])
 teeth_f.extend([tuple(base+a for a in f) for f in [(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]])
loot_mesh('Loot_ZipperTeeth',teeth_v,teeth_f,loot_hardware,False)
pull_z=1.394;loot_box('Loot_ZipperPull',(0,loot_back_y(0,pull_z,.012),pull_z),(.018,.009,.031),loot_gold,.004)
seal_z=1.335;loot_box('Loot_SecuritySeal',(0,loot_back_y(0,seal_z,.012),seal_z),(.048,.013,.031),loot_gold,.006)
loot_box('Loot_SealLockMark',(0,loot_back_y(0,seal_z,.020),seal_z),(.009,.004,.015),loot_dark,.0015)
# Export only the character; remove importer bone shape helpers.
arm.data.pose_position='POSE';scene=bpy.context.scene;scene.render.fps=30
for track in arm.animation_data.nla_tracks:track.mute=True
# All imported animations retained as actions; use Idle as the neutral preview.
for action in bpy.data.actions:
 action.use_fake_user=True
 print('ACTION',action.name,tuple(action.frame_range))
idle=next(a for a in bpy.data.actions if a.name=='Idle' or a.name.endswith('_Idle'))
arm.animation_data.action=idle
if hasattr(idle,'slots') and len(idle.slots):arm.animation_data.action_slot=idle.slots[0]
scene.frame_set(1)
bpy.ops.object.select_all(action='DESELECT')
for o in assets:o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.export_scene.gltf(filepath=str(OUT),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_skins=True,export_yup=True,export_materials='EXPORT',export_cameras=False,export_lights=False,export_force_sampling=True,export_frame_range=False)
# Studio preview, fully separate from the shipped asset.
scene.render.engine='BLENDER_EEVEE_NEXT';scene.render.resolution_x=960;scene.render.resolution_y=960;scene.render.resolution_percentage=100
scene.world.color=(.08,.08,.08)
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.16,.19,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
for loc,power,color,size in [((2,-3,4),450,(1,.86,.69),3),((-3,-1,2),350,(.53,.75,1),3),((0,3,3),600,(.60,1,.85),2)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.color=color;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2.4,-4.3,2.2));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=2.25;camera.rotation_euler=(Vector((0,0,.92))-camera.location).to_track_quat('-Z','Y').to_euler();scene.camera=camera
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.023));bpy.context.object.data.materials.append(material('Preview backdrop',(.08,.13,.14),.9))
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
arm.animation_data.action=idle
if hasattr(idle,'slots') and len(idle.slots):arm.animation_data.action_slot=idle.slots[0]
scene.frame_set(0);scene.frame_set(1);bpy.context.view_layer.update()
preview_location=camera.location.copy();preview_rotation=camera.rotation_euler.copy();preview_scale=camera.data.ortho_scale
camera.location=(.65,-1.1,.50);camera.data.ortho_scale=.72;camera.rotation_euler=(Vector((0,-.01,.12))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(QA/'operative-shoes.png');bpy.ops.render.render(write_still=True)
camera.location=preview_location;camera.rotation_euler=preview_rotation;camera.data.ortho_scale=preview_scale
for clip,frame in [('Idle',1),('Walk',9),('Run',7),('Crouch',8)]:
 action=next(a for a in bpy.data.actions if a.name.endswith('_'+clip) or a.name==clip)
 arm.animation_data.action=action
 if hasattr(action,'slots') and len(action.slots):arm.animation_data.action_slot=action.slots[0]
 scene.frame_set(0);scene.frame_set(frame);bpy.context.view_layer.update();scene.render.filepath=str(QA/('operative-'+clip.lower()+'.png'));bpy.ops.render.render(write_still=True)
arm.animation_data.action=idle
if hasattr(idle,'slots') and len(idle.slots):arm.animation_data.action_slot=idle.slots[0]
scene.frame_set(0);scene.frame_set(1);bpy.context.view_layer.update()
for ob in assets:
 if ob.name.startswith(('Slim technical backpack','Backpack ','Pack zipper')):ob.hide_render=True
camera.location=(2.1,3.5,2.0);camera.data.ortho_scale=2.1;camera.rotation_euler=(Vector((0,.05,1.0))-camera.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(QA/'operative-loot.png');bpy.ops.render.render(write_still=True)
print('EXPORTED',OUT,OUT.stat().st_size)
