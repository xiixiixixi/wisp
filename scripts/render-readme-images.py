#!/usr/bin/env python3
"""Compose README illustrations from cropped, unaltered Wisp screenshots."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "images" / "readme"
SOURCE = MEDIA / "source"
WIDTH = 1800
MARGIN = 48
GAP = 32
BACKGROUND = "#f1f4f2"
INK = "#172d25"
MUTED = "#52665b"
BORDER = "#d4ded8"


def find_font(explicit):
    if explicit:
        return Path(explicit)
    candidates = [Path("/System/Library/Fonts/PingFang.ttc")]
    candidates += list(
        Path("/System/Library/AssetsV2/com_apple_MobileAsset_Font8").glob(
            "*/AssetData/PingFang.ttc"
        )
    )
    candidates += [Path("/System/Library/Fonts/STHeiti Medium.ttc")]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise SystemExit("Please pass --font with a Chinese TrueType font path.")


def source(name):
    return Image.open(SOURCE / f"{name}.jpg").convert("RGB")


def region(name, bounds):
    """Bounds refer to the original capture; source excludes its top 144 px."""
    left, top, right, bottom = bounds
    return source(name).crop((left, top - 144, right, bottom - 144))


def fit_width(img, width):
    return img.resize(
        (width, round(img.height * width / img.width)), Image.Resampling.LANCZOS
    )


def picture(canvas, shot, x, y):
    canvas.paste(shot, (x, y))
    ImageDraw.Draw(canvas).rectangle(
        (x, y, x + shot.width - 1, y + shot.height - 1), outline=BORDER, width=2
    )


def card(title, subtitle, body_height):
    canvas = Image.new("RGB", (WIDTH, 192 + body_height + 96), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 26), "Wisp · 实际运行界面 · 0.99.39", font=FONT(25), fill=MUTED)
    draw.text((MARGIN, 69), title, font=FONT(52), fill=INK)
    draw.text((MARGIN, 142), subtitle, font=FONT(29), fill=MUTED)
    return canvas


def footer(canvas, text):
    ImageDraw.Draw(canvas).text(
        (MARGIN, canvas.height - 66), text, font=FONT(29), fill=MUTED
    )


def save(canvas, name):
    target = MEDIA / f"{name}.jpg"
    canvas.save(target, quality=92, subsampling=0, optimize=True)
    print(f"{target.relative_to(ROOT)}: {canvas.width} x {canvas.height}")


def wide(name, title, subtitle, note):
    shot = fit_width(source(name), WIDTH - 2 * MARGIN)
    canvas = card(title, subtitle, shot.height)
    picture(canvas, shot, MARGIN, 192)
    footer(canvas, note)
    save(canvas, name)


def render():
    wide(
        "workspace-overview",
        "文件夹、文档和工具，同时在场。",
        "独立多窗格安排工作，右侧持续预览，底部展开终端。",
        "演示资料 · 同一个窗口中的真实多栏、文档预览与终端",
    )
    wide(
        "pane-layout",
        "每一栏，都有自己的工作位置。",
        "资料在左，制作与交付在中间，当前文档留在右侧。",
        "目录与导航各自独立 · 左右、上下拆分组合 · 分隔线可调整",
    )

    column_width = (WIDTH - 2 * MARGIN - GAP) // 2
    reading = fit_width(
        region("pane-layout", (1715, 270, 2785, 1330)), column_width
    )
    editing = fit_width(
        region("preview-edit", (1715, 270, 2785, 1330)), column_width
    )
    canvas = card(
        "看到内容，就能在边栏修改。",
        "同一份文档，从阅读切换到源文编辑，保存后写回原文件。",
        56 + max(reading.height, editing.height),
    )
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 195), "阅读：查看排版后的正文", font=FONT(30), fill=INK)
    draw.text((MARGIN + column_width + GAP, 195), "编辑：修改文档源文", font=FONT(30), fill=INK)
    picture(canvas, reading, MARGIN, 248)
    picture(canvas, editing, MARGIN + column_width + GAP, 248)
    footer(canvas, "同一文件的两个真实状态 · 预览边栏局部截取并排展示")
    save(canvas, "preview-edit")

    shot = fit_width(
        region("file-comparison", (1325, 270, 2795, 1100)), WIDTH - 2 * MARGIN
    )
    canvas = card(
        "两个版本，差在哪里一眼可见。",
        "文本逐行标出变动，左右并排，滚动一起跟随。",
        shot.height,
    )
    picture(canvas, shot, MARGIN, 192)
    footer(canvas, "真实文本比较 · 名称、行号与差异标记一起保留 · 比较边栏局部")
    save(canvas, "file-comparison")

    document = fit_width(
        region("canvas", (1300, 270, 2180, 1290)), column_width
    )
    welcome = fit_width(
        region("canvas", (2210, 605, 2785, 970)), column_width
    )
    question = fit_width(
        region("canvas", (2210, 1370, 2785, 1560)), column_width
    )
    body_height = 56 + max(document.height, welcome.height + 44 + question.height)
    canvas = card(
        "把原文放在旁边，再提问。",
        "文档和对话同时留在画布里，围绕当前资料提出具体要求。",
        body_height,
    )
    draw = ImageDraw.Draw(canvas)
    draw.text((MARGIN, 195), "文档列：阅读当前资料", font=FONT(30), fill=INK)
    x = MARGIN + column_width + GAP
    draw.text((x, 195), "对话列：欢迎区与输入区局部", font=FONT(30), fill=INK)
    picture(canvas, document, MARGIN, 248)
    picture(canvas, welcome, x, 248)
    picture(canvas, question, x, 248 + welcome.height + 44)
    footer(canvas, "画布真实界面的局部拼排 · 示例问题尚未发送，没有展示生成回答")
    save(canvas, "canvas")

    shot = fit_width(
        region("terminal", (18, 1060, 1510, 1560)), WIDTH - 2 * MARGIN
    )
    canvas = card(
        "文件在上面，工作工具在下面。",
        "底部面板集中放置终端、动态、文件剪贴板与属性。",
        shot.height,
    )
    picture(canvas, shot, MARGIN, 192)
    footer(canvas, "真实终端输出 · 新建时从当前目录启动 · 切换面板保留已有会话")
    save(canvas, "terminal")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--font", help="Path to a Chinese TrueType/OpenType font")
    args = parser.parse_args()
    font_path = find_font(args.font)
    FONT = lambda size: ImageFont.truetype(str(font_path), size=size)
    render()
