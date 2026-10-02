# Цайвар горимын дэвсгэр зургийн НООРОГ үүсгэгч (dev only) — чулуун сийлбэр:
#   зүүн талд угалзтай хөвөө + rune багана + өнцөгт сийлбэр; баруун доод талд медальон:
#   rune-ын цагираг → тоосгон цагираг → алхан хээ → дотор нь 4 овгийн (Orc / Human / Night Elf / Undead) бэлгэдэл.
#   Бэлгэдлүүд нь өөрсдийн зурсан ерөнхий дүрслэл (сүх+соёо, бамбай+сэлэм, хавирган сар+навч, гавал+титэм) — албан ёсны лого биш.
#   python client/dev/bg-draft-gen.py [light|mid|dim]   → client/dev/bg-draft.svg
import math, random, sys

W, H = 1920, 1080
TONES = {
    'light': ('#dfe2e6', '#cfd3d9', 0.30, 0.26),
    'mid':   ('#d0d4da', '#bcc1c9', 0.36, 0.30),
    'dim':   ('#c1c6cd', '#abb1ba', 0.40, 0.34),
}
tone = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in TONES else 'mid'
C1, C2, SH, HL = TONES[tone]
random.seed(7)
out = []
A = out.append

def P(pts, close=False):
    return 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts) + (' Z' if close else '')

def smooth(pts):
    d = f'M{pts[0][0]:.1f},{pts[0][1]:.1f}'
    for i in range(1, len(pts) - 1):
        mx, my = (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2
        d += f' Q{pts[i][0]:.1f},{pts[i][1]:.1f} {mx:.1f},{my:.1f}'
    return d + f' L{pts[-1][0]:.1f},{pts[-1][1]:.1f}'

def circle(cx, cy, r):
    return f'M{cx - r:.1f},{cy:.1f} A{r},{r} 0 1 0 {cx + r:.1f},{cy:.1f} A{r},{r} 0 1 0 {cx - r:.1f},{cy:.1f}'

orn = []    # гол сийлбэр (d, stroke-width)
fine = []   # нарийн сийлбэр (газрын зураг г.м.)

# ── Rune тэмдэгтүүд (эртний Futhark маягийн өнцөгт зураасууд; нэгж хайрцаг 1 × 1.6) ──
RUNES = [
    [[(.2, 0), (.2, 1.6)], [(.2, .3), (.8, 0)], [(.2, .75), (.8, .45)]],
    [[(.2, 1.6), (.2, 0), (.8, .55), (.8, 1.6)]],
    [[(.2, 0), (.2, 1.6)], [(.2, .4), (.78, .8), (.2, 1.2)]],
    [[(.2, 1.6), (.2, 0), (.8, .4)], [(.2, .5), (.8, .9)]],
    [[(.2, 1.6), (.2, 0), (.76, .36), (.2, .76), (.8, 1.6)]],
    [[(.76, .2), (.26, .8), (.76, 1.4)]],
    [[(.1, 0), (.9, 1.6)], [(.9, 0), (.1, 1.6)]],
    [[(.2, 1.6), (.2, 0), (.76, .4), (.2, .8)]],
    [[(.2, 0), (.2, 1.6)], [(.8, 0), (.8, 1.6)], [(.2, .6), (.8, 1.0)]],
    [[(.5, 0), (.5, 1.6)], [(.2, .6), (.8, 1.0)]],
    [[(.5, 0), (.5, 1.6)], [(.5, 0), (.82, .36)], [(.5, 1.6), (.18, 1.24)]],
    [[(.2, 0), (.2, 1.6)], [(.2, 0), (.5, .3), (.8, 0)], [(.2, 1.6), (.5, 1.3), (.8, 1.6)]],
    [[(.5, 1.6), (.5, 0)], [(.5, .72), (.14, .1)], [(.5, .72), (.86, .1)]],
    [[(.76, 0), (.26, .5), (.76, 1.0), (.26, 1.6)]],
    [[(.5, 1.6), (.5, 0)], [(.14, .42), (.5, 0), (.86, .42)]],
    [[(.2, 0), (.2, 1.6)], [(.2, 0), (.76, .4), (.2, .8), (.76, 1.2), (.2, 1.6)]],
    [[(.2, 1.6), (.2, 0), (.8, .6)], [(.8, 1.6), (.8, 0), (.2, .6)]],
    [[(.3, 1.6), (.3, 0), (.8, .46)]],
    [[(.2, 1.6), (.8, .9), (.5, .5), (.2, .9), (.8, 1.6)]],
    [[(.2, 0), (.2, 1.6)], [(.8, 0), (.8, 1.6)], [(.2, 0), (.8, 1.6)], [(.8, 0), (.2, 1.6)]],
    [[(.5, 0), (.5, 1.6)], [(.5, .5), (.84, .9)], [(.5, .5), (.16, .9)]],
    [[(.2, .3), (.5, 0), (.8, .3), (.5, .6), (.2, .3)], [(.5, .6), (.5, 1.6)]],
]

def rune_at(idx, ox, oy, s):
    """Шулуун байрлалтай rune: (ox, oy) зүүн дээд булан, s = нэгжийн хэмжээ."""
    return ' '.join(P([(ox + x * s, oy + y * s) for x, y in st]) for st in RUNES[idx % len(RUNES)])

# ── 1. Угалзын хэлбэр ──
def ugalz(cx, cy, s=1.0, flip=1):
    d = []
    for sx in (-1, 1):
        k = sx * s
        d.append(f'M{cx:.1f},{cy + 46 * s * flip:.1f} '
                 f'C{cx + 10 * k:.1f},{cy + 20 * s * flip:.1f} {cx + 44 * k:.1f},{cy + 26 * s * flip:.1f} {cx + 44 * k:.1f},{cy - 2 * s * flip:.1f} '
                 f'C{cx + 44 * k:.1f},{cy - 30 * s * flip:.1f} {cx + 10 * k:.1f},{cy - 34 * s * flip:.1f} {cx + 8 * k:.1f},{cy - 12 * s * flip:.1f} '
                 f'C{cx + 7 * k:.1f},{cy + 2 * s * flip:.1f} {cx + 26 * k:.1f},{cy + 4 * s * flip:.1f} {cx + 25 * k:.1f},{cy - 9 * s * flip:.1f}')
    d.append(f'M{cx:.1f},{cy - 46 * s * flip:.1f} C{cx + 9 * s:.1f},{cy - 34 * s * flip:.1f} {cx + 9 * s:.1f},{cy - 26 * s * flip:.1f} {cx:.1f},{cy - 20 * s * flip:.1f} '
             f'C{cx - 9 * s:.1f},{cy - 26 * s * flip:.1f} {cx - 9 * s:.1f},{cy - 34 * s * flip:.1f} {cx:.1f},{cy - 46 * s * flip:.1f} Z')
    return ' '.join(d)

# ── 2. Зүүн захын нарийн хос зураас (агуулгын захын зайд багтана) ──
for x in (12, 20):
    orn.append((P([(x, -10), (x, H + 10)]), 1.8))

# ── 3. Зүүн доод булангийн rune цагираг (дөрөвний нэг) + угалз ──
QX, QY = 0, H
for r, w in ((470, 3.2), (459, 1.6), (392, 2.4), (382, 1.4), (300, 2.2), (291, 1.2)):
    orn.append((circle(QX, QY, r), w))
NQ = 44
for n in range(NQ):
    a = (n + 0.5) / NQ * 2 * math.pi
    if not (-math.pi / 2 - 0.05 < a - 2 * math.pi < 0.05): continue   # зөвхөн баруун дээд дөрөвний нэг (дэлгэцэнд харагдах)
    er = (math.cos(a), math.sin(a)); et = (-math.sin(a), math.cos(a))
    sc = 26.0
    d = []
    for st in RUNES[(n * 5 + 1) % len(RUNES)]:
        pts = []
        for (gx, gy) in st:
            rad = 425 + (0.8 - gy) * sc
            tan = (gx - 0.5) * sc
            pts.append((QX + er[0] * rad + et[0] * tan, QY + er[1] * rad + et[1] * tan))
        d.append(P(pts))
    orn.append((' '.join(d), 2.8))
NQB = 40
for n in range(NQB):
    a = n / NQB * 2 * math.pi
    orn.append((P([(QX + 303 * math.cos(a), QY + 303 * math.sin(a)), (QX + 379 * math.cos(a), QY + 379 * math.sin(a))]), 1.8))
orn.append((ugalz(118, H - 118, 1.5, 1), 3.0))

# ── 3b. Доод хөвөө: угалз + rune мөр (медальон хүртэл) ──
BAND_END = 486
for y in (H - 92, H - 84, H - 14, H - 6):
    if BAND_END > 520: orn.append((P([(486, y), (BAND_END, y)]), 2.0))   # зай байхгүй бол хөвөөгүй
x, i = 560, 0
while x < BAND_END - 40:
    orn.append((ugalz(x, H - 49, 0.62, 1 if i % 2 == 0 else -1), 2.2))
    orn.append((P([(x + 62, H - 57), (x + 70, H - 49), (x + 62, H - 41), (x + 54, H - 49)], True), 1.6))
    x += 124; i += 1

# ── 4. Медальон ──
CX, CY = 1110, 690
R_OUT = 630
for r, w in ((R_OUT, 3.6), (R_OUT - 12, 1.8), (548, 2.6), (536, 1.4), (500, 1.4), (488, 2.4), (430, 2.2), (420, 1.4)):
    orn.append((circle(CX, CY, r), w))

# 4a. Rune-ын цагираг (r 560–608): тэмдэгтийн «дээд» тал гадагш харна
NR = 46
for n in range(NR):
    a = (n + 0.5) / NR * 2 * math.pi
    er = (math.cos(a), math.sin(a)); et = (-math.sin(a), math.cos(a))
    s = 30.0   # нэгж; өндөр = 1.6 * s = 48
    d = []
    for st in RUNES[(n * 7 + 3) % len(RUNES)]:
        pts = []
        for (gx, gy) in st:
            rad = 584 + (0.8 - gy) * s
            tan = (gx - 0.5) * s
            pts.append((CX + er[0] * rad + et[0] * tan, CY + er[1] * rad + et[1] * tan))
        d.append(P(pts))
    orn.append((' '.join(d), 3.2))
    # rune хоорондын цэг
    a2 = n / NR * 2 * math.pi
    px, py = CX + 584 * math.cos(a2), CY + 584 * math.sin(a2)
    orn.append((P([(px - 3, py), (px, py - 3), (px + 3, py), (px, py + 3)], True), 1.6))

# 4b. Тоосгон цагираг (r 500–536): богино хөндлөн зураасаар хуваасан блокууд
NB = 60
for n in range(NB):
    a = n / NB * 2 * math.pi
    orn.append((P([(CX + 503 * math.cos(a), CY + 503 * math.sin(a)), (CX + 533 * math.cos(a), CY + 533 * math.sin(a))]), 2.2))

# 4c. Алхан хээ (r 436–482)
N = 64
R0, R1 = 438, 480
def polar(t, v):
    a = t * 2 * math.pi
    r = R1 - v * (R1 - R0)
    return CX + r * math.cos(a), CY + r * math.sin(a)
key = [(0.0, 1.0), (0.0, 0.0), (0.78, 0.0), (0.78, 0.72), (0.30, 0.72), (0.30, 0.36), (0.54, 0.36)]
for n in range(N):
    pts = [((n + u * 0.86 + 0.07) / N, v) for (u, v) in key]
    dense = []
    for (a, b) in zip(pts, pts[1:]):
        steps = 6 if abs(a[0] - b[0]) > 1e-9 else 1
        for s in range(steps):
            t = s / steps
            dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    dense.append(pts[-1])
    orn.append((P([polar(t, v) for t, v in dense]), 2.0))

# 4d. Дөрвөн овгийн бэлгэдэл (тус бүр давхар цагирагтай «тамга») + голын луужин од
EMB = 202   # төвөөс бэлгэдлийн төв хүртэл
ER = 130    # тамганы радиус
def T(d_pts, ox, oy, s=1.0):
    return [(ox + x * s, oy + y * s) for x, y in d_pts]

def emb_orc(ox, oy, s):
    d = []
    def rot(pts, deg, mirror=1):
        a = math.radians(deg); c, sn = math.cos(a), math.sin(a)
        return [(ox + (x * mirror * c - y * sn) * s, oy + (x * mirror * sn + y * c) * s) for x, y in pts]
    def bez(p0, p1, p2, p3, n=10):
        return [((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0],
                 (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1]) for t in [k / n for k in range(n + 1)]]
    for deg, m in ((-33, -1), (33, 1)):
        d.append(P(rot([(-4, -70), (-4, 88), (4, 88), (4, -70)], deg, m)))                          # иш
        d.append(P(rot([(-7, 70), (7, 70)], deg, m)) + ' ' + P(rot([(-7, 78), (7, 78)], deg, m)))  # ороолт
        blade = [(4, -84), (40, -98)] + bez((40, -98), (70, -80), (70, -38), (40, -20)) + [(4, -34)]
        d.append(P(rot(blade, deg, m), True))                                                       # ир (гадна тал руу)
        d.append(P(rot(bez((22, -82), (46, -74), (46, -44), (22, -36)), deg, m)))                    # ирний ховил
        d.append(P(rot([(-4, -84), (-16, -90), (-16, -30), (-4, -34)], deg, m)))                     # ар талын хошуу
    for k in (-1, 1):                                                                               # хос соёо
        d.append(f'M{ox + 5 * k * s:.1f},{oy + 92 * s:.1f} C{ox + 24 * k * s:.1f},{oy + 88 * s:.1f} {ox + 30 * k * s:.1f},{oy + 66 * s:.1f} {ox + 18 * k * s:.1f},{oy + 46 * s:.1f} '
                 f'C{ox + 17 * k * s:.1f},{oy + 62 * s:.1f} {ox + 12 * k * s:.1f},{oy + 72 * s:.1f} {ox + 4 * k * s:.1f},{oy + 76 * s:.1f}')
    return ' '.join(d)

def emb_human(ox, oy, s):
    d = []
    d.append(f'M{ox - 74 * s:.1f},{oy - 84 * s:.1f} L{ox + 74 * s:.1f},{oy - 84 * s:.1f} L{ox + 74 * s:.1f},{oy + 6 * s:.1f} '
             f'C{ox + 74 * s:.1f},{oy + 56 * s:.1f} {ox + 34 * s:.1f},{oy + 84 * s:.1f} {ox:.1f},{oy + 98 * s:.1f} '
             f'C{ox - 34 * s:.1f},{oy + 84 * s:.1f} {ox - 74 * s:.1f},{oy + 56 * s:.1f} {ox - 74 * s:.1f},{oy + 6 * s:.1f} Z')              # бамбай
    d.append(f'M{ox - 60 * s:.1f},{oy - 70 * s:.1f} L{ox + 60 * s:.1f},{oy - 70 * s:.1f} L{ox + 60 * s:.1f},{oy + 4 * s:.1f} '
             f'C{ox + 60 * s:.1f},{oy + 46 * s:.1f} {ox + 28 * s:.1f},{oy + 70 * s:.1f} {ox:.1f},{oy + 82 * s:.1f} '
             f'C{ox - 28 * s:.1f},{oy + 70 * s:.1f} {ox - 60 * s:.1f},{oy + 46 * s:.1f} {ox - 60 * s:.1f},{oy + 4 * s:.1f} Z')              # дотор хүрээ
    d.append(P(T([(-7, -34), (-7, 44), (0, 62), (7, 44), (7, -34)], ox, oy, s)))                 # ир
    d.append(P(T([(0, -34), (0, 50)], ox, oy, s)))                                              # ховил
    d.append(P(T([(-34, -34), (34, -34), (34, -42), (-34, -42)], ox, oy, s), True))              # хамгаалалт
    d.append(P(T([(-5, -42), (-5, -58), (5, -58), (5, -42)], ox, oy, s)))                        # бариул
    d.append(circle(ox, oy - 62 * s, 6 * s))                                                    # толгой
    return ' '.join(d)

def emb_nightelf(ox, oy, s):
    d = []
    d.append(f'M{ox + 34 * s:.1f},{oy - 86 * s:.1f} A{92 * s:.1f},{92 * s:.1f} 0 1 0 {ox + 34 * s:.1f},{oy + 86 * s:.1f} '
             f'A{72 * s:.1f},{72 * s:.1f} 0 1 1 {ox + 34 * s:.1f},{oy - 86 * s:.1f} Z')                                                     # хавирган сар
    lx = ox + 26 * s                                                                             # навч
    d.append(f'M{lx:.1f},{oy - 58 * s:.1f} C{lx + 40 * s:.1f},{oy - 22 * s:.1f} {lx + 34 * s:.1f},{oy + 30 * s:.1f} {lx:.1f},{oy + 60 * s:.1f} '
             f'C{lx - 34 * s:.1f},{oy + 30 * s:.1f} {lx - 40 * s:.1f},{oy - 22 * s:.1f} {lx:.1f},{oy - 58 * s:.1f} Z')
    d.append(P([(lx, oy - 44 * s), (lx, oy + 74 * s)]))
    for k, yy in enumerate((-18, 4, 26)):
        d.append(P([(lx, oy + (yy + 14) * s), (lx + (22 - k * 3) * s, oy + (yy - 4) * s)]))
        d.append(P([(lx, oy + (yy + 14) * s), (lx - (22 - k * 3) * s, oy + (yy - 4) * s)]))
    # жижиг одод
    for (sx, sy, r) in ((-52, -34, 5), (-62, 8, 4), (-48, 44, 5)):
        x, y2 = ox + sx * s, oy + sy * s
        d.append(P([(x - r * s, y2), (x, y2 - r * s), (x + r * s, y2), (x, y2 + r * s)], True))
    return ' '.join(d)

def emb_undead(ox, oy, s):
    d = []
    d.append(f'M{ox - 56 * s:.1f},{oy - 4 * s:.1f} C{ox - 58 * s:.1f},{oy - 66 * s:.1f} {ox + 58 * s:.1f},{oy - 66 * s:.1f} {ox + 56 * s:.1f},{oy - 4 * s:.1f} '
             f'C{ox + 56 * s:.1f},{oy + 22 * s:.1f} {ox + 42 * s:.1f},{oy + 32 * s:.1f} {ox + 32 * s:.1f},{oy + 40 * s:.1f} L{ox + 32 * s:.1f},{oy + 66 * s:.1f} '
             f'L{ox - 32 * s:.1f},{oy + 66 * s:.1f} L{ox - 32 * s:.1f},{oy + 40 * s:.1f} C{ox - 42 * s:.1f},{oy + 32 * s:.1f} {ox - 56 * s:.1f},{oy + 22 * s:.1f} {ox - 56 * s:.1f},{oy - 4 * s:.1f} Z')   # гавал
    for k in (-1, 1):                                                                            # нүдний хонхор
        ex = ox + 24 * k * s
        d.append(f'M{ex - 15 * s:.1f},{oy - 2 * s:.1f} C{ex - 15 * s:.1f},{oy - 22 * s:.1f} {ex + 15 * s:.1f},{oy - 22 * s:.1f} {ex + 15 * s:.1f},{oy - 2 * s:.1f} '
                 f'C{ex + 15 * s:.1f},{oy + 14 * s:.1f} {ex - 15 * s:.1f},{oy + 14 * s:.1f} {ex - 15 * s:.1f},{oy - 2 * s:.1f} Z')
    d.append(P(T([(0, 16), (-8, 32), (8, 32)], ox, oy, s), True))                                # хамар
    for x in (-16, 0, 16):
        d.append(P(T([(x, 46), (x, 66)], ox, oy, s)))                                            # шүд
    d.append(P(T([(-32, 46), (32, 46)], ox, oy, s)))
    d.append(P(T([(-54, -50), (-46, -92), (-26, -62), (0, -100), (26, -62), (46, -92), (54, -50)], ox, oy, s)))   # мөсөн титэм
    d.append(P(T([(-50, -44), (50, -44)], ox, oy, s)))
    return ' '.join(d)

EMBLEMS = [('orc.webp', -1, -1, 0.97), ('human.png', 1, -1, 1.0), ('nightelf.png', -1, 1, 0.96), ('undead.png', 1, 1, 1.0)]
emb_centers = []
emb_meta = []
for fname, kx, ky, sc in EMBLEMS:
    ex, ey = CX + kx * EMB, CY + ky * EMB
    emb_centers.append((ex, ey))
    emb_meta.append({'file': fname, 'cx': ex, 'cy': ey, 'scale': sc})
    orn.append((circle(ex, ey, ER), 2.6))
    orn.append((circle(ex, ey, ER - 8), 1.4))
import json
json.dump({'w': W, 'h': H, 'er': ER, 'emblems': emb_meta, 'figure': {'file': 'medivh.webp', 'mirror': True, 'height': 600, 'right': 1914, 'bottom': 1088}}, open('client/dev/bg-draft.json', 'w', encoding='utf-8'))
# голын луужин од (4 урт, 4 богино хошуу) + тамгануудыг холбосон ромбо
star = []
for k in range(8):
    a = k * math.pi / 4
    L = 68 if k % 2 == 0 else 36
    a1, a2 = a - 0.32, a + 0.32
    star.append(P([(CX + 18 * math.cos(a1), CY + 18 * math.sin(a1)), (CX + L * math.cos(a), CY + L * math.sin(a)), (CX + 18 * math.cos(a2), CY + 18 * math.sin(a2))]))
orn.append((' '.join(star), 2.2))
orn.append((circle(CX, CY, 18), 2.0))
orn.append((circle(CX, CY, 80), 1.4))
# тамгануудын хоорондох богино rune бичээс (дээд, доод, зүүн, баруун)
for (dx, dy) in ((0, -EMB), (0, EMB), (-EMB, 0), (EMB, 0)):
    for j in (-1, 0, 1):
        if dx == 0: orn.append((rune_at(abs(dy) // 7 + j * 3 + (5 if dy > 0 else 0), CX + j * 30 - 11, CY + dy - 18, 22), 2.4))
        else: orn.append((rune_at(abs(dx) // 5 + j * 4 + (9 if dx > 0 else 0), CX + dx - 11, CY + j * 44 - 18, 22), 2.4))

# ── 5. Медальон доторх зохиомол газрын зураг (тамга, одноос зайтай, нимгэн) ──
def free(x, y, pad=0):
    if (x - CX) ** 2 + (y - CY) ** 2 > (405 - pad) ** 2: return False
    if (x - CX) ** 2 + (y - CY) ** 2 < (92 + pad) ** 2: return False
    return all((x - ex) ** 2 + (y - ey) ** 2 > (ER + 14 + pad) ** 2 for ex, ey in emb_centers)
for k in range(140):
    x, y2 = CX + random.uniform(-400, 400), CY + random.uniform(-400, 400)
    if not free(x, y2, 16): continue
    s = random.uniform(9, 15)
    fine.append((P([(x - s, y2 + s * 0.7), (x, y2 - s * 0.6), (x + s, y2 + s * 0.7)]) + ' ' + P([(x + s * 0.45, y2 + s * 0.7), (x + s * 1.1, y2 - s * 0.1), (x + s * 1.8, y2 + s * 0.7)]), 1.8))

def layer(dx, dy, color, items):
    g = f'<g transform="translate({dx},{dy})" fill="none" stroke="{color}" stroke-linecap="round" stroke-linejoin="round">'
    return g + ''.join(f'<path d="{d}" stroke-width="{w}"/>' for d, w in items) + '</g>'

A(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice">')
A(f'''<defs>
  <linearGradient id="base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C1}"/><stop offset="1" stop-color="{C2}"/></linearGradient>
  <radialGradient id="disc" cx=".42" cy=".38" r=".75"><stop offset="0" stop-color="#ffffff" stop-opacity=".34"/><stop offset="1" stop-color="#ffffff" stop-opacity=".05"/></radialGradient>
  <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".15"/></linearGradient>
  <radialGradient id="seal" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></radialGradient>
  <radialGradient id="vig" cx=".5" cy=".45" r=".8"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".11"/></radialGradient>
  <linearGradient id="band" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".08"/><stop offset=".5" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".07"/></linearGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" seed="4"/><feColorMatrix type="matrix" values="0 0 0 0 .28  0 0 0 0 .30  0 0 0 0 .34  .7 0 0 0 -.16"/></filter>
  <filter id="mottle" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".0045 .007" numOctaves="4" seed="11" result="t"/><feDiffuseLighting in="t" surfaceScale="9" diffuseConstant="1.05" lighting-color="#ffffff"><feDistantLight azimuth="225" elevation="62"/></feDiffuseLighting></filter>
  <filter id="rough" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".05 .07" numOctaves="4" seed="23" result="t"/><feDiffuseLighting in="t" surfaceScale="2.6" diffuseConstant="1.08" lighting-color="#ffffff"><feDistantLight azimuth="225" elevation="58"/></feDiffuseLighting></filter>
  <filter id="soft"><feGaussianBlur stdDeviation="0.45"/></filter>
</defs>''')
A(f'<rect width="{W}" height="{H}" fill="url(#base)"/>')
A(f'<rect width="{W}" height="{H}" filter="url(#mottle)" opacity=".42" style="mix-blend-mode:multiply"/>')
A(f'<rect x="486" y="{H - 92}" width="{BAND_END - 486}" height="86" fill="#000" opacity=".05"/>')
A(f'<circle cx="0" cy="{H}" r="470" fill="url(#ring)"/>')
A(f'<circle cx="0" cy="{H}" r="300" fill="url(#disc)"/>')
PLAIN_AT = len(out)   # эндээс хойших хээ/дүүргэлт «цэвэр чулуу» хувилбарт орохгүй
A(f'<circle cx="{CX}" cy="{CY}" r="{R_OUT}" fill="url(#ring)"/>')
A(f'<circle cx="{CX}" cy="{CY}" r="548" fill="#000" opacity=".05"/>')
A(f'<circle cx="{CX}" cy="{CY}" r="488" fill="#fff" opacity=".06"/>')
A(f'<circle cx="{CX}" cy="{CY}" r="420" fill="url(#disc)"/>')
for ex, ey in emb_centers:
    A(f'<circle cx="{ex}" cy="{ey}" r="{ER}" fill="url(#seal)"/>')
A('<g filter="url(#soft)">')
A(layer(1.4, 1.4, f'rgba(255,255,255,{HL + .22:.2f})', fine))
A(layer(0, 0, f'rgba(70,78,92,{SH - .14:.2f})', fine))
A('</g>')
# сийлбэр: гэрэл зүүн дээрээс — ховилын зүүн дээд ирмэг сүүдэр, баруун доод ирмэг гэрэл
A(layer(1.9, 1.9, f'rgba(255,255,255,{HL + .42:.2f})', orn))
A(layer(-1.3, -1.3, f'rgba(36,42,54,{SH:.2f})', orn))
A(layer(0, 0, 'rgba(92,100,114,.38)', orn))
PLAIN_TO = len(out)
A(f'<rect width="{W}" height="{H}" filter="url(#rough)" opacity=".30" style="mix-blend-mode:multiply"/>')
A(f'<rect width="{W}" height="{H}" filter="url(#grain)" opacity=".62"/>')
A(f'<rect width="{W}" height="{H}" fill="url(#vig)"/>')
A('</svg>')
open('client/dev/bg-draft.svg', 'w', encoding='utf-8').write('\n'.join(out))
open('client/dev/bg-draft-plain.svg', 'w', encoding='utf-8').write('\n'.join(out[:PLAIN_AT] + out[PLAIN_TO:]))
print('ok', tone, sum(len(s) for s in out))
