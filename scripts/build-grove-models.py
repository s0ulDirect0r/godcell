"""Author GODCELL's grove creatures. Run with Blender --background --python this-file.

Meshes use game creature coordinates: head -X, dorsal +Z, legs +/-Y.
The runtime supplies gait, specialization visibility and energy emission.
"""
import bpy
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'client/public/models/grove'
OUT.mkdir(parents=True, exist_ok=True)

def material(name, color, metallic=0.0, glow=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = 0.36
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = glow
    return mat

def empty(name, position=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.parent = parent
    return obj

def ellipsoid(name, pos, scale, mat, parent=None, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = pos
    obj.scale = scale
    obj.data.materials.append(mat)
    bevel = obj.modifiers.new('Soft shell edges', 'BEVEL')
    bevel.width = .06
    bevel.segments = 2
    obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj

def beam(name, a, b, width, mat, parent=None, taper=.65):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=width, radius2=width*taper, depth=(b-a).length)
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    obj.location = (a+b)/2
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    obj.data.materials.append(mat)
    return obj

def export(name):
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / (name+'.blend')))
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name+'.glb')), export_format='GLB',
        export_yup=False, export_apply=True, export_animations=False)
    print('EXPORTED', name, 'objects', len(bpy.context.scene.objects))

def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

reset()
shell = material('Carapace • petrol ceramic', (.055,.115,.14), .65)
edge = material('Rim • oxidized silver', (.28,.42,.43), .65)
joint = material('Joint • charcoal tendon', (.015,.025,.033), .2)
core = material('Energy • player tint', (.1,.85,.65), .25, 2.2)
amber = material('Seed • amber', (.95,.43,.08), .2, 1.4)
body = empty('authoredBody')
# Broad shoulder, tapered abdomen, separated floating shell plates.
for i, (x, width) in enumerate([(-.45,.68),(.25,.6),(.91,.45)]):
    ellipsoid('Core_%d'%i, (x,0,.12), (.52,width*.8,.36), core, body)
    for side in [-1,1]:
        plate = ellipsoid('Shell_%d_%d'%(i,side), (x,side*width*.48,.3), (.59,width*.67,.3), shell, body)
        plate.rotation_euler.x = side*.18
        beam('ShellRim', (x-.43,side*width,.25), (x+.35,side*width*.9,.26), .035, edge, body)
head = ellipsoid('Head', (-1.13,0,.14), (.55,.46,.29), shell, body)
for side in [-1,1]:
    ellipsoid('Eye', (-1.48,side*.27,.26), (.17,.085,.07), core, body)
    beam('Mandible', (-1.4,side*.24,.02), (-1.78,side*.37,-.06), .08, edge, body)
    beam('Antenna', (-1.31,side*.35,.32), (-1.85,side*.58,.49), .025, core, body)
for i,x in enumerate([-.68,.1,.81]):
    for side in [-1,1]:
        hip=empty('leg_%s_%d'%('L' if side==1 else 'R',i),(x,side*.44,0),body)
        knee=(.1 if i==2 else -.12,side*.67,-.06)
        foot=(.2 if i==2 else -.28,side*.94,-.53)
        ellipsoid('Hip',(0,0,0),(.15,.16,.15),edge,hip,1)
        beam('Femur',(0,0,0),knee,.13,shell,hip)
        ellipsoid('Knee',knee,(.13,.13,.13),core,hip,1)
        beam('Tibia',knee,foot,.09,edge,hip,taper=.3)
        beam('Claw',foot,(foot[0]-.18,foot[1],foot[2]-.025),.04,joint,hip)
for i in range(7):
    x=1.24+i*.24
    r=.24*(1-i*.105)
    ellipsoid('Tail_%d'%i,(x,0,.08+i*.015),(r*1.35,r,r),shell,body,1)
    ellipsoid('TailSignal_%d'%i,(x,0,.08+r),(r*.6,r*.45,.035),core,body,1)
for side in [-1,1]:
    melee=empty('spec_melee_%s'%side,parent=body)
    beam('RaptorialArm',(-.92,side*.4,.15),(-1.32,side*.95,.3),.14,shell,melee)
    beam('Blade',(-1.32,side*.95,.3),(-2.05,side*.66,.23),.19,edge,melee,taper=.02)
    beam('BladeEdge',(-1.3,side*.93,.32),(-2.05,side*.66,.25),.035,core,melee)
    ranged=empty('spec_ranged_%s'%side,parent=body)
    ellipsoid('Capacitor',(.1,side*.38,.6),(.53,.21,.2),shell,ranged)
    beam('Barrel',(.05,side*.38,.62),(-1.12,side*.38,.62),.12,edge,ranged)
    ellipsoid('Muzzle',(-1.14,side*.38,.62),(.05,.09,.09),core,ranged,1)
    traps=empty('spec_traps_%s'%side,parent=body)
    for i in range(3):
        ellipsoid('SeedPod',(.12+i*.42,side*.64,.3),(.26,.27,.32),shell,traps)
        ellipsoid('SeedWindow',(.12+i*.42,side*.68,.52),(.13,.14,.12),amber,traps,1)
export('hexapod')

reset()
grazer=empty('authoredGrazer')
ochre=material('Grazer • copper shell',(.27,.16,.075),.5)
ivory=material('Grazer • pale rim',(.55,.48,.28),.45)
for i in range(5):
    x=-.55+i*.32
    ellipsoid('GrazerCore',(x,0,.24),(.33,.57,.28),core,grazer)
    ellipsoid('GrazerPlate',(x,0,.46),(.34,.69,.34),ochre,grazer)
    beam('GrazerRidge',(x,-.5,.66),(x,.5,.66),.035,ivory,grazer)
ellipsoid('GrazerHead',(-1,0,.12),(.4,.35,.22),ivory,grazer)
for side in [-1,1]:
    ellipsoid('GrazerEye',(-1.2,side*.23,.24),(.1,.06,.05),core,grazer,1)
    beam('GrazerTusk',(-1.12,side*.29,.05),(-1.45,side*.45,-.03),.06,ivory,grazer,taper=.1)
    for i,x in enumerate([-.6,0,.6]):
        hip=empty('leg_%s_%d'%('L' if side==1 else 'R',i),(x,side*.4,.06),grazer)
        beam('GrazerLeg',(0,0,0),(.1,side*.38,-.29),.11,joint,hip)
        ellipsoid('GrazerFoot',(.1,side*.38,-.29),(.18,.16,.08),ivory,hip,1)
for x in [-.2,.32,.75]:
    beam('SeedStem',(x,0,.65),(x,0,1.0),.035,ivory,grazer)
    ellipsoid('SeedLantern',(x,0,1.02),(.12,.12,.18),amber,grazer,1)
export('grazer')
