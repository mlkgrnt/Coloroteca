"""Build data/zh-colornames.json — the Chinese colour-name lookup table.

Sources
-------
1. ``wyvernnot/ancient-chinese-color`` (MIT). 158 entries, each with a short
   definition. The upstream file is expected at ``--input``.
2. A small curated list of MODERN descriptive names maintained here. These are
   representative values for loose everyday colour words (莫兰迪灰粉, 雾霾蓝,
   珊瑚粉, ...) and are marked ``approximate: true`` — they are not authoritative
   definitions.

Deliberate omissions
--------------------
Colour names that are brand or trademark identifiers are excluded on purpose
(Tiffany blue, International Klein Blue, Hermès orange, ...). Anyone who wants
those can import their own colour book; we do not ship them.

Name collisions
---------------
A few modern names also exist in the traditional dataset (藏青, 枣红, 藕荷色,
姜黄, 靛蓝). The traditional entry wins — it has a real dataset behind it, while
our value is only a representative approximation. The modern aliases are merged
into the traditional entry so alternate spellings still resolve.

Usage
-----
    python tools/make-zh-colornames.py --input path/to/ancient-data.json \
                                       --license path/to/LICENSE

Writes ``data/zh-colornames.json`` and ``data/LICENSE-ancient-chinese-color.txt``.
"""

import argparse
import json
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# name, hex (no '#'), aliases, note
MODERN = [
    ("莫兰迪灰粉", "c8b8b4", ["莫兰迪粉"], "灰调低饱和粉色的代表值"),
    ("莫兰迪绿", "a8b5a2", ["莫兰迪灰绿"], "灰调低饱和绿"),
    ("莫兰迪蓝", "8e9bae", ["莫兰迪灰蓝"], "灰调低饱和蓝"),
    ("莫兰迪灰", "b9b2a8", [], "莫兰迪色系的中间灰"),
    ("马卡龙粉", "ffb6c1", ["马卡龙粉红"], "低饱和高明度粉"),
    ("马卡龙绿", "b5ead7", ["马卡龙薄荷"], "低饱和高明度绿"),
    ("马卡龙黄", "fff2b2", [], "低饱和高明度黄"),
    ("马卡龙蓝", "aec6cf", [], "低饱和高明度蓝"),
    ("雾霾蓝", "7a9eb1", ["灰蓝"], "带灰调的蓝"),
    ("奶茶色", "c4a88a", ["奶茶", "奶茶棕"], "米棕之间的柔和色"),
    ("焦糖色", "af6e4d", ["焦糖"], "暖棕橙"),
    ("珊瑚粉", "ff7f50", ["珊瑚色"], "橙粉之间"),
    ("蜜桃粉", "ffdab9", ["蜜桃色"], "浅橙粉"),
    ("薄荷绿", "98ff98", ["薄荷"], "清亮浅绿"),
    ("抹茶绿", "b5c99a", ["抹茶"], "低饱和黄绿"),
    ("牛油果绿", "87a96b", ["牛油果"], "灰调黄绿"),
    ("藏青", "2e4a62", ["藏蓝", "藏青色"], "深沉的蓝"),
    ("勃艮第红", "800020", ["勃艮第"], "深红带紫"),
    ("酒红", "722f37", ["酒红色"], "暗红"),
    ("枣红", "7b3f00", ["枣红色"], "红棕"),
    ("燕麦色", "e3d9c6", ["燕麦"], "浅米灰"),
    ("奶油白", "fffdd0", ["奶油色"], "暖调白"),
    ("藕荷色", "dda0dd", ["藕粉", "藕荷"], "淡紫粉"),
    ("豆沙色", "b87b7b", ["豆沙"], "灰调红褐"),
    ("烟灰", "b0a9a0", ["烟灰色"], "偏暖的浅灰"),
    ("香槟金", "f7e7ce", ["香槟色"], "浅金"),
    ("玫瑰金", "b76e79", [], "偏红的金色调"),
    ("星空蓝", "1b2a4a", ["深夜蓝"], "极深蓝"),
    ("森林绿", "228b22", ["森林"], "饱和深绿"),
    ("苔藓绿", "8a9a5b", ["苔藓"], "灰调黄绿"),
    ("松石绿", "40e0d0", ["绿松石"], "青绿色"),
    ("天空蓝", "87ceeb", ["天蓝"], "明亮的浅蓝"),
    ("婴儿蓝", "89cff0", ["宝宝蓝"], "柔和浅蓝"),
    ("薰衣草紫", "b57edc", ["薰衣草"], "淡紫"),
    ("丁香紫", "c8a2c8", ["丁香色"], "灰调浅紫"),
    ("柠檬黄", "fff44f", ["柠檬色"], "明亮浅黄"),
    ("姜黄", "e4b62b", ["姜黄色"], "暖调深黄"),
    ("砖红", "cb4154", ["砖红色"], "带灰的红"),
    ("南瓜色", "ff7518", ["南瓜橙"], "暖橙"),
    ("蜜橘", "ffa500", ["橘色", "橙色"], "标准橙"),
    ("樱花粉", "ffb7c5", ["樱花色"], "淡粉"),
    ("亚麻色", "faf0e6", ["亚麻"], "极浅米白"),
    ("卡其色", "c3b091", ["卡其"], "土黄灰"),
    ("橄榄绿", "808000", ["橄榄"], "暗黄绿"),
    ("军绿", "4b5320", ["军绿色"], "深黄绿"),
    ("牛仔蓝", "1560bd", ["牛仔色"], "中等饱和蓝"),
    ("靛蓝", "4f69c6", ["靛青色"], "蓝紫之间"),
    ("石墨灰", "383428", ["石墨色"], "深灰"),
    ("珍珠白", "eae0c8", ["珍珠色"], "带暖调的浅白"),
]

HEX_RE = re.compile(r"^#[0-9a-f]{6}$")


def build(traditional_path):
    entries = []

    raw = json.load(open(traditional_path, encoding="utf-8"))
    for item in raw:
        hexv = str(item.get("HEX", "")).strip().lower()
        if not HEX_RE.match(hexv):
            continue
        entries.append({
            "name": item["name"],
            "hex": hexv,
            "aliases": [],
            "category": "traditional",
            "approximate": False,
            "source": "wyvernnot/ancient-chinese-color (MIT)",
            "note": str(item.get("description", "")).strip() or None,
        })

    by_name = {e["name"]: e for e in entries}
    merged, dropped = 0, []

    for name, hexv, aliases, note in MODERN:
        hit = by_name.get(name)
        if hit is not None:
            for a in aliases:
                if a not in hit["aliases"]:
                    hit["aliases"].append(a)
            merged += 1
            dropped.append("{} (traditional {} kept, modern {} discarded)".format(
                name, hit["hex"], "#" + hexv))
            continue
        entry = {
            "name": name,
            "hex": "#" + hexv,
            "aliases": aliases,
            "category": "modern",
            "approximate": True,
            "source": "Coloroteca curated",
            "note": note,
        }
        entries.append(entry)
        by_name[name] = entry

    return entries, merged, dropped


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", required=True,
                    help="path to ancient-chinese-color's JSON data file")
    ap.add_argument("--license", dest="license_path", default=None,
                    help="path to the upstream LICENSE file to copy alongside the data")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "zh-colornames.json"))
    args = ap.parse_args()

    entries, merged, dropped = build(args.input)

    doc = {
        "version": 1,
        "description": "中文色名到参考色值的映射表，供自然语言色名匹配使用。",
        "count": len(entries),
        "notes": [
            "traditional 条目来自 MIT 许可的 wyvernnot/ancient-chinese-color，版权归原作者。",
            "modern 条目为 Coloroteca 自行整理，标 approximate: true —— 它们是描述性色名的代表性取值，不是权威定义，不声称唯一正确。",
            "刻意不收录有商标或品牌归属的色名。",
            "同名冲突时以 traditional 条目为准，modern 的同义写法并入其 aliases。",
        ],
        "entries": entries,
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    if args.license_path:
        dst = os.path.join(os.path.dirname(args.out), "LICENSE-ancient-chinese-color.txt")
        shutil.copyfile(args.license_path, dst)

    traditional = sum(1 for e in entries if e["category"] == "traditional")
    modern = sum(1 for e in entries if e["category"] == "modern")
    print("ok: {} entries ({} traditional, {} modern)".format(len(entries), traditional, modern))
    print("merged {} colliding modern names into traditional entries:".format(merged))
    for d in dropped:
        print("  - " + d)


if __name__ == "__main__":
    main()
