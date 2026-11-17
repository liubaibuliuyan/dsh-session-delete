"""生成广场卡片用的位图图标（180×180 PNG）。

上游 awesome-dsh-plugin 只接受 GitHub 托管的**位图**做卡片图（SVG 不行），
所以按 icon.svg 的同一套设计用 Pillow 画一张 PNG。
"""
import pathlib

from PIL import Image, ImageDraw

SIZE = 180
SCALE = 4  # 先放大再缩小，边缘更干净
S = SIZE * SCALE

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角蓝底（对应 svg 的 rect rx=14/64）
radius = int(S * 14 / 64)
d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=(0x2F, 0x6F, 0xED, 255))

white = (255, 255, 255, 255)
w = int(S * 3.4 / 64)  # 笔画宽度，同 svg 的 stroke-width 3.4
cap = w // 2


def line(p1, p2):
    d.line([p1, p2], fill=white, width=w)
    for x, y in (p1, p2):  # 手工圆头端点
        d.ellipse([x - cap, y - cap, x + cap, y + cap], fill=white)


def px(x, y):
    """把 svg 的 64 坐标系换算成当前像素。"""
    return (x / 64 * S, y / 64 * S)


# 桶盖横线 M20 24h24
line(px(20, 24), px(44, 24))
# 盖上的把手 M27 24v-3.2 a1.6 1.6 0 0 1 1.6 -1.6 h6.8 a1.6 1.6 0 0 1 1.6 1.6 V24
line(px(27, 24), px(27, 19.2))
line(px(27, 19.2), px(37, 19.2))
line(px(37, 19.2), px(37, 24))
# 桶身 M23.5 24l1.9 20.2a3 3 0 0 0 3 2.7h7.2a3 3 0 0 0 3-2.7L40.5 24
line(px(23.5, 24), px(25.4, 44.2))
line(px(25.4, 44.2), px(38.6, 44.2))
line(px(38.6, 44.2), px(40.5, 24))
# 桶身内两条竖纹 M28.5 30.5v10 M35.5 30.5v10
line(px(28.5, 30.5), px(28.5, 40.5))
line(px(35.5, 30.5), px(35.5, 40.5))

out = img.resize((SIZE, SIZE), Image.LANCZOS)
target = pathlib.Path(__file__).resolve().parents[1] / "assets" / "icon-180.png"
target.parent.mkdir(parents=True, exist_ok=True)
out.save(target, "PNG", optimize=True)
print(f"已生成 {target} ({target.stat().st_size} 字节, {out.size[0]}x{out.size[1]})")
