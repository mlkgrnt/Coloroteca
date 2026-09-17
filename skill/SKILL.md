---
name: coloroteca
description: 色号匹配器。输入任意色值（HEX/RGB/HSL/色名/色号）匹配色库中最接近的 N 个色号，支持批量、反查、中文色名。用户问「这个颜色最接近哪个色号」「把这批颜色转成潘通色号」「185 C 是什么颜色」「珊瑚粉对应什么色号」时使用。触发词：色号匹配、最接近的色号、潘通色号、Pantone、TCX、色差、ΔE、CIEDE2000、吸色、反查色号、转色号。
agent_created: true
---

# Coloroteca — 色号匹配

把一个色值映射到色库里最接近的色号，或反过来把色号查成色值。

**引擎与网页端完全一致**：本 skill 的脚本直接 import 仓库里的 `core/`，所以你在这里得到的结果和网页版逐位相同。

## 环境（Windows）

node 用托管版本，直接给绝对路径：

```
C:\Users\Ashley Wilkes\.workbuddy\binaries\node\versions\22.22.2-3\node.exe
```

脚本路径（本 skill 装在 `~/.workbuddy/skills/coloroteca/` 时用相对路径）：

```powershell
$CT = "<coloroteca 根目录>"      # 含 core/ parsers/ data/ 的那个目录
node "$CT/skill/scripts/match.mjs" --hex "#FF6B6B"
```

脚本会自己向上查找 `core/matcher.js` 来确定根目录，所以「在仓库里跑」和「装成 skill 后跑」都行；必要时用环境变量 `COLOROTECA_ROOT` 直接指定。

## 命令速查

### 单色匹配（最常用）

```bash
node skill/scripts/match.mjs --hex "#FF6B6B"
node skill/scripts/match.mjs --rgb 255,107,107
node skill/scripts/match.mjs --hex "#FF6B6B" --top 3
node skill/scripts/match.mjs "#FF6B6B" "#0A2BD9"        # 多个位置参数
```

### 批量匹配

```bash
node skill/scripts/match.mjs --batch colours.txt --top 3
cat colours.txt | node skill/scripts/match.mjs --batch -
```

一行一个色值。`#` 后跟空白或 `!` 才是注释，所以 `#FF6B6B` 不会被当注释吃掉。

### 反查色号

```bash
node skill/scripts/match.mjs --code "185 C"
node skill/scripts/match.mjs --code "GRAY-050" --library demo-wheel
```

容错前缀后缀与大小写：`185`、`185 C`、`PANTONE 185 C` 都能命中。模糊匹配时可能返回多条，一并列出。

### 中文色名

```bash
node skill/scripts/match.mjs --name "雾霾蓝"
node skill/scripts/match.mjs --name "胭脂"
```

### 色库管理

```bash
node skill/scripts/list.mjs                      # 列出可用色库
node skill/scripts/list.mjs --include-demo       # 连内置示例一起列出
node skill/scripts/convert.mjs <输入文件> -o ~/.coloroteca/libraries/xxx.clf.json \
    --name "My Book" --system PMS --prefix PANTONE --suffix C --license proprietary
```

支持的输入格式：`.clf.json`、`.ase`、`.acb`、`.gpl`、文本（CSV/TSV/hex 列表/CSS 变量）。
**`.acb` 是首选**——Adobe 色库自带真实的油墨 Lab 值，匹配精度高于任何从 hex 反推的结果。

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--top <n>` | 返回前 n 个 | 5 |
| `--formula` | `CIEDE2000` / `CIE94` / `CIE76` | CIEDE2000 |
| `--kl <n>` | 明度权重，覆盖按体系自动推导的值 | 自动 |
| `--threshold <dE>` | 超过该色差的结果不返回 | 无 |
| `--library <路径\|id>` | 指定色库 | 目录里第一个 |
| `--dir <路径>` | 色库目录 | `~/.coloroteca/libraries` |
| `--format` | `md` / `json` / `csv` | md |
| `--quiet` | 等价 `--format json` | — |

## 自然语言 → 命令的映射规则

按顺序判断，**抽不到明确色值就问，不要猜**：

1. 出现 `#RRGGBB` / `rgb(...)` / `hsl(...)` / 数字三元组 → `--hex` 或 `--rgb`
2. 出现明显的色号形态（字母数字组合后跟 `C`/`U`/`TCX` 等）→ 先试 `--code`
3. 只出现中文颜色词 → `--name`
4. 是一批色值或提到文件 → `--batch`
5. 什么都没抽到 → 直接问用户要色值，不要替用户编一个

用户说「转成潘通色号」时，**必须先确认已导入潘通色库**。库里没有就说清楚，不要拿别的色库的结果冒充。

## 输出怎么呈现

- 默认 `--format md` 已经是 Markdown 表格，**直接贴给用户**，不要重排、不要二次加工数字。
- 表格里的 `████` 是色块占位符，终端下会自动变成真彩色（`COLOROTECA_COLOR=always` 可强制，`=never` 关闭）。
  在聊天界面里如果想让人看到真实颜色，用宿主提供的可视化能力画色块，颜色值取表格里的 HEX。
- **ΔE 数字必须原样转述**，不要四舍五入成「差不多一样」这种结论。
- 需要给用户解释差异来源时，用表格里的 `ΔL / ΔC / ΔH` 三列：说明是偏亮/偏暗、偏艳/偏灰、还是色相不同。
- 结论里**必须**带上免责说明：屏幕色值近似匹配，实际指定请以官方色卡为准。

## ΔE 怎么解读（CIEDE2000 口径）

| ΔE | 含义 |
|---|---|
| < 1.0 | 肉眼几乎无法分辨 |
| 1.0 – 2.0 | 受过训练的眼睛可辨 |
| 2.0 – 3.5 | 一般观察者可辨 |
| 3.5 – 5.0 | 明显不同色 |
| > 5.0 | 基本算两种颜色 |

**注意**：CIEDE2000 的恰可察觉差异约 1.0，CIE76 约 2.3，两套阈值不可混用。用户若自己报了 CIE76 的数值，先确认公式口径。

**kL 权重**：图形艺术（印刷/屏幕）kL=1；纺织（TCX/Fashion+Home）kL=2，脚本按色库 `meta.system` 自动切换。用户说「我在做服装/面料」时，确认一下色库体系对不对。

## 色名层的边界（重要）

`data/zh-colornames.json` 有 202 条：158 条来自 MIT 许可的传统色（含释义），44 条是自建的现代描述性色名（标了 `approximate: true`）。

- 精确命中 → 直接用参考色值匹配。
- **模糊命中 → 列出候选让用户挑，不要替用户选。** 像「雾霾蓝」这类描述性色名本身覆盖一个区间，擅自取一个值是拿猜测冒充答案。
- **不做语义联想**。「秋天的感觉」「很高级的灰」这类无法离线稳定复现的，明确说做不到，请用户给色值。
- 色名表里**刻意不含商标/品牌色名**（蒂芙尼蓝、克莱因蓝等）。用户问到就说明原因：那是特定商业主体的标识，不是通用色词，需要的话自行导入对应色库。

## 合规红线（不可妥协）

1. **绝不代为下载、生成或内置 Pantone / Freetone 等受保护色库数据。** 用户要潘通色号，只能是他自己导入的色库；库里没有就说明并给出获取途径（见 `docs/GETTING-LIBRARIES.md`）。
2. 不要凭记忆报「潘通 185 C 大约是 #E4002B」——**那是把训练记忆当数据源**，既不准也踩线。一切色值以用户导入的色库为准。
3. 色库没有标注 `source` / `license` 时，提示用户补上；来源不明的数据对外使用前应查清。
4. 输出结果不得声称与 Pantone LLC 有关联或获其认可。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| `没有找到色库` | 正常——本项目不内置任何受保护色库。让用户先 `convert.mjs` 导入，或用 `--include-demo` 看内置示例 |
| `could not parse ...` | 格式不支持或文件损坏。检查是不是 ACO/ACT（P1 未实现），或文本行里没有可识别的色值 |
| 结果里所有 ΔE 都 > 10 | 色库和数据不是一套体系（比如拿屏幕色去匹配油墨色），或色库本身质量差。先确认色库来源 |
| 匹配数字和网页版对不上 | 不应该发生（共用 `core/`）。检查两边 `--formula` 与 kL 设置是否一致 |

## 相关文档

- `docs/CLF-FORMAT.md` — 色库格式规范
- `docs/GETTING-LIBRARIES.md` — 如何合法获取色库
- `web/index.html` — 网页版（同引擎，有屏幕吸色与批量视图）
