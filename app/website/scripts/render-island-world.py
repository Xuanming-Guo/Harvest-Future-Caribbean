"""Render individual Harvest island dioramas with Blender (GPL) and public terrain.

Run using uv run --no-project --python 3.11 --with bpy==4.2.22 --with numpy
--with scipy --with pillow python scripts/render-island-world.py --cache PATH.
The source elevation sampler is shared with the v2 geography guide; rendering
is real 3D geometry, directional lighting, shadows and dimensional vegetation.
No operational locations or property sizes are invented by the art renderer.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from PIL import Image
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('terrain', Path(__file__).with_name('render-island-terrain.py'))
terrain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terrain)
terrain.SIZE = (900, 600)
terrain.SCALE = .6
SIZE = (1800, 1200)
CAMERA_Y = math.sqrt(.5)
CAMERA_Z = math.sqrt(.5)

def material(name, color, roughness=.82):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat

def mesh_object(name, vertices, faces, materials, indices=None, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    for mat in materials: mesh.materials.append(mat)
    for i, poly in enumerate(mesh.polygons):
        poly.use_smooth = smooth
        if indices is not None: poly.material_index = int(indices[i])
    return obj

def grass_material(kind):
    colors = {
        'rainforest': [(0.12,.25,.035),(.31,.47,.075),(.48,.57,.15)],
        'seasonal': [(.20,.29,.045),(.43,.49,.10),(.61,.59,.24)],
        'limestone': [(.25,.36,.09),(.45,.54,.16),(.65,.65,.32)],
        'dry': [(.36,.32,.13),(.54,.48,.25),(.69,.59,.35)],
    }[kind]
    mat=material('Meadow and forest floor', colors[1]); nodes=mat.node_tree.nodes; links=mat.node_tree.links
    noise=nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=3.6; noise.inputs['Detail'].default_value=5
    ramp=nodes.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position=.2; ramp.color_ramp.elements[0].color=(*colors[0],1)
    ramp.color_ramp.elements[1].position=.8; ramp.color_ramp.elements[1].color=(*colors[2],1)
    ramp.color_ramp.elements.new(.5).color=(*colors[1],1)
    links.new(noise.outputs['Fac'],ramp.inputs[0]); links.new(ramp.outputs['Color'],nodes.get('Principled BSDF').inputs['Base Color'])
    fine=nodes.new('ShaderNodeTexNoise'); fine.inputs['Scale'].default_value=180
    bump=nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.25; bump.inputs['Distance'].default_value=.018
    links.new(fine.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs[0],nodes.get('Principled BSDF').inputs['Normal'])
    return mat

class Geometry:
    def __init__(self): self.vertices=[]; self.faces=[]; self.indices=[]
    def sphere(self, center, scale, index, phase=0, segments=9, rings=6):
        offset=len(self.vertices)
        for v in range(rings+1):
            phi=math.pi*v/rings
            for u in range(segments):
                theta=2*math.pi*u/segments+phase
                r=1+.16*math.sin(theta*3+phi*4+phase)+.09*math.cos(theta*5-phi*6)
                self.vertices.append((center[0]+math.sin(phi)*math.cos(theta)*scale[0]*r,center[1]+math.sin(phi)*math.sin(theta)*scale[1]*r,center[2]+math.cos(phi)*scale[2]*r))
        for v in range(rings):
            for u in range(segments):
                self.faces.append((offset+v*segments+u,offset+v*segments+(u+1)%segments,offset+(v+1)*segments+(u+1)%segments,offset+(v+1)*segments+u)); self.indices.append(index)
    def rod(self, a, b, radius, index, segments=5):
        direction=Vector(b)-Vector(a); side=direction.cross(Vector((0,1,0))).normalized()*radius; other=direction.normalized().cross(side)
        offset=len(self.vertices)
        for center, factor in [(Vector(a),1),(Vector(b),.6)]:
            for i in range(segments): self.vertices.append(tuple(center+factor*(side*math.cos(i*math.tau/segments)+other*math.sin(i*math.tau/segments))))
        for i in range(segments): self.faces.append((offset+i,offset+(i+1)%segments,offset+segments+(i+1)%segments,offset+segments+i)); self.indices.append(index)
    def palm(self, x,y,z,r,angle):
        self.rod((x,y,z),(x+.15*r,y,z+1.9*r),.07*r,5)
        for f in range(7):
            a=angle+f*math.tau/7; base=len(self.vertices)
            for j in range(6):
                t=j/5; dist=r*1.5*t; height=z+r*(1.9+.5*math.sin(t*math.pi)-.45*t)
                width=.18*r*math.sin(t*math.pi)
                for s in [-1,1]: self.vertices.append((x+.15*r+math.cos(a)*dist+s*math.sin(a)*width,y+math.sin(a)*dist-s*math.cos(a)*width,height))
            for j in range(5): self.faces.append((base+j*2,base+j*2+1,base+j*2+3,base+j*2+2)); self.indices.append(f%4)

def render(island_id, rings, cache, output, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    elevation, land, meters, source=terrain.relief_grid(rings, cache)
    elevation=np.maximum(0,gaussian_filter(elevation,2))
    inland=distance_transform_edt(land)
    rng=np.random.default_rng(int(hashlib.sha256(island_id.encode()).hexdigest()[:8],16))
    kind=terrain.MATERIALS.get(island_id,'rainforest')
    # Same camera and world canvas across the set. Elevation is exaggerated for
    # legible illustrated relief, while physical property widths remain separate.
    peak=float(elevation[land].max())
    relief=min(1.45,max(.28,peak/1000*1.35))
    heights=(.035+np.minimum(inland/10,1)*.10+elevation/max(peak,1)*relief)*land
    h,w=land.shape
    stride=2
    yy,xx=np.mgrid[0:h:stride,0:w:stride]; gh,gw=xx.shape
    ground=land[::stride,::stride]
    vertices=np.stack(((xx-450)/60,(288-yy)/60,heights[::stride,::stride]),axis=-1).reshape(-1,3).tolist()
    faces=[]; indices=[]
    dy,dx=np.gradient(heights)
    for y in range(gh-1):
        for x in range(gw-1):
            if not ground[y:y+2,x:x+2].all(): continue
            i=y*gw+x; faces.append((i,i+1,i+gw+1,i+gw))
            py,px=y*stride,x*stride
            slope=math.hypot(dx[py,px],dy[py,px])*60
            indices.append(1 if inland[py,px]<6 else 2 if slope>3.0 else 0)
    grass=grass_material(kind); sand=material('Warm coral sand',(.76,.64,.38)); rock=material('Volcanic rock',(.30,.32,.22))
    mesh_object('Island relief',vertices,faces,[grass,sand,rock],indices)
    greens=[(.055,.20,.025),(.12,.29,.035),(.23,.38,.055),(.34,.44,.09),(.47,.45,.16)]
    if kind=='dry': greens=[(.22,.27,.07),(.30,.33,.12),(.40,.41,.18),(.44,.40,.18),(.50,.43,.20)]
    mats=[material('Canopy '+str(i),color) for i,color in enumerate(greens)]+[material('Palm bark',(.29,.18,.075))]
    for mat in mats[:5]:
        nodes=mat.node_tree.nodes;links=mat.node_tree.links
        noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=210;noise.inputs['Detail'].default_value=3
        bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.36;bump.inputs['Distance'].default_value=.026
        links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs[0],nodes.get('Principled BSDF').inputs['Normal'])
    trees=Geometry(); stones=Geometry(); blossoms=Geometry()
    forest=gaussian_filter(rng.random((h,w)),10); forest=(forest-forest.min())/np.ptp(forest)
    tree_count=0
    # Jittered planting, variable density, and clearings avoid a regular dot grid.
    for py in range(6,h-6,5):
        for px in range(6,w-6,5):
            y=py+rng.uniform(-2,2);x=px+rng.uniform(-2,2); iy,ix=int(y),int(x)
            if not land[iy,ix] or inland[iy,ix]<6: continue
            if rng.random()>(.90 if kind=='rainforest' else .56 if kind!='dry' else .14)*max(.06,forest[iy,ix]*1.8-.18): continue
            wx,wy=(x-450)/60,(288-y)/60;z=heights[iy,ix];r=rng.uniform(.026,.052); phase=rng.uniform(0,6)
            if inland[iy,ix]<19 and rng.random()<.52:
                trees.palm(wx,wy,z,r*1.4,phase)
            else:
                trees.rod((wx,wy,z),(wx,wy,z+r*1.4),r*.13,5)
                color=int(rng.integers(0,4))
                for ox,oy,oz,sz in [(0,0,1.8,1),(-.48,.08,1.4,.7),(.43,.14,1.6,.75)]:
                    trees.sphere((wx+ox*r,wy+oy*r,z+oz*r),(r*sz,r*sz,r*1.2*sz),color,phase)
            tree_count+=1
    mesh_object('Layered tropical canopy',trees.vertices,trees.faces,mats,trees.indices)
    edge=np.argwhere(land&(inland>2)&(inland<6))
    if len(edge):
        for y,x in edge[rng.choice(len(edge),min(400,len(edge)//3),replace=False)]:
            r=rng.uniform(.019,.055);stones.sphere(((x-450)/60,(288-y)/60,heights[y,x]),(r*1.3,r,r*.85),int(rng.integers(0,3)),rng.uniform(0,6),7,4)
    mesh_object('Coastal boulders',stones.vertices,stones.faces,[rock,material('Sunlit limestone',(.50,.47,.34)),material('Warm stone',(.38,.35,.24))],stones.indices)
    # Flecks of flowering shrubs in the larger clearings, not oversized landmarks.
    for _ in range(450):
        x=int(rng.integers(5,w-5));y=int(rng.integers(5,h-5))
        if not land[y,x] or inland[y,x]<8 or forest[y,x]>.58:continue
        r=rng.uniform(.014,.025)
        blossoms.sphere(((x-450)/60,(288-y)/60,heights[y,x]+r),(r*1.4,r,r),int(rng.integers(0,3)),segments=6,rings=4)
    mesh_object('Flowering shrubs',blossoms.vertices,blossoms.faces,[material('Hibiscus',(.64,.19,.08)),material('Golden flowers',(.80,.58,.10)),material('Cream flowers',(.78,.73,.41))],blossoms.indices)
    world=bpy.data.worlds.new('Island daylight');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.66,.79,1,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4
    light=bpy.data.lights.new('Warm afternoon sun','AREA');light.energy=500;light.shape='DISK';light.size=7;obj=bpy.data.objects.new('Warm afternoon sun',light);bpy.context.collection.objects.link(obj);obj.location=(-5,-3,9)
    obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
    sun=bpy.data.lights.new('Coastal sunlight','SUN');sun.energy=1.1;sun.angle=.12;sun.color=(1,.91,.72);obj=bpy.data.objects.new('Coastal sunlight',sun);bpy.context.collection.objects.link(obj);obj.rotation_euler=(.45,-.5,-.4)
    cam=bpy.data.cameras.new('Island camera');obj=bpy.data.objects.new('Island camera',cam);bpy.context.collection.objects.link(obj);obj.location=(0,-14,14);obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler();cam.type='ORTHO';cam.ortho_scale=15;bpy.context.scene.camera=obj
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=samples;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=10
    scene.render.resolution_x=SIZE[0];scene.render.resolution_y=SIZE[1];scene.render.resolution_percentage=100;scene.render.film_transparent=True;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    raw=cache/f'{island_id}-render.png';scene.render.filepath=str(raw);bpy.ops.render.render(write_still=True)
    image=Image.open(raw).convert('RGBA');rgba=np.asarray(image).astype(np.float32); alpha=rgba[:,:,3]/255
    # Water follows the rendered silhouette, including its perspective. It fades
    # out to genuine alpha, so panning and neighbouring islands have no blue box.
    distance=distance_transform_edt(alpha<.5)
    water_alpha=np.clip(1-distance/62,0,1)**1.6*.85
    near=np.exp(-distance/22)
    colors=np.array([30,158,172])[None,None,:]*(1-near[:,:,None])+np.array([89,218,196])[None,None,:]*near[:,:,None]
    ripple=(np.exp(-((distance-4)/1.3)**2)*.65+np.exp(-((distance-16)/1.1)**2)*.30+np.exp(-((distance-33)/1.3)**2)*.13)
    colors=colors*(1-ripple[:,:,None])+np.array([217,249,225])*ripple[:,:,None]
    total=alpha+water_alpha*(1-alpha)
    rgb=(rgba[:,:,:3]*alpha[:,:,None]+colors*water_alpha[:,:,None]*(1-alpha[:,:,None]))/np.maximum(total[:,:,None],.0001)
    result=np.dstack((rgb,total*255)).clip(0,255).astype('uint8')
    output.mkdir(parents=True,exist_ok=True);file=output/f'{island_id}-world-v3.webp';Image.fromarray(result).save(file,'WEBP',quality=91,method=6)
    # Low-resolution height registration is enough for overlay projection; the
    # full elevation mesh and final bitmap remain independent of product data.
    grid=heights[::10,::10]
    registration={'width':90,'height':60,'values':np.round(grid.reshape(-1),4).tolist()}
    raw.unlink()
    return {'asset':f'/art/islands/{file.name}','sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'material':kind,'trees':tree_count,'samples':samples,'elevationRangeMeters':[max(0,round(float(elevation[land].min()))),round(peak)],'verticalRelief':relief,'source':source},registration

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--cache',required=True,type=Path);parser.add_argument('--island',action='append');parser.add_argument('--samples',type=int,default=24);args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    output=ROOT/'public/art/islands';coast=json.loads((ROOT/'src/lib/island-coastlines.json').read_text());manifest_path=output/'world-manifest.json';registration_path=ROOT/'src/lib/island-art-registration.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {'version':3,'dimensions':list(SIZE),'renderer':'Blender 4.2 LTS / Cycles','rendering':'Orthographic 3D island dioramas with elevation-derived relief, modeled vegetation, coastal rocks and transparent shallow water','attribution':'Mapzen terrain tiles; USGS SRTM/GMTED2010; NOAA ETOPO1. Natural Earth coastlines. Procedural scene code authored for Harvest.','camera':{'northCompression':CAMERA_Y,'heightProjection':CAMERA_Z,'canvas':[1500,1000],'center':[750,500]},'islands':{}}
    registrations=json.loads(registration_path.read_text()) if registration_path.exists() else {}
    for island in args.island or coast:
        if not args.island and island in manifest['islands'] and (output/f'{island}-world-v3.webp').exists():continue
        record,registration=render(island,coast[island],args.cache,output,args.samples);manifest['islands'][island]=record;registrations[island]=registration
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n');registration_path.write_text(json.dumps(registrations,separators=(',',':'))+'\n');print('FINISHED',island,flush=True)
if __name__=='__main__':main()
