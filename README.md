# Coloroteca

[![CI](https://github.com/mlkgrnt/Coloroteca/workflows/CI/badge.svg)](https://github.com/mlkgrnt/Coloroteca/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#开发与测试)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-informational.svg)](#开发与测试)

将任意色值映射到使用者所提供的色库中最接近的色号，返回前 N 个候选，并给出各自的 CIEDE2000 色差与人眼可辨性分级。

本项目不内置、不分发任何受版权保护的色库数据。色库由使用者自行提供；本仓库提供的是**色差匹配引擎**与**色库格式适配层**，零运行时依赖，可完全离线运行。

网页端与 Agent Skill 共用同一份 `core/` 实现，故二者对同一输入必然产生相同输出。

## 目录

- [项目定位](#项目定位)
- [特性](#特性)
- [快速开始](#快速开始)
- [色库](#色库)
- [结果解读](#结果解读)
- [精度限制](#精度限制)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [许可](#许可)

---

## 项目定位

本项目的核心由两部分构成：

1. **色差匹配引擎**——实现 CIEDE2000 色差公式。该公式由国际照明委员会（CIE）于 2001 年发布（CIE 142-2001）；本实现依据 Sharma、Wu 与 Dalal（2005）公布的 34 组测试数据逐组验证，数值容差 1e-4。
2. **色库格式适配层**——将 `.ase`、`.acb`、`.gpl` 及文本列表等格式统一解析为 [CLF 格式](docs/CLF-FORMAT.md)。

上述分工可用一个类比说明：能够读取 `.ase` 的播放器不承担音源版权，但可播放使用者合法持有的音源。本项目的定位与之一致。

仓库内置两份可自由分发的示例色库（自造色轮，CC0；MIT 许可的中国传统色 158 色），用于免配置试用。

---

## 特性

**网页端**

- 五种输入方式实时联动：HEX、RGB、HSL、系统调色盘、屏幕吸管（EyeDropper API，Chromium 系）
- 结果卡片以输入色为底、候选色内嵌的方式并排显示，便于直接比对
- 每项结果包含色号、色名、HEX、RGB、CMYK、Lab、ΔE 及可辨性分级，并附明度／彩度／色相三分量差异
- 色差公式（CIEDE2000、CIE94、CIE76）、kL 权重、结果数量与阈值均可配置
- 色库导入（拖拽、多选文件、整个文件夹、粘贴文本）与切换
- 批量匹配：粘贴多个色值一次求解，结果可导出为 CSV
- 色号反查：输入 `185 C` 或 `胭脂`，返回对应色值

**命令行 / Agent Skill**

- 提供单色匹配、批量匹配、色号反查、中文色名四种入口
- 输出支持 Markdown 表格（含 Unicode 色块）、JSON、CSV
- 支持 ASE、ACB、GPL、文本、CLF 五种格式互转
- 安装为 Skill 后可通过自然语言调用

---

## 快速开始

运行环境要求 Node ≥ 20。本项目零依赖，无需执行 `npm install`。

### 网页端：直接下载

从 [Releases](https://github.com/mlkgrnt/Coloroteca/releases/latest) 下载 `coloroteca.html`，双击打开即可。单文件、离线、无需安装、无需构建。

### 网页端：单文件构建

```bash
npm run build            # 生成 dist/coloroteca.html
```

构建产物为单一 HTML 文件，代码与数据均已内联，可离线运行。

> 需要构建的原因：浏览器不允许 `file://` 页面加载 ES 模块（同源策略，origin 为 `null`）。源码保持「模块化 + 无构建」以便审阅，单文件产物供直接使用。打包器为本项目自实现，遇到不支持的语法时会终止并报错，不会产出不完整的文件。

### 网页端：本地服务

```bash
npm run serve            # 打开 http://127.0.0.1:8787/
```

源码即产物，无构建步骤；修改 `web/app.js` 后刷新即可生效。

### 命令行

```bash
node skill/scripts/match.mjs --hex "#FF6B6B"
```

```text
输入 #FF6B6B  ·  Lab 64.03, 56.37, 28.92  ·  色库「中国传统色」158 色
公式 CIEDE2000，kL=1（按色库体系自动），取前 5 个

| # | 色号   | 色块 | HEX     | RGB         | ΔE2000 | 感知           | ΔL / ΔC / ΔH             |
|---|--------|------|---------|-------------|--------|----------------|--------------------------|
| 1 | 桃红   | ████ | #F47983 | 244,121,131 | 5.68   | 基本算两种颜色 | +1.364 / -12.47 / 7.682  |
| 2 | 银红   | ████ | #F05654 | 240,86,84   | 5.69   | 基本算两种颜色 | -6.162 / +4.514 / 2.878  |
| 3 | 嫣红   | ████ | #EF7A82 | 239,122,130 | 5.80   | 基本算两种颜色 | +0.839 / -14.776 / 6.904 |
| 4 | 火红   | ████ | #FF2D51 | 255,45,81   | 8.87   | 基本算两种颜色 | -8.209 / +19.869 / 4.434 |
| 5 | 海棠红 | ████ | #DB5A6B | 219,90,107  | 9.54   | 基本算两种颜色 | -8.513 / -8.891 / 9.696  |

屏幕色值近似匹配，实际指定色号请以官方色卡为准。
```

### Agent Skill

```bash
node tools/install-skill.mjs
```

安装后可通过自然语言调用，例如：

- 「将这组颜色转换为色号：`#AABBCC` `#DDEEFF` …」
- 「珊瑚粉对应本机色库中的哪个色号」
- 「`185 C` 对应什么颜色」

---

## 色库

### 支持的格式

| 格式 | 扩展名 | 说明 |
|---|---|---|
| **ACB** | `.acb` | Adobe 色库，保存原始油墨 Lab 值（8 位量化） |
| ASE | `.ase` | Adobe Swatch Exchange，Freetone 等采用此格式；LAB 色块为完整精度 |
| CLF | `.clf.json` | 本项目原生格式，见 [格式规范](docs/CLF-FORMAT.md) |
| GPL | `.gpl` | GIMP、Inkscape、Aseprite |
| 文本 | `.txt` `.csv` `.tsv` `.css` | 每行一个色值，或 `色号 #色值` |

**关于 ACB 格式**：Pantone 官方公布的是油墨 Lab 值，hex 值系第三方由 Lab 反推得到，带有固有误差。ACB 文件保存的即为原始 Lab 值，导入时予以完整保留并直接参与匹配，精度高于任何经 hex 往返的结果。ASE 的 LAB 色块同理。

### 内置示例色库

首次运行即可使用，无需导入：

| 色库 | 色号数 | 许可 | 来源 |
|---|---|---|---|
| Demo Colour Wheel | 83 | CC0 | 本工具自造（`tools/make-demo-libraries.mjs`） |
| 中国传统色 | 158 | MIT | [wyvernnot/ancient-chinese-color](https://github.com/wyvernnot/ancient-chinese-color) |

### 色库的获取与存放

合法获取途径（官方订阅、开源替代、既有授权等）见 **[docs/GETTING-LIBRARIES.md](docs/GETTING-LIBRARIES.md)**。

色库默认存放于 `~/.coloroteca/libraries/`，网页端与命令行共用同一份数据。

```bash
node skill/scripts/list.mjs --include-demo      # 列出可用色库

node skill/scripts/convert.mjs "PANTONE+Solid Coated.acb" \
    -o ~/.coloroteca/libraries/pms-c.clf.json \
    --system PMS --prefix PANTONE --suffix C --license proprietary
```

`--license` 用于记录该色库的许可状态，供后续判断可否再分发；它不改变工具的任何行为。

---

## 结果解读

### ΔE 分级

默认色差公式为 CIEDE2000，其分级阈值如下：

| ΔE | 含义 |
|---|---|
| < 1.0 | 肉眼几乎无法分辨 |
| 1.0 – 2.0 | 受过训练的眼睛可辨 |
| 2.0 – 3.5 | 一般观察者可辨 |
| 3.5 – 5.0 | 明显不同色 |
| > 5.0 | 基本算两种颜色 |

CIEDE2000 的恰可察觉差异（JND）约为 1.0，而 CIE76 的 JND 约为 2.3，两套阈值不可混用。上表仅适用于 CIEDE2000。

### kL 明度权重

印刷与屏幕场景取 `kL=1`；纺织品的表面纹理降低了人眼对明度差异的敏感度，故取 `kL=2`。

脚本与网页均依据色库的 `meta.system` 自动判定（`TCX`、`TPG`、`TEXTILE` 取 2），亦可手动指定。

### 差异分量

结果中的 ΔL、ΔC、ΔH 分别表示明度差、彩度差与色相差，用于判断色差的来源，而非仅给出单一标量。

---

## 精度限制

匹配精度受以下因素限制：

- **色库自身的质量为精度上限。** 由 Lab 反推得到的 hex 表带有反推过程的固有误差，无法通过计算还原。
- **屏幕与实物介质不可比。** 屏幕属发光色域，纸张油墨属反射色域，任何屏幕匹配均属近似。实际指定色号应以官方色卡为准。
- **色彩体系需一致。** 以屏幕 RGB 匹配纺织 TCX 色库，或未按体系切换 kL，结果将产生系统性偏移。

---

## 项目结构

```text
Coloroteca/
├── core/                  ★ 单一事实来源，网页与 CLI 共同 import
│   ├── color-space.js     HEX/RGB/HSL ↔ Lab/LCH；sRGB 分段传递函数、Bradford 色适应
│   ├── delta-e.js         ΔE76 / ΔE94 / CIEDE2000
│   ├── matcher.js         匹配主流程、排序、Top-N、感知分级
│   └── clf.js             CLF 校验、归一化、展示码拼装
├── parsers/               格式嗅探与解析 → 统一输出 CLF
│   └── index · clf · ase · acb · gpl · text
├── web/                   纯静态单页（零依赖、无构建）
│   ├── index.html · style.css · app.js · store.js
│   └── demo-libraries.js  生成物，勿手改
├── skill/                 Agent Skill
│   ├── SKILL.md
│   └── scripts/           lib · match · list · convert
├── data/
│   ├── zh-colornames.json 中文色名 → 参考色值（202 条）
│   ├── demo/              内置示例色库（CC0 / MIT）
│   └── libraries/         用户色库（gitignored，仅 .gitkeep 入库）
├── tools/                 serve · build-standalone · make-demo-libraries
│                          make-zh-colornames · install-skill · scan-protected
├── tests/                 111 项测试（node --test）
├── .github/workflows/     CI：测试、仓库检查、生成物校验
└── docs/                  CLF-FORMAT.md · GETTING-LIBRARIES.md
```

**关键设计**：`core/` 是算法实现的唯一位置，网页端与 Skill 端导入同一份代码。

这消除了「网页与 agent 结果不一致」这一问题的可能性。其保证方式不是令两端行为保持对齐，而是令两端在实现上不可区分。测试中包含一项交叉验证，用于确认页面渲染结果与 `core/` 的输出逐位一致。

---

## 开发与测试

```bash
npm test            # node --test，111 项
npm run check       # 检查仓库内是否含有不应提交的色库数据
npm run serve       # 本地服务（127.0.0.1:8787）
npm run build       # 生成 dist/coloroteca.html
npm run build:docs  # 校验生成物（示例色库、单文件产物）与源码是否同步
npm run skill:install
```

本项目零运行时依赖、零构建步骤；唯一的构建环节为可选的单文件打包。

持续集成在 Node 20、22、24 上运行测试，并在 Node 22 上运行仓库检查与生成物校验（见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。因无任何依赖，仓库不含 lockfile，CI 中亦无安装步骤。

**技术决策**

- **不引入 colorjs.io 或 culori**：核心算法约 250 行，在依据权威数据完成验证后，自实现优于引入外部依赖，并使离线分发与长期维护成本归零。
- **不使用 γ=2.2 近似 sRGB 传递函数**：该近似在暗部产生可见误差，须采用 IEC 61966-2-1 规定的分段传递函数。
- **不引入 KD-tree**：2300 条记录的线性扫描耗时低于 1 ms。当色库规模超过约 5 万条时，再考虑基于 L\* 轴的剪枝。

**贡献**

欢迎提交 Issue 与 Pull Request。改动请一并附上测试，`npm test` 与 `npm run check` 均须通过。

请勿提交任何色库数据文件（`.ase`、`.acb`、`.aco`、`.act`，以及色卡表或第三方色号列表），也不要提交下载色库时得到的压缩包——压缩包是唯一无法被合规扫描读出内容的形式，因此单个入库的压缩包一律判为错误。上述文件均由 `.gitignore` 排除，CI 亦会拒绝。

---

## 许可

[MIT](LICENSE)。

> 本项目为独立项目，与 Pantone LLC 无隶属关系，未获其认可或赞助。「Pantone」为其各自权利人的商标，此处仅作指称之用。
