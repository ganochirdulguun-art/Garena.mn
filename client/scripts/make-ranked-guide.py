# Ranked табын JPEG заавар: src/renderer/ranked-guide.jpg (1600×1000) + WarKey апп зургийг клиентэд шахаж хуулна
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFont
import importlib.util
spec = importlib.util.spec_from_file_location("g", os.path.join(os.path.dirname(__file__), "make-warkey-guides.py"))
# make-warkey-guides.py-г import хийхэд зургууд дахин үүснэ (хямд) — base/steps функцээ дахин ашиглана
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

img, d = g.base("Ranked — тоглонгоо Diamond олборло", "Үнэгүй · хүчинтэй хожил бүрд +2 Diamond · дүн relay серверээс автоматаар · бот хост, replay хэрэггүй", brand="RANKED")
g.steps(img, d, [
    ("Ranked өрөө үүсгэ", "«Өрөө үүсгэх» дарахдаа «Ranked өрөө» checkbox-ийг сонго. Өрөөний жагсаалтад Ranked тэмдэгтэй харагдана."),
    ("6+ тоглогч (3v3+)", "Хоёр багт тус бүр дор хаяж 3 тоглогч платформоор «Нэгдэх» дарж орно. 1v1, 2v2 тоглолт Diamond өгөхгүй."),
    ("LAN тоглоом нээ", "Хост «LAN тоглоом нээх» → WC3 → LAN → Create Game. Бусад нь WC3-ийн LAN жагсаалтаас нэгдэнэ (DATACOM relay, 6мс)."),
    ("≥12 мин, ялагч хүртэл", "Skill сонголт + 10 минутаас дээш тоглоод -ff эсвэл throne-оор дуусга. 10 минутын өмнө гарсан хүн хожил авахгүй."),
    ("Дүн автоматаар", "Тоглоом дуусмагц K/D/A, creep, denie, neutral, gold, hero, item серверт бүртгэгдэж, хожсон баг тус бүр +2 Diamond (10 ranked тоглолтын блокт 5-аас олон хожвол +30 Diamond)."),
    ("Diamond-оо зарцуул", "Silver (800) / Gold (1500 Diamond) гишүүнчлэл, найздаа бэлэглэх. Энгийн өрөө XP л өгнө; ижил бүрэлдэхүүн өдөрт 3 хүртэл тоологдоно."),
])
out = os.path.join(g.OUT, "ranked-guide.jpg")
img.save(out, "JPEG", quality=88, optimize=True)

src = os.path.join(os.path.dirname(__file__), "..", "..", "server", "src", "public", "assets", "warkey-app.png")
if os.path.exists(src):
    im = Image.open(src).convert("RGB")
    im.thumbnail((1400, 1400))
    im.save(os.path.join(g.OUT, "warkey-app.jpg"), "JPEG", quality=85, optimize=True)
    print("warkey-app.jpg", im.size)
print("OK ranked guide")
