"""Retarget selected CC0 Quaternius clips onto the retained humanoid skeleton.
Preserves target joint lengths and converts animation deltas between rest poses.
"""
import json,struct,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/'art/vendor/quaternius'
def read(p):
 b=p.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);return g,b[28+n:]
g,blob=read(SRC/'base.glb');a,ab=read(SRC/'gaits.glb');out=bytearray(blob)
def vals(idx):
 ac=a['accessors'][idx];v=a['bufferViews'][ac['bufferView']];nc={'SCALAR':1,'VEC3':3,'VEC4':4}[ac['type']];off=v.get('byteOffset',0)+ac.get('byteOffset',0);stride=v.get('byteStride',nc*4)
 return [list(struct.unpack_from('<'+'f'*nc,ab,off+i*stride)) for i in range(ac['count'])]
def put(v,kind):
 while len(out)%4:out.append(0)
 offset=len(out);flat=[n for row in v for n in row];out.extend(struct.pack('<'+'f'*len(flat),*flat));vi=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(flat)*4});ac={'bufferView':vi,'componentType':5126,'count':len(v),'type':kind}
 if kind=='SCALAR':ac.update(min=[min(flat)],max=[max(flat)])
 i=len(g['accessors']);g['accessors'].append(ac);return i
def mul(a,b):
 x,y,z,w=a;X,Y,Z,W=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z]
def inv(q):return [-q[0],-q[1],-q[2],q[3]]
target={n.get('name'):i for i,n in enumerate(g['nodes'])};clips={'Idle_Loop':'Idle','Walk_Loop':'Walk','Sprint_Loop':'Run','Crouch_Fwd_Loop':'Crouch','Crouch_Idle_Loop':'CrouchIdle','Interact':'Interact'}
g['animations']=[]
for clip in a['animations']:
 if clip['name'] not in clips:continue
 dest={'name':clips[clip['name']],'channels':[],'samplers':[]}
 for ch in clip['channels']:
  sn=a['nodes'][ch['target']['node']];name=sn.get('name');path=ch['target']['path']
  if name not in target or path=='scale' or (path=='translation' and name not in ['root','pelvis']):continue
  tn=g['nodes'][target[name]];sampler=clip['samplers'][ch['sampler']];values=vals(sampler['output'])
  if path=='rotation':
   correction=mul(tn.get('rotation',[0,0,0,1]),inv(sn.get('rotation',[0,0,0,1])));values=[mul(correction,q) for q in values]
  else:
   src=sn.get('translation',[0,0,0]);dst=tn.get('translation',[0,0,0]);values=[[dst[j]+(row[j]-src[j])*1.035 for j in range(3)] for row in values]
  ii=put(vals(sampler['input']),'SCALAR');oi=put(values,'VEC4' if path=='rotation' else 'VEC3');si=len(dest['samplers']);dest['samplers'].append({'input':ii,'output':oi,'interpolation':'LINEAR'});dest['channels'].append({'sampler':si,'target':{'node':target[name],'path':path}})
 g['animations'].append(dest)
g['buffers']=[{'byteLength':len(out)}];j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4);out+=b'\0'*((-len(out))%4);data=struct.pack('<III',0x46546c67,2,28+len(j)+len(out))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(out),0x004e4942)+out
(SRC/'rigged-base.glb').write_bytes(data);print('Retargeted',[(c['name'],len(c['channels'])) for c in g['animations']],len(data))
