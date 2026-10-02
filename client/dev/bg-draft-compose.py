# Дэвсгэрийн ноорог: чулуун суурь (bg-draft.svg-ийн PNG буулгалт) дээр 4 овгийн эмблемийг ТОВОЙЛГОН сийлбэр болгож шингээнэ (dev only).
#   python client/dev/bg-draft-compose.py <stone.png> <out.jpg> [plain-stone.png]
# Эмблемийн эх зураг: client/dev/bg-src/{orc.webp,human.png,nightelf.png,undead.png} (эзний өгсөн Warcraft III-ын овгийн сүлдүүд).
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

stone_path, out_path = sys.argv[1], sys.argv[2]
meta = json.load(open('client/dev/bg-draft.json', encoding='utf-8'))
stone = Image.open(stone_path).convert('RGB')
SX = stone.width / meta['w']   # буулгалтын масштаб (ихэвчлэн 1)

def mask_of(im, name):
    """Эмблемийн дүрсийн маск (0..255). Жинхэнэ alpha байвал түүгээр; үгүй бол захаас холбогдсон цайвар дэвсгэрийг (цагаан / шатрын хээ) хасна."""
    if im.mode == 'RGBA' and im.getextrema()[3][0] < 200:
        return im.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    rgb = np.asarray(im.convert('RGB')).astype(np.int16)
    mn, mx = rgb.min(axis=2), rgb.max(axis=2)
    cand = ((mx - mn) < 14) & (mn > 196)                    # цайвар, өнгөгүй = дэвсгэр байж болзошгүй
    pad = np.pad(cand, 1, constant_values=True).astype(np.uint8) * 255
    pim = Image.fromarray(pad, 'L').copy()   # fromarray нь зөвхөн-уншихтай хуваалцдаг — floodfill бичихгүй
    ImageDraw.floodfill(pim, (0, 0), 128)                   # захаас холбогдсон хэсэг л дэвсгэр
    bg = (np.asarray(pim)[1:-1, 1:-1] == 128)
    m = Image.fromarray(((~bg) * 255).astype(np.uint8), 'L')
    return m.filter(ImageFilter.MedianFilter(5))

def blur(a, r):
    return np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255

def relief(h, d):
    """Гэрэл зүүн дээрээс: баруун доош өгссөн налуу гэрэлтэй, уруудсан нь сүүдэртэй."""
    return np.roll(h, (-d, -d), (0, 1)) - np.roll(h, (d, d), (0, 1))

arr = np.asarray(stone).astype(np.float32)
for e in meta['emblems']:
    im = Image.open(f"client/dev/bg-src/{e['file']}")
    m = mask_of(im, e['file'])
    box = m.getbbox()
    im, m = im.convert('RGB').crop(box), m.crop(box)
    D = int(2 * (meta['er'] - 24) * SX * e.get('scale', 1.0))
    k = D / max(im.size)
    size = (max(1, round(im.width * k)), max(1, round(im.height * k)))
    im, m = im.resize(size, Image.LANCZOS), m.resize(size, Image.LANCZOS)
    PAD = 10
    L = np.pad(np.asarray(im.convert('L')).astype(np.float32) / 255, PAD)
    M = np.pad(np.asarray(m).astype(np.float32) / 255, PAD)
    # өндрийн зураглал: дүрс бүхэлдээ өргөгдсөн тавцан + гэрэлтэй хэсэг нь товгор, бараан зураас нь ховил
    Ln = (L - L[M > .5].min()) / max(1e-3, (L[M > .5].max() - L[M > .5].min()))
    h_detail = blur(Ln * M, 0.9)
    h_plate = blur(M, 2.2)
    shade = 3.1 * relief(blur(Ln * M, 0.6), 1) + 1.2 * relief(blur(Ln * M, 1.8), 2) + 1.7 * relief(blur(M, 1.4), 2)
    Msoft = blur(M, 1.2)
    tone = (blur(Ln * M, 1.6) - 0.5 * Msoft) * 26 + Msoft * 5        # гэрэлтэй хэсэг бага зэрэг цайвар, бараан нь бага зэрэг бараан
    delta = np.clip(shade * 128, -76, 68) + tone
    cx, cy = e['cx'] * SX, e['cy'] * SX
    x0, y0 = int(round(cx - delta.shape[1] / 2)), int(round(cy - delta.shape[0] / 2))
    ys, xs = slice(max(0, y0), min(arr.shape[0], y0 + delta.shape[0])), slice(max(0, x0), min(arr.shape[1], x0 + delta.shape[1]))
    dsub = delta[ys.start - y0: ys.stop - y0, xs.start - x0: xs.stop - x0]
    arr[ys, xs, :] += dsub[:, :, None]
    print(e['file'], size, 'at', (x0, y0))

# ── Баруун захын дүрс: bg-figure-mask.py-ийн тасдсан ЦЭВЭР дүрс (үүл/манан/тоосгүй), толин тусгалаар зүүн тийш харуулна ──
#   • доор нь хээгүй цэвэр чулуу (ижил ширхэглэл) → сийлбэрийн зураас дүрсийг нэвт гарахгүй
#   • өнгийг ҮРЖҮҮЛЖ бүдэг тавина → чулууны ширхэглэл дүрс дээгүүр хэвээр
#   • гэрэл зүүн дээрээс тусах ижил товойлгон ирмэг + дүрсийн хүрээний налуу → бусад сийлбэртэй нэг материал
fg = meta.get('figure')
if fg:
    plain = np.asarray(Image.open(sys.argv[3]).convert('RGB')).astype(np.float32) if len(sys.argv) > 3 else None
    cut = Image.open('client/dev/bg-src/medivh-cut.png').convert('LA')
    if fg.get('mirror'): cut = cut.transpose(Image.FLIP_LEFT_RIGHT)
    box = cut.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    cut = cut.crop(box)
    k = fg['height'] * SX / cut.height
    cut = cut.resize((round(cut.width * k), round(cut.height * k)), Image.LANCZOS)
    PADF = 12
    L = np.pad(np.asarray(cut.getchannel('L')).astype(np.float32) / 255, PADF)
    M = np.pad(np.asarray(cut.getchannel('A')).astype(np.float32) / 255, PADF)
    hh, ww = L.shape
    tone = np.clip((L - 0.56) * 0.50, -0.25, 0.085) * M                     # үржүүлэх коэффициент (бараан нөмрөг ~ -25%, цагаан дээл ~ +8%)
    h = M * (0.40 + 0.60 * L)
    emb = relief(blur(h, 0.8), 1) * 98 + relief(blur(h, 2.4), 2) * 44 + relief(blur(M, 1.6), 2) * 46
    emb = np.clip(emb, -58, 50)
    x0 = int(round(fg['right'] * SX - ww)); y0 = int(round(fg['bottom'] * SX - hh))
    ys, xs = slice(max(0, y0), min(arr.shape[0], y0 + hh)), slice(max(0, x0), min(arr.shape[1], x0 + ww))
    sl = (slice(ys.start - y0, ys.stop - y0), slice(xs.start - x0, xs.stop - x0))
    sub = arr[ys, xs, :]
    if plain is not None:
        mf = np.clip(blur(M, 1.0) * 1.15, 0, 1)[sl][:, :, None]
        sub = sub * (1 - mf) + plain[ys, xs, :] * mf
    arr[ys, xs, :] = sub * (1 + tone[sl][:, :, None]) + emb[sl][:, :, None]
    print('figure', (ww, hh), 'at', (x0, y0))

Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB').save(out_path, quality=90)
print('saved', out_path)
