#!/usr/bin/env python3
"""
Builds the furniture's 3D models from the pieces in Furniture.java.

Each piece becomes a proper item model (textured boxes, plus extra detail below) that the game shows on an
item_display entity. Wood, legs, fabric and top are tinted at runtime (custom_model_data colours 0-3), so any
material still works. Writes:
  src/main/resources/assets/helpermod/{items,models}/furniture/...      (loaded by players who have the mod)
  src/main/resources/assets/helpermod/textures/block/furniture/*.png
  src/main/resources/helper-furniture-pack.zip                          (sent to players who don't)
Run from minecraft-helper-mod/:  python3 tools/furniture_models.py
"""
import hashlib, io, json, os, random, re, shutil, zipfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src/main/java/com/helpermod/Furniture.java")
RES = os.path.join(ROOT, "src/main/resources")
A = os.path.join(RES, "assets/helpermod")

# ---------------------------------------------------------------------------------------------
# Pieces, read straight from the Java so the two never disagree
# ---------------------------------------------------------------------------------------------
src = open(SRC).read()
body = src[src.index("static final List<Piece> PIECES"):src.index("static Piece piece(String id)")]
pieces = {}
for m in re.finditer(r'b\("([a-z_]+)",(.*?)\.done\(\)', body, re.S):
    pid, chain = m.group(1), m.group(2)
    parts = []
    for p in re.finditer(r'\.p\(Role\.([A-Z]+),\s*([-\d.,\s]+)\)', chain):
        nums = [float(x) for x in p.group(2).split(",")]
        parts.append((p.group(1), *nums))
    pieces[pid] = parts

# Extra detail that only the 3D model has (same pixel coordinates as the Java parts).
EXTRA = {
    "counter": [("BLACK", 7.9, 1, 0.9, 8.1, 13, 1.05), ("METAL", 9, 10, 0.5, 9.6, 11, 1)],
    "kitchen_sink": [("BLACK", 7.9, 1, 0.9, 8.1, 11, 1.05)],
    "stove": [("GLASS", 4, 4, 0.35, 12, 9, 0.5), ("METAL", 2.5, 13, 0.4, 3.5, 13.8, 1), ("METAL", 5.5, 13, 0.4, 6.5, 13.8, 1),
              ("METAL", 9.5, 13, 0.4, 10.5, 13.8, 1), ("METAL", 12.5, 13, 0.4, 13.5, 13.8, 1)],
    "fridge": [("GRAY", 0.3, 0, 0.6, 15.7, 1, 1), ("BLACK", 0, 31, 1, 16, 31.4, 16)],
    "wall_cabinet": [("WOOD", -0.3, 15.5, 7.5, 16.3, 16.3, 16)],
    "sofa": [("FABRIC", 1, 9, 10.2, 15.6, 17, 12), ("FABRIC", 16.4, 9, 10.2, 31, 17, 12),
             ("FABRIC", -0.3, 12.5, 1.7, 2.3, 13.5, 12), ("FABRIC", 29.7, 12.5, 1.7, 32.3, 13.5, 12),
             ("WHITE", 2.5, 9, 9, 7, 13.5, 10.5), ("WHITE", 25, 9, 9, 29.5, 13.5, 10.5)],
    "armchair": [("FABRIC", 2, 9, 10.2, 14, 17, 12), ("FABRIC", -0.3, 12.5, 1.7, 2.3, 13.5, 12), ("FABRIC", 13.7, 12.5, 1.7, 16.3, 13.5, 12)],
    "coffee_table": [("TOP", 2, 8, 4, 14, 8.3, 12), ("WOOD", 2.5, 2.5, 4.5, 13.5, 3, 11.5)],
    "tv": [("GRAY", 7, 5.3, 8.85, 9, 5.7, 8.95)],
    "tv_stand": [("BLACK", 15.8, 1, 0.9, 16.2, 8, 1.05), ("TOP", 0, 9, 2, 32, 9.4, 16)],
    "floor_lamp": [("LEGS", 2.8, 29.5, 2.8, 13.2, 30.3, 13.2), ("LEGS", 2.8, 21.7, 2.8, 13.2, 22.5, 13.2)],
    "dining_table": [("WOOD", 3, 12, 1.5, 29, 14, 2.5), ("WOOD", 3, 12, 13.5, 29, 14, 14.5)],
    "dining_chair": [("WOOD", 2, 20, 11.5, 14, 22.5, 14.5), ("WOOD", 4, 12, 12.2, 5, 20, 13.8), ("WOOD", 11, 12, 12.2, 12, 20, 13.8)],
    "cupboard": [("BLACK", 7.9, 1, 0.9, 8.1, 13, 1.05), ("WOOD", 7.6, 16, 7.4, 8.4, 29, 8)],
    "wardrobe": [("WOOD", -0.4, 31, 1.6, 16.4, 32, 16.4), ("WOOD", 0, 0, 1.5, 16, 1, 2)],
    "bedside_table": [("BLACK", 2, 4.6, 1.5, 14, 5, 2.05), ("WHITE", 6.5, 15.5, 6.5, 9.5, 16, 11.5)],
    "dresser": [("TOP", -0.3, 14.5, 1.7, 32.3, 15.3, 16)],
    "desk": [("METAL", 26, 3, 0.25, 28, 3.6, 0.5), ("METAL", 26, 9, 0.25, 28, 9.6, 0.5), ("WOOD", 2, 10, 14, 22, 13, 15)],
    "headboard": [("FABRIC", 4, 8, 14.2, 15.5, 18, 14.5), ("FABRIC", 16.5, 8, 14.2, 28, 18, 14.5)],
    "bed": [("WOOD", -2, 22, 0, 0, 24.5, 16), ("WOOD", 32, 12, 0, 34, 13.5, 16), ("FABRIC", -1.5, 7, 2.5, -0.5, 20, 13.5)],
    "vanity": [("METAL", 7.5, 8.5, 1.5, 8.5, 9.5, 2), ("WOOD", 0.5, 26.5, 12.5, 15.5, 27.5, 15.5)],
    "toilet": [("WHITE", 2, 18, 11.5, 14, 18.8, 16.3), ("WHITE", 3, 9.5, 10.5, 13, 16, 12)],
    "bathtub": [("WHITE", -0.3, 9.5, -0.3, 32.3, 10.5, 16.3)],
    "bathroom_sink": [("METAL", 7.5, 13, 6, 8.5, 13.2, 7)],
    "shower": [("METAL", 7.5, 28.9, 12, 8.5, 29.4, 13), ("WHITE", 0, 0.9, 0, 16, 1.2, 16)],
    "picnic_table": [("WOOD", 0, 12.9, 8, 32, 13.2, 8.1)],
    "patio_umbrella": [("METAL", 7, 29.5, 7, 9, 30.5, 9)],
    "sun_lounger": [("WHITE", 3, 12, 13.6, 13, 15, 14.4)],
    "bbq_grill": [("METAL", 6, 21, 13, 10, 21.6, 15), ("METAL", 1.5, 8.5, 1.5, 14.5, 9, 14.5)],
    "fire_pit": [("GRAY", 0.5, 3.6, 0.5, 15.5, 4.2, 15.5)],
    "lamp_post": [("BLACK", 5.2, 26, 5.2, 5.8, 31, 5.8), ("BLACK", 10.2, 26, 10.2, 10.8, 31, 10.8),
                  ("BLACK", 5.2, 26, 10.2, 5.8, 31, 10.8), ("BLACK", 10.2, 26, 5.2, 10.8, 31, 5.8)],
    "mailbox": [("BLACK", 7.3, 12.5, 2.4, 8.7, 13, 2.6)],
    "planter_box": [("WOOD", -0.3, 7.5, 1.7, 32.3, 8.3, 14.3)],
    "hot_tub": [("TOP", 0, 12, 2, 2, 13, 14), ("TOP", 30, 12, 2, 32, 13, 14)],
    "fountain": [("GRAY", 5.5, 4.5, 5.5, 10.5, 5.5, 10.5), ("GRAY", 7, 15, 7, 9, 17, 9)],
    "patio_chair": [("METAL", 2, 8, 13, 3, 18, 14), ("METAL", 13, 8, 13, 14, 18, 14)],
    "office_chair": [("BLACK", 2, 11, 4, 3.2, 12, 11), ("BLACK", 12.8, 11, 4, 14, 12, 11), ("METAL", 2.3, 9, 8, 2.9, 11, 9),
                     ("METAL", 13.1, 9, 8, 13.7, 11, 9), ("BLACK", 7, 0, 1.5, 9, 0.8, 2.5), ("BLACK", 7, 0, 13.5, 9, 0.8, 14.5)],
    "garden_bench": [("WOOD", 0, 17.5, 13.8, 32, 18.5, 15.2)],
    "plant_pot": [("POT", 3.5, 7, 3.5, 12.5, 8.2, 12.5), ("PLANT", 4, 18, 4, 12, 23, 12)],
    "ceiling_light": [("METAL", 6.5, 15.5, 6.5, 9.5, 16, 9.5)],
    "wall_clock": [("BLACK", 7.6, 12, 14.7, 8.4, 12.6, 14.8), ("BLACK", 7.6, 5.4, 14.7, 8.4, 6, 14.8),
                   ("BLACK", 4.4, 8.6, 14.7, 5, 9.4, 14.8), ("BLACK", 11, 8.6, 14.7, 11.6, 9.4, 14.8)],
}

TINT = {"WOOD": 0, "LEGS": 1, "FABRIC": 2, "TOP": 3}
TEX = {"WOOD": "wood", "LEGS": "legs", "FABRIC": "fabric", "TOP": "top", "WHITE": "white", "BLACK": "black", "GRAY": "gray",
       "METAL": "metal", "GLASS": "glass", "WATER": "water", "BOOKS": "books", "PLANT": "plant", "POT": "pot"}
OFF = {"SCREEN": "screen_off", "LIGHT": "light_off", "BURNER": "burner_off"}
GLOW = {"SCREEN": "screen_on", "LIGHT": "light_on", "BURNER": "burner_on"}

# ---------------------------------------------------------------------------------------------
# Textures (16x16, drawn here so nothing depends on vanilla file names)
# ---------------------------------------------------------------------------------------------
def tex(name, fn, alpha=255):
    rnd = random.Random(name)
    img = Image.new("RGBA", (16, 16))
    for y in range(16):
        for x in range(16):
            r, g, b, *a = fn(x, y, rnd)
            img.putpixel((x, y), (max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b))), a[0] if a else alpha))
    return img

def gray(v): return (v, v, v)

TEXTURES = {
    # tinted (light grays so the tint colour shows true)
    "wood": lambda x, y, r: gray(222 + (10 if (y % 4 == 0) else 0) - (18 if y % 4 == 3 else 0) + r.randint(-8, 8) - (25 if (x + y * 7) % 23 == 0 else 0)),
    "legs": lambda x, y, r: gray(214 + (14 if x % 5 == 0 else 0) - (16 if x % 5 == 3 else 0) + r.randint(-7, 7)),
    "fabric": lambda x, y, r: gray(232 + (10 if (x + y) % 2 == 0 else -6) + r.randint(-4, 4)),
    "top": lambda x, y, r: gray(238 + r.randint(-9, 6)),
    # fixed colours
    "white": lambda x, y, r: gray(240 + r.randint(-4, 4) + (8 if x + y < 6 else 0)),
    "black": lambda x, y, r: gray(34 + r.randint(-5, 5)),
    "gray": lambda x, y, r: (128 + r.randint(-14, 14), 128 + r.randint(-14, 14), 132 + r.randint(-14, 14)),
    "metal": lambda x, y, r: gray(190 + (18 if y % 3 == 0 else 0) + r.randint(-6, 6)),
    "glass": lambda x, y, r: (190, 225, 245, 230 if x in (0, 15) or y in (0, 15) else (150 if (x - y) % 9 == 0 else 90)),
    "water": lambda x, y, r: (40 + r.randint(-6, 6), 110 + r.randint(-10, 10), 210 + r.randint(-10, 10), 175),
    "books": lambda x, y, r: ([(150, 40, 40), (40, 90, 150), (60, 120, 50), (180, 150, 50), (110, 60, 130), (200, 110, 40)][(x // 2) % 6]
                              if y > 1 else (60, 40, 25)),
    "plant": lambda x, y, r: (40 + r.randint(0, 30), 110 + r.randint(0, 60), 30 + r.randint(0, 20)) if r.random() > 0.08
                              else (230, 150, 200),
    "pot": lambda x, y, r: (160 + r.randint(-10, 10), 88 + r.randint(-8, 8), 60 + r.randint(-6, 6)),
    "screen_off": lambda x, y, r: gray(24 + (10 if x + y < 8 else 0)),
    "screen_on": lambda x, y, r: (40 + y * 4, 90 + y * 6, 170 + y * 4),
    "light_off": lambda x, y, r: gray(205 + r.randint(-6, 6)),
    "light_on": lambda x, y, r: (255, 245, 200 + r.randint(-10, 10)),
    "burner_off": lambda x, y, r: gray(50 if (abs(x - 7.5) + abs(y - 7.5)) % 4 < 2 else 30),
    "burner_on": lambda x, y, r: (255, 90 + (60 if (abs(x - 7.5) + abs(y - 7.5)) % 4 < 2 else 0), 20),
}

# ---------------------------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------------------------
def split(a, b):
    """Cut a span at every 16-pixel line so textures keep one texel per pixel instead of stretching."""
    cuts = [a]
    k = (int(a // 16) + 1) * 16
    while k < b - 1e-6:
        cuts.append(k)
        k += 16
    cuts.append(b)
    return list(zip(cuts, cuts[1:]))

def uv(u1, u2, v1, v2):
    """UVs for a face spanning those pixels, folded into one 16x16 texture."""
    base_u, base_v = (u1 // 16) * 16, (v1 // 16) * 16
    a, b = u1 - base_u, u2 - base_u
    c, d = v1 - base_v, v2 - base_v
    return [round(min(a, 16), 3), round(min(c, 16), 3), round(min(b, 16), 3), round(min(d, 16), 3)]

def m(v):  # piece pixels -> model coordinates (half size, the entity scales it back up 2x)
    return round(v / 2 + 4, 4)

def elements(parts, texture_of, m=m, tint=TINT):
    out = []
    for role, x1, y1, z1, x2, y2, z2 in parts:
        t = texture_of(role)
        if t is None:
            continue
        x1, x2 = sorted((x1, x2)); y1, y2 = sorted((y1, y2)); z1, z2 = sorted((z1, z2))
        for xa, xb in split(x1, x2):
            for ya, yb in split(y1, y2):
                for za, zb in split(z1, z2):
                    faces = {}
                    top = 16 - yb % 16 if yb % 16 else 0
                    def face(u):
                        f = {"texture": "#" + t, "uv": u}
                        if role in tint:
                            f["tintindex"] = tint[role]
                        return f
                    vy = [16 - (yb - (ya // 16) * 16), 16 - (ya - (ya // 16) * 16)]
                    vy = [max(0, round(vy[0], 3)), max(0, round(vy[1], 3))]
                    fx = uv(xa, xb, 0, 0); fz = uv(za, zb, 0, 0)
                    faces["north"] = face([round(16 - fx[2], 3), vy[0], round(16 - fx[0], 3), vy[1]])
                    faces["south"] = face([fx[0], vy[0], fx[2], vy[1]])
                    faces["west"] = face([fz[0], vy[0], fz[2], vy[1]])
                    faces["east"] = face([round(16 - fz[2], 3), vy[0], round(16 - fz[0], 3), vy[1]])
                    ud = uv(xa, xb, za, zb)
                    faces["up"] = face(ud)
                    faces["down"] = face(ud)
                    if xb - xa < 1e-6 or yb - ya < 1e-6 or zb - za < 1e-6:
                        continue
                    out.append({"from": [m(xa), m(ya), m(za)], "to": [m(xb), m(yb), m(zb)], "faces": faces})
    return out

def model(els, folder="furniture"):
    used = sorted({f["texture"][1:] for e in els for f in e["faces"].values()})
    return {"textures": {**{u: f"helpermod:block/{folder}/" + u for u in used}, "particle": f"helpermod:block/{folder}/" + (used[0] if used else "wood")},
            "elements": els}

TINTS = [{"type": "minecraft:custom_model_data", "index": i, "default": -1} for i in range(4)]

def leaf(name):
    return {"type": "minecraft:model", "model": "helpermod:furniture/" + name, "tints": TINTS}

# ---------------------------------------------------------------------------------------------
# The Star Roadster: a low single-seat speedster. Pixels are real size (16 = one block), x across
# (-14..14), y up from the ground, z along the car (+z is the front). The seat is at x 0, z 0.
# ---------------------------------------------------------------------------------------------
def mirror(parts):
    out = []
    for r, x1, y1, z1, x2, y2, z2 in parts:
        out += [(r, x1, y1, z1, x2, y2, z2), (r, -x2, y1, z1, -x1, y2, z2)]
    return out

def wheel(cz):
    return [("TIRE", 10.5, 2, cz - 5.5, 14, 9, cz + 5.5), ("TIRE", 10.5, 0.5, cz - 4, 14, 10.5, cz + 4),
            ("TIRE", 10.5, 0, cz - 2.5, 14, 11, cz + 2.5), ("RIM", 14, 2.5, cz - 3, 14.3, 8.5, cz + 3),
            ("RIM", 14, 1.5, cz - 2, 14.3, 9.5, cz + 2), ("CHROME", 14.3, 4, cz - 1.5, 14.6, 7, cz + 1.5)]

def fender(z1, z2):
    return [("PAINT", 9.5, 10.5, z1, 14.6, 12.5, z2), ("PAINT", 9.5, 8.5, z1, 14.6, 10.5, z1 + 2),
            ("PAINT", 9.5, 8.5, z2 - 2, 14.6, 10.5, z2), ("PAINT", 9.5, 12.5, z1 + 2, 14.2, 13.2, z2 - 2)]

ROADSTER = mirror(wheel(18) + wheel(-19) + fender(10.5, 25.5) + fender(-26.5, -11.5) + [
    ("BLACK", 11, 3.5, -11.5, 13.6, 7, 10.5),            # sills between the wheels
    ("PAINT", 9.9, 10, -10, 11, 13.5, 9),                # door tops
    ("CHROME", 11, 11.4, 1.5, 11.2, 12, 4),              # door handles
    ("LIGHT", 6.5, 7, 29.5, 10, 10, 30.6),               # headlights
    ("CHROME", 6, 6.5, 29.3, 10.5, 10.5, 30.3),
    ("TAIL", 6, 8, -30.5, 9.5, 10.2, -29.9),             # tail lights
    ("CHROME", 10.4, 13, 7, 12.6, 14.2, 8),              # wing mirrors
    ("CHROME", 10, 12.2, 7.2, 10.5, 13, 7.8),
    ("CHROME", 9, 13, 8.4, 9.6, 19.6, 9.1),              # windscreen frame
    ("METAL", 2, 4.5, -32, 5, 7.5, -30),                 # rocket nozzles
    ("BLACK", 2.6, 5.1, -32.1, 4.4, 6.9, -31.9),
]) + [
    ("BLACK", -10.5, 2, -27, 10.5, 4, 27),               # chassis
    ("PAINT", -11, 4, -28, 11, 10, 28),                  # body
    ("PAINT", -10, 10, 9, 10, 13, 27),                   # bonnet
    ("PAINT", -5, 13, 10, 5, 13.8, 26),                  # bonnet bulge
    ("STRIPE", -1.6, 13.8, 10, 1.6, 13.9, 26),           # racing stripe
    ("PAINT", -10, 4, 28, 10, 11, 30),                   # nose
    ("PAINT", -8, 5, 30, 8, 10, 31),
    ("CHROME", -5.8, 4.8, 30.95, 5.8, 10.2, 31.2),       # grille
    ("GRILLE", -5, 5.5, 31, 5, 9.5, 31.4),
    ("CHROME", -11, 3, 30, 11, 4.5, 31.6),               # bumpers
    ("CHROME", -11, 3, -31.6, 11, 4.5, -30),
    ("PAINT", -10, 10, -28, 10, 12.5, -10),              # rear deck
    ("PAINT", -10, 4, -30, 10, 11, -28),                 # tail
    ("PAINT", -5, 12.5, -18, 5, 17, -10),                # speedster fairing behind the seat
    ("PAINT", -4, 12.5, -22, 4, 15.5, -18),
    ("PAINT", -3, 12.5, -25, 3, 13.8, -22),
    ("LEATHER", -9.9, 10, -10, 9.9, 10.3, 8),            # cockpit floor
    ("LEATHER", -6, 10.3, -7, 6, 12, 2),                 # seat
    ("LEATHER", -6, 10.3, -10, 6, 19, -7),
    ("LEATHER", -5, 19, -9.6, 5, 20, -7.4),
    ("BLACK", -10, 12, 6, 10, 14, 8),                    # dashboard
    ("WHITE", -3.5, 12.4, 5.85, -1, 13.6, 6),            # dials
    ("WHITE", 1, 12.4, 5.85, 3.5, 13.6, 6),
    ("BLACK", -0.5, 11, 4.5, 0.5, 13.5, 6),              # steering column and wheel
    ("BLACK", -3, 16, 4.2, 3, 16.8, 4.8),
    ("BLACK", -3, 12, 4.2, 3, 12.8, 4.8),
    ("BLACK", -3, 12.8, 4.2, -2.2, 16, 4.8),
    ("BLACK", 2.2, 12.8, 4.2, 3, 16, 4.8),
    ("GLASS", -9, 13, 8.6, 9, 19, 8.9),                  # windscreen
    ("CHROME", -9.6, 19, 8.4, 9.6, 19.6, 9.1),
]

CAR_TINT = {"PAINT": 0, "STRIPE": 1}
CAR_TEX = {"PAINT": "paint", "STRIPE": "stripe", "TIRE": "tire", "RIM": "rim", "CHROME": "chrome", "METAL": "metal",
           "BLACK": "black", "LIGHT": "headlight", "TAIL": "taillight", "GRILLE": "grille", "LEATHER": "leather",
           "WHITE": "white", "GLASS": "glass"}
CAR_TEXTURES = {
    "paint": lambda x, y, r: gray(236 + (14 if y in (2, 3) else 0) + r.randint(-3, 3)),
    "stripe": lambda x, y, r: gray(246 + r.randint(-3, 3)),
    "tire": lambda x, y, r: gray(30 + (12 if (x + y) % 4 == 0 else 0) + r.randint(-4, 4)),
    "rim": lambda x, y, r: gray(150 + (40 if (x * x + y * y) % 7 == 0 else 0) + r.randint(-6, 6)),
    "chrome": lambda x, y, r: gray(205 + (45 if y < 5 else 0) - (35 if y > 12 else 0) + r.randint(-4, 4)),
    "metal": lambda x, y, r: gray(120 + (20 if y % 3 == 0 else 0) + r.randint(-6, 6)),
    "black": lambda x, y, r: gray(28 + r.randint(-4, 4)),
    "headlight": lambda x, y, r: (255, 250, 215 + r.randint(-8, 8)) if (x - 7.5) ** 2 + (y - 7.5) ** 2 < 42 else gray(200),
    "taillight": lambda x, y, r: (200 + r.randint(-15, 15), 20, 25),
    "grille": lambda x, y, r: gray(60 if x % 3 == 0 or y % 3 == 0 else 18),
    "leather": lambda x, y, r: (120 + r.randint(-6, 6) - (25 if x % 5 == 0 else 0), 62 + r.randint(-4, 4) - (12 if x % 5 == 0 else 0),
                                34 + r.randint(-3, 3)),
    "white": lambda x, y, r: gray(240 + r.randint(-4, 4)) if (x - 7.5) ** 2 + (y - 7.5) ** 2 < 50 else gray(25),
    "glass": TEXTURES["glass"],
}

def car_m(v):  # pixels -> model units: half size around the model's centre, which sits on the seat point's ground
    return round(v / 2 + 8, 4)

def build_roadster(write):
    for sub in ("items/vehicle", "models/vehicle", "textures/block/vehicle"):
        shutil.rmtree(os.path.join(A, sub), ignore_errors=True)
        os.makedirs(os.path.join(A, sub))
    for name, fn in CAR_TEXTURES.items():
        tex(name, fn).save(os.path.join(A, "textures/block/vehicle", name + ".png"))
    els = elements(ROADSTER, lambda r: CAR_TEX.get(r), m=car_m, tint=CAR_TINT)
    write("models/vehicle/roadster.json", model(els, "vehicle"))
    tints = [{"type": "minecraft:custom_model_data", "index": i, "default": d} for i, d in ((0, 0xCC1111), (1, 0xF4F4F4))]
    write("items/vehicle/roadster.json", {"model": {"type": "minecraft:model", "model": "helpermod:vehicle/roadster", "tints": tints}})
    print("roadster:", len(els), "boxes")

def main():
    for sub in ("items/furniture", "models/furniture", "textures/block/furniture"):
        shutil.rmtree(os.path.join(A, sub), ignore_errors=True)
        os.makedirs(os.path.join(A, sub))
    for name, fn in TEXTURES.items():
        tex(name, fn).save(os.path.join(A, "textures/block/furniture", name + ".png"))
    def write(rel, data):
        with open(os.path.join(A, rel), "w") as f:
            json.dump(data, f, separators=(",", ":"))
    for pid, parts in pieces.items():
        allp = parts + EXTRA.get(pid, [])
        body = elements(allp, lambda r: TEX.get(r) if r != "WATER" else None)
        on = elements(allp, lambda r: "water" if r == "WATER" else None)
        off = elements(allp, lambda r: OFF.get(r))
        glow = elements(allp, lambda r: GLOW.get(r))
        write(f"models/furniture/{pid}_body.json", model(body))
        has_on, has_off = bool(on), bool(off)
        if has_on: write(f"models/furniture/{pid}_on.json", model(on))
        if has_off: write(f"models/furniture/{pid}_off.json", model(off))
        if has_on or has_off:
            def comp(extra):
                return {"type": "minecraft:composite", "models": [leaf(pid + "_body")] + ([leaf(extra)] if extra else [])}
            item = {"type": "minecraft:condition", "property": "minecraft:custom_model_data", "index": 0,
                    "on_true": comp(pid + "_on" if has_on else None), "on_false": comp(pid + "_off" if has_off else None)}
        else:
            item = leaf(pid + "_body")
        write(f"items/furniture/{pid}.json", {"model": item})
        if glow:
            write(f"models/furniture/{pid}_glow.json", model(glow))
            write(f"items/furniture/{pid}_glow.json", {"model": leaf(pid + "_glow")})
    build_roadster(write)
    # The same files as a resource pack, for players who don't have the mod.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        def add(arc, data):
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
        add("pack.mcmeta", json.dumps({"pack": {"description": "Helper Buddies furniture models", "min_format": [69, 0],
                                                "max_format": 1000}}))
        for sub in ("items/furniture", "models/furniture", "textures/block/furniture",
                    "items/vehicle", "models/vehicle", "textures/block/vehicle"):
            d = os.path.join(A, sub)
            for f in sorted(os.listdir(d)):
                add(f"assets/helpermod/{sub}/{f}", open(os.path.join(d, f), "rb").read())
    data = buf.getvalue()
    open(os.path.join(RES, "helper-furniture-pack.zip"), "wb").write(data)
    print(len(pieces), "pieces;", len(data), "byte pack; sha1", hashlib.sha1(data).hexdigest())

main()
