# WarKey табын JPEG заавар зургууд: src/renderer/warkey-guide-install.jpg, warkey-guide-usage.jpg (1600×1000)
# Ажиллуулах: python scripts/make-warkey-guides.py   (Windows Segoe UI; PIL)
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

W, H = 1600, 1000
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "renderer")
def font(size, bold=True):
    for p in ([r"C:\Windows\Fonts\segoeuib.ttf", r"C:\Windows\Fonts\arialbd.ttf"] if bold else [r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf"]):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

RED, GOLD, WHITE, DIM, PANEL = (232, 60, 70), (255, 200, 50), (240, 236, 236), (170, 150, 150), (26, 14, 18)

def base(title, subtitle, brand="WARKEY"):
    img = Image.new("RGB", (W, H), (14, 8, 10))
    px = img.load()
    for y in range(H):
        for x in range(0, W, 2):
            v = (int(20 + 22 * (y / H) + 6 * (x / W)), int(7 + 4 * (y / H)), int(10 + 5 * (y / H)))
            px[x, y] = v; px[min(x + 1, W - 1), y] = v
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([24, 24, W - 24, H - 24], radius=40, outline=(200, 60, 70), width=5)
    d.text((70, 52), "GARENA.MN", font=font(30), fill=RED)
    d.text((70 + d.textlength("GARENA.MN", font=font(30)) + 14, 56), brand, font=font(26), fill=GOLD)
    d.text((70, 96), title, font=font(60), fill=WHITE)
    d.text((72, 172), subtitle, font=font(26, False), fill=DIM)
    return img, d

def wrap(d, f, text, maxw):
    lines, cur = [], []
    for w in text.split():
        if d.textlength(" ".join(cur + [w]), font=f) <= maxw: cur.append(w)
        else: lines.append(" ".join(cur)); cur = [w]
    if cur: lines.append(" ".join(cur))
    return lines

def steps(img, d, items, top=230, cols=2):
    n = len(items); rows = (n + cols - 1) // cols
    cw = (W - 140 - (cols - 1) * 24) // cols
    ch = (H - top - 60 - (rows - 1) * 20) // rows
    ft, fb = font(30), font(23, False)
    for i, (t, body) in enumerate(items):
        r, c = divmod(i, cols)
        x0 = 70 + c * (cw + 24); y0 = top + r * (ch + 20)
        d.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=22, fill=PANEL, outline=(120, 40, 48), width=2)
        d.ellipse([x0 + 20, y0 + 20, x0 + 76, y0 + 76], fill=RED)
        num = str(i + 1); d.text((x0 + 48 - d.textlength(num, font=font(30)) / 2, y0 + 30), num, font=font(30), fill=WHITE)
        d.text((x0 + 92, y0 + 28), t, font=ft, fill=GOLD)
        y = y0 + 80
        for ln in wrap(d, fb, body, cw - 40):
            d.text((x0 + 22, y), ln, font=fb, fill=WHITE); y += 32

img, d = base("Суулгах заавар", "GarenaWarKey.exe — суулгац шаардлагагүй, шууд нээгддэг · Windows 10/11")
steps(img, d, [
    ("Татах", "Платформын WarKey таб дээрх «WarKey татах» товч дарна (эсвэл garenamn.up.railway.app → WarKey). GarenaWarKey.exe (~70MB) татагдана."),
    ("SmartScreen", "«Windows protected your PC» гарвал More info → Run anyway. Хөтөч «Keep» асуувал Keep. Энэ нь шинэ програм тул гардаг анхааруулга, вирус биш."),
    ("Админ эрхээр нээх", "Файл дээр баруун товч → Run as administrator. WC3 админ эрхээр ажилладаг бол skill-ийн үсгийг унших, солиход энэ ЗААВАЛ."),
    ("Discord-оор нэвтрэх", "Хөтөч нээгдэж Discord-оор нэвтэрнэ — платформтой ижил акаунт. Нэг удаа нэвтэрсний дараа санана."),
    ("Эрх", "GarenaSystem тэмцээний түүхтэй бол хаана ч (GameRanger, PC төв) ажиллана. Бусад хэрэглэгч Garena.mn платформ нээлттэй үед л ашиглана."),
    ("Tray-д ажиллана", "Цонхыг хаахад доод булангийн tray-д үргэлжлэн ажиллана. Тоглоомоо нээгээд л болно — шинэчлэлт автоматаар татагдана."),
])
img.save(os.path.join(OUT, "warkey-guide-install.jpg"), "JPEG", quality=88, optimize=True)

img, d = base("Хэрэглэх заавар", "Inventory · Skills · QuickChat · тоглоом дотор Ctrl+F6 overlay")
steps(img, d, [
    ("Inventory 2×3", "Слот дээр дараад өөрийн товчоо дарна (үсэг, Tab, Mouse4/5, дугуй ↑↓ ч болно). Тоглоомын Num7 Num8 / Num4 Num5 / Num1 Num2 товчнууд таны товч руу шилжинэ. Backspace = арилгах."),
    ("QuickChat", "Товч + мессеж нэмнэ (жишээ: F2 → «gg wp»). Нэг товчинд хэд хэдэн мессеж бичвэл дарааллаар илгээнэ. Чат нээлттэй үед remap түр зогсдог."),
    ("Skills (hero сонгосны дараа)", "Тоглолт эхэлж hero-гоо сонгомогц Skills жагсаалт гарна. Skill бүрд өөрийн үсгээ өгнө — тоглоом дотор шууд солигдоно."),
    ("Ctrl+F6 — тоглоом дотор", "Цонхоо хаалгүй, яг тоглож байхдаа Ctrl+F6 дарна: overlay гарч skill + item жагсаалтыг харуулна. Slot-ын дугаарыг дараад шинэ үсгээ дарна."),
    ("Хаах", "Дахин Ctrl+F6 (эсвэл Esc) дарахад overlay хаагдаж тоглоом үргэлжилнэ. Alt-tab, restart хэрэггүй."),
    ("Тайлбар", "Skill-ийн үсэг тоглолт бүрд шинээр тааруулагдана (өмнөх тоглолтоос дамжихгүй). Асуудал гарвал WarKey-г Run as administrator-оор нээгээрэй."),
])
img.save(os.path.join(OUT, "warkey-guide-usage.jpg"), "JPEG", quality=88, optimize=True)
print("OK guides")
