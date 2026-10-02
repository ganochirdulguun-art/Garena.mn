# Medivh-ийн зургаас ЗӨВХӨН ДҮРСИЙГ тасдаж авна (үүл, манан, тоос, хэлтэрхийгүй) — dev only.
#   pip install rembg onnxruntime   (анх ажиллахад загвараа ~/.u2net руу татна)
#   python client/dev/bg-figure-mask.py [model] [debug.png]  → client/dev/bg-src/medivh-cut.png (LA: гэрэлтэлт + alpha)
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from rembg import new_session, remove

model = sys.argv[1] if len(sys.argv) > 1 else 'isnet-general-use'
src = Image.open('client/dev/bg-src/medivh.webp').convert('RGB')
W0, H0 = src.size
TOP, BOT = int(H0 * 0.085), int(H0 * 0.872)       # хэрээний толгойноос хормой хүртэл (доод газар/бичээсгүй)
im = src.crop((0, TOP, W0, BOT))
mask = remove(im, session=new_session(model), only_mask=True, post_process_mask=True)
a = np.asarray(mask.convert('L')).astype(np.float32) / 255

def to_img(b): return Image.fromarray((np.clip(b, 0, 1) * 255).astype(np.uint8), 'L')
# жижиг тасархай хэсгүүдийг (тоос, хэлтэрхий) хасна: юүдэн/цээжнээс холбогдсон хэсэг л үлдэнэ
hard = to_img(a > 0.5).filter(ImageFilter.MaxFilter(5)).copy()
for (x, y) in [(455, 440 - TOP), (430, 520 - TOP), (420, 900 - TOP), (690, 250 - TOP)]:
    if hard.getpixel((x, y)) == 255: ImageDraw.floodfill(hard, (x, y), 128)
keep = (np.asarray(hard) == 128)
a = a * keep
# дээл/нөмрөгийн доторх цоорхойг дүүргэнэ (доод ирмэг рүү нээлттэйг ч — хормойн доор түр хана тавьж)
from scipy import ndimage as ndi
solid = a > 0.5
cols = np.where(solid[-40:].any(axis=0))[0]
tmp = solid.copy()
if len(cols): tmp[-1, cols.min():cols.max() + 1] = True
filled = ndi.binary_fill_holes(ndi.binary_closing(tmp, iterations=3))
filled[-1, :] = filled[-1, :] & solid[-1, :] | filled[-2, :]
a = np.maximum(a, filled.astype(np.float32))
# хормойн доод ирмэг зөөлөн уусна
fade = np.clip((a.shape[0] - np.arange(a.shape[0])) / (a.shape[0] * 0.035), 0, 1)[:, None]
a = a * fade
alpha = to_img(a).filter(ImageFilter.GaussianBlur(0.8))
Image.merge('LA', (im.convert('L'), alpha)).save('client/dev/bg-src/medivh-cut.png')
print('saved medivh-cut.png', im.size, model, 'coverage', round(float((a > 0.5).mean()), 3))
if len(sys.argv) > 2:
    L = np.asarray(im.convert('L')).astype(np.float32)
    dbg = np.stack([L, L, L], axis=2)
    m = (np.asarray(alpha).astype(np.float32) / 255)[:, :, None]
    dbg = dbg * m + (dbg * 0.25 + np.array([150, 40, 160]) * 0.75) * (1 - m)      # хасагдсан хэсэг = ягаан
    Image.fromarray(dbg.astype(np.uint8), 'RGB').resize((im.width // 2, im.height // 2)).save(sys.argv[2])
