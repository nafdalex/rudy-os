#!/usr/bin/env python3
"""Generate the Rudy OS office.tmj — iconic zones:
Rudy's corner office, conference room, the open bullpen with desk pods,
accounting nook, the annex, reception, kitchen/break area, warehouse corner.

Furniture is composed by copying multi-tile "stamps" out of the original
hand-authored map (original-office.tmj) so every sprite is known-good, then
re-placing them into a show-accurate layout. Walls/floor/collision are
regenerated. Run:  python3 tools/mapgen/build_map.py
"""
import json, os, copy

HERE = os.path.dirname(__file__)
ASSETS = os.path.abspath(os.path.join(HERE, '..', '..', 'src', 'renderer', 'src', 'assets'))
MAPS = os.path.join(ASSETS, 'maps')
SRC = os.path.join(HERE, 'original-office.tmj')   # pristine copy of the original
OUT = os.path.join(MAPS, 'office.tmj')

FLIP_V = 0x40000000
GID_MASK = 0x1FFFFFFF
CHAIR_GIDS = {289, 305}                      # walkable furniture (the seat)

NEW_W, NEW_H = 34, 22
TS = 16

# ── source map ────────────────────────────────────────────────────────────────
src = json.load(open(SRC))
SW, SHH = src['width'], src['height']
SLAYERS = {l['name']: l['data'] for l in src['layers'] if 'data' in l}
FURN = ['furniture-below', 'furniture-above']

def copy_stamp(x0, y0, w, h, seat=None, layers=None):
    """Pull furniture tiles from src rect → portable stamp."""
    tiles = []
    for layer in (layers or FURN):
        d = SLAYERS[layer]
        for dr in range(h):
            for dc in range(w):
                raw = d[(y0 + dr) * SW + (x0 + dc)]
                if raw:
                    tiles.append((layer, dc, dr, raw))
    return {'w': w, 'h': h, 'seat': seat, 'tiles': tiles}

# Stamp library (rects in the ORIGINAL 28x21 map).
# Every agent desk is the same forward-facing workstation (monitor north, the
# agent seated facing it) — laid out on a uniform grid.
PC      = copy_stamp(19, 4, 3, 4, seat=(1, 2))   # workstation, agent faces UP
EXEC    = copy_stamp(3, 5, 3, 4, seat=(1, 0))    # boss desk, faces DOWN (desk to south)
CONF    = copy_stamp(3, 15, 7, 4)                 # long conference table
KITCHEN = copy_stamp(10, 1, 6, 3)                 # fridge / counter / windows
COPIER  = copy_stamp(16, 15, 3, 4)                # photocopier
BOXES   = copy_stamp(19, 17, 2, 3)                # warehouse box stack
COFFEE  = copy_stamp(10, 1, 2, 2, layers=['furniture-above'])  # water/coffee station
PLNT    = copy_stamp(7, 10, 1, 1, layers=['furniture-above'])  # potted plant (single tile)
COOLER  = copy_stamp(25, 1, 2, 3)                 # water cooler / clock

# ── blank new layers ──────────────────────────────────────────────────────────
def blank():
    return [0] * (NEW_W * NEW_H)

floor   = blank()
walls   = blank()
fb      = blank()   # furniture-below
fa      = blank()
coll    = blank()

def idx(x, y):
    return y * NEW_W + x

def setw(layer, x, y, gid):
    if 0 <= x < NEW_W and 0 <= y < NEW_H:
        layer[idx(x, y)] = gid

# ── floor (green checker, matches original) ───────────────────────────────────
for y in range(3, NEW_H - 1):
    for x in range(1, NEW_W - 1):
        base = 799 if y % 2 == 0 else 783
        setw(floor, x, y, base + (0 if x % 2 == 1 else 1))

# ── outer shell ───────────────────────────────────────────────────────────────
TOP_CAP, TOP_FACE, TOP_BASE = 522, 554, 570
L, R = 530, 533
for x in range(1, NEW_W - 1):
    setw(walls, x, 0, TOP_CAP); setw(walls, x, 1, TOP_FACE); setw(walls, x, 2, TOP_BASE)
setw(walls, 0, 0, 514); setw(walls, NEW_W - 1, 0, 517)
for y in range(1, NEW_H - 1):
    setw(walls, 0, y, L); setw(walls, NEW_W - 1, y, R)
# bottom
for x in range(1, NEW_W - 1):
    setw(walls, x, NEW_H - 1, 579)
setw(walls, 0, NEW_H - 1, 578); setw(walls, NEW_W - 1, NEW_H - 1, 581)

# ── interior wall helpers ─────────────────────────────────────────────────────
def vwall(col, r0, r1, doors=()):           # thin vertical wall
    for r in range(r0, r1 + 1):
        if r in doors:
            continue
        setw(walls, col, r, 611 if r == r0 else 643)

def hwall(row, c0, c1, doors=()):           # 3-row south-facing wall (room above)
    for c in range(c0, c1 + 1):
        if c in doors:
            continue
        setw(walls, c, row, TOP_CAP)
        setw(walls, c, row + 1, TOP_FACE)
        setw(walls, c, row + 2, TOP_BASE)

# ── place a furniture stamp; returns the seat tile (gx,gy) if any ─────────────
PLACED_SEATS = []
def place(stamp, gx, gy):
    for (layer, dc, dr, raw) in stamp['tiles']:
        tgt = fb if layer == 'furniture-below' else fa
        setw(tgt, gx + dc, gy + dr, raw)
    if stamp['seat'] is not None:
        s = (gx + stamp['seat'][0], gy + stamp['seat'][1])
        PLACED_SEATS.append(s)
        return s
    return None

# ══ ROOMS ════════════════════════════════════════════════════════════════════
# Layout v2, "the atrium". Nothing sits where the inherited floor put it:
#   top-left    the studio, a two-desk room (architect + design)
#   top-center  the café, OPEN to the floor, along the kitchen run
#   top-right   Rudy's corner office
#   bottom-left the war room with the long table
#   middle      desk pods around the entrance aisle, a reception desk up front

# The studio (top-left). Interior cols 1-7 rows 3-7.
vwall(8, 3, 10)
hwall(8, 1, 7, doors=(4,))
studio = [place(PC, 2, 3), place(PC, 5, 3)]

# Rudy's corner office (top-right). Interior cols 26-32 rows 3-7.
vwall(25, 3, 10)
hwall(8, 26, 32, doors=(29,))
rudy = place(EXEC, 27, 4)                    # boss desk, faces the room
place(PLNT, 26, 4)

# The café (top-center, open). Kitchen run + coffee + the cooler.
place(KITCHEN, 12, 3)
place(COFFEE, 18, 3)
place(COOLER, 20, 1)

# The war room (bottom-left). Interior cols 1-9 rows 17-20.
hwall(14, 1, 9, doors=(6,))
vwall(10, 14, 20, doors=(18,))
place(CONF, 2, 17)

# ══ OPEN FLOOR FURNITURE ═════════════════════════════════════════════════════
# Reception greets the entrance from beside the studio wall, clear of the aisle.
reception = place(EXEC, 9, 8)

# The bullpen: two uniform rows of five, one desk every four columns, no desk
# ever touching its neighbour. The entrance aisle (cols 12-13) stays clear the
# whole way from the door up to reception.
POD_X = [14, 18, 22, 26, 30]
POD_Y = [11, 16]
pods = []
for sy in POD_Y:
    for sx in POD_X:
        pods.append(place(PC, sx, sy))

# Plants for the watering errands.
place(PLNT, 1, 12)
place(PLNT, 13, 20)
place(PLNT, 32, 20)

# ══ COLLISION ════════════════════════════════════════════════════════════════
for y in range(NEW_H):
    for x in range(NEW_W):
        solid = False
        if walls[idx(x, y)]:
            solid = True
        for fl in (fb, fa):
            g = fl[idx(x, y)] & GID_MASK
            if g and g not in CHAIR_GIDS:
                solid = True
        if solid:
            setw(coll, x, y, 1)
# bottom entrance door, on the central aisle
for x in (12,):
    setw(coll, x, NEW_H - 1, 0)
    setw(walls, x, NEW_H - 1, 0)
# force seat tiles walkable
for (sx, sy) in PLACED_SEATS:
    setw(coll, sx, sy, 0)
# the war-room table seat sits on a conference chair; keep it walkable too
setw(coll, 5, 20, 0)

# ── spawn points (claim order set in OfficeFloor) ─────────────────────────────
def pt(name, tile):
    return {'id': 0, 'name': name, 'type': '', 'x': tile[0] * TS, 'y': tile[1] * TS,
            'width': 0, 'height': 0, 'rotation': 0, 'visible': True, 'point': True}

SEATS = {
    'desk-ceo': rudy,
    # the bullpen, front row then back row, left to right
    'pc-1': pods[0], 'pc-2': pods[1], 'pc-3': pods[2], 'pc-4': pods[3], 'pc-5': pods[4],
    'pc-6': pods[5], 'pc-7': pods[6], 'pc-8': pods[7], 'pc-9': pods[8], 'pc-10': pods[9],
    # reception + the studio
    'desk-agent-organizer': reception,
    'desk-chief-architect': studio[0], 'desk-ui-ux-expert': studio[1],
    # a seat at the war-room table
    'warroom-seat': (5, 20),
}
spawn_objs = [pt(n, t) for n, t in SEATS.items()]
spawn_objs.append(pt('entrance', (12, 20)))
# café gathering points: stands at the machines, chat spots along the bar
spawn_objs.append(pt('cafe-stand-coffee', (18, 6)))
spawn_objs.append(pt('cafe-stand-vending', (21, 5)))
spawn_objs.append(pt('cafe-seat-1', (13, 7)))
spawn_objs.append(pt('cafe-seat-2', (14, 7)))
spawn_objs.append(pt('cafe-seat-3', (16, 7)))
spawn_objs.append(pt('cafe-seat-4', (17, 7)))

zones = [
    {'id': 0, 'name': 'boardroom', 'type': '', 'x': 1 * TS, 'y': 16 * TS,
     'width': 9 * TS, 'height': 5 * TS, 'rotation': 0, 'visible': True},
    {'id': 0, 'name': 'open-work-area', 'type': '', 'x': 10 * TS, 'y': 10 * TS,
     'width': 14 * TS, 'height': 10 * TS, 'rotation': 0, 'visible': True},
]

# ── assemble & write ──────────────────────────────────────────────────────────
def tilelayer(name, data, lid):
    return {'data': data, 'height': NEW_H, 'id': lid, 'name': name, 'opacity': 1,
            'type': 'tilelayer', 'visible': True, 'width': NEW_W, 'x': 0, 'y': 0}

def objlayer(name, objs, lid):
    return {'draworder': 'topdown', 'id': lid, 'name': name, 'objects': objs,
            'opacity': 1, 'type': 'objectgroup', 'visible': True, 'x': 0, 'y': 0}

out = copy.deepcopy(src)
out['width'] = NEW_W
out['height'] = NEW_H
out['layers'] = [
    tilelayer('floor', floor, 1),
    tilelayer('walls', walls, 2),
    tilelayer('furniture-below', fb, 3),
    tilelayer('furniture-above', fa, 4),
    tilelayer('collision', coll, 5),
    objlayer('spawn-points', spawn_objs, 6),
    objlayer('zones', zones, 7),
]
out['nextlayerid'] = 8
out['nextobjectid'] = 1

json.dump(out, open(OUT, 'w'), indent=1)
print('wrote', OUT, f'{NEW_W}x{NEW_H}, {len(PLACED_SEATS)} seats')
