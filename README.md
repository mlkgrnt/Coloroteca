# Coloroteca

[![CI](https://github.com/mlkgrnt/Coloroteca/workflows/CI/badge.svg)](https://github.com/mlkgrnt/Coloroteca/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#开发与测试)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-informational.svg)](#开发与测试)

输入任意色值，匹配色库中最接近的色号。给一个 `#FF6B6B`，拿回最近的 5 个色号、每个的 CIEDE2000 色差，以及「肉眼几乎无法分辨 / 一般观察者可辨」这样的人话分级。

**只发引擎，不发色库。** 潘通（Pantone）、Freetone 之类的色号列表与色值属于各自权利人的知识产权，本项目不内置、不分发——色库由你自己导入。这里提供的是**色差匹配引擎**与**色库格式适配层**，零运行时依赖，可完全离线运行。

网页版与 Agent Skill 共用同一份 `core/`，所以同一个输入必定得到同一个结果。

## 目录

- [项目定位](#项目定位)
- [特性](#特性)
- [快速开始](#快速开始)
- [色库](#色库)
- [读懂结果](#读懂结果)
- [精度限制](#精度限制)
- [项目结构](#项目结构)
- [开发与测试](#开发与测试)
- [合规](#合规)
- [许可](#许可)

---

## 项目定位

这个项目真正的资产是两样东西：

1. **色差匹配引擎**——CIEDE2000，用 Sharma 等人的官方 34 组数据逐组验证过（容差 1e-4）。
2. **色库格式适配层**——把 `.ase` / `.acb` / `.gpl` / 文本列表统统读成一套统一的 [CLF 格式](docs/CLF-FORMAT.md)。

打个比方：这像一个能读 `.ase` 的播放器。播放器不承担音源版权，但能把你合法拥有的音源播出来。

内置的只有两份可自由分发的示例色库（自造色轮 CC0 + MIT 许可的中国传统色 158 色），用来让你先跑起来看看效果。

---

## 特性

**网页版**

- 五种输入方式实时联动：HEX / RGB / HSL / 系统调色盘 / **屏幕吸管**（EyeDropper API，Chromium 系）
- 结果卡片以「输入色为底、候选色内嵌」并排显示，差异直接看得见
- 每个结果带完整色号、色名、HEX、RGB、CMYK、Lab、ΔE、感知分级，以及 **ΔL / ΔC / ΔH** 差异拆解
- 色差公式（CIEDE2000 / CIE94 / CIE76）、kL 权重、结果数量、阈值均可在设置中修改
- 色库导入（拖拽 / 多选文件 / 整个文件夹 / 粘贴文本）与切换
- 批量匹配：粘贴一批色值，一次出结果，可导出 CSV
- 色号反查：输入 `185 C` 或 `胭脂`，看它是什么颜色

**命令行 / Agent Skill**

- 单色、批量、反查、中文色名四种入口
- 输出 Markdown 表格（含 Unicode 色块）/ JSON / CSV
- 支持 ASE、ACB、GPL、文本、CLF 五种格式互转
- 安装为 Skill 后可直接用自然语言对话：「把这批颜色转成色号」

---

## 快速开始

需要 Node ≥ 20。整个项目零依赖，**不需要 `npm install`**。

### 网页版：双击打开

```bash
npm run build            # 生成 dist/coloroteca.html
```

然后双击 `dist/coloroteca.html`。单文件，代码和数据都在里面，离线可用。

> **为什么需要打一次包**：浏览器不允许 `file://` 页面加载 ES 模块（同源策略，origin 为 `null`）。源码保持「模块 + 无构建」是给开发和审阅用的，单文件版是给使用用的。打包器是自己写的，只做一件事，遇到不认识的语法会直接报错而不是产出坏文件。

### 网页版：本地服务

```bash
npm run serve            # 打开 http://127.0.0.1:8787/
```

源码即产物，没有构建步骤。改完 `web/app.js` 刷新即可。

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

安装后即可在对话中说人话：

- 「把这批颜色转成色号：`#AABBCC` `#DDEEFF` …」
- 「珊瑚粉对应我色库里的哪个色号」
- 「`185 C` 是什么颜色」

---

## 色库

### 支持的格式

| 格式 | 扩展名 | 说明 |
|---|---|---|
| **ACB** | `.acb` | **Adobe 色库，自带真实油墨 Lab 值——首选** |
| ASE | `.ase` | Adobe Swatch Exchange；Freetone 等用的就是这个 |
| CLF | `.clf.json` | 本项目的原生格式，见 [格式规范](docs/CLF-FORMAT.md) |
| GPL | `.gpl` | GIMP / Inkscape / Aseprite |
| 文本 | `.txt` `.csv` `.tsv` `.css` | 一行一个色值，或 `色号 #色值` |

**为什么 `.acb` 是首选**：Pantone 官方发布的是**油墨 Lab 值**，hex 反而是第三方从 Lab 反推的近似。ACB 文件里存的就是那份 Lab，导入时会被完整保留并直接用于匹配，精度高于任何 hex 往返。ASE 的 LAB 色块同理。

### 内置示例色库

首次打开即可用，不需要任何导入：

| 色库 | 色号数 | 许可 | 来源 |
|---|---|---|---|
| Demo Colour Wheel | 83 | CC0 | 本工具自造（`tools/make-demo-libraries.mjs`） |
| 中国传统色 | 158 | MIT | [wyvernnot/ancient-chinese-color](https://github.com/wyvernnot/ancient-chinese-color) |

### 去哪里拿色库

官方订阅渠道、开源替代、自己的既有授权等合法途径，见 **[docs/GETTING-LIBRARIES.md](docs/GETTING-LIBRARIES.md)**。

色库默认放在 `~/.coloroteca/libraries/`，网页版与命令行共用同一份。

```bash
node skill/scripts/list.mjs --include-demo      # 看有哪些色库

node skill/scripts/convert.mjs "PANTONE+Solid Coated.acb" \
    -o ~/.coloroteca/libraries/pms-c.clf.json \
    --system PMS --prefix PANTONE --suffix C --license proprietary
```

> `--license` 只是把事实记下来（以后你或别人看到这个文件，知道它不能再分发），不是设卡。它不会阻止你做任何事。

---

## 读懂结果

### ΔE 分级

默认 CIEDE2000。分级阈值是这套公式自己的：

| ΔE | 含义 |
|---|---|
| < 1.0 | 肉眼几乎无法分辨 |
| 1.0 – 2.0 | 受过训练的眼睛可辨 |
| 2.0 – 3.5 | 一般观察者可辨 |
| 3.5 – 5.0 | 明显不同色 |
| > 5.0 | 基本算两种颜色 |

**CIEDE2000 的恰可察觉差异（JND）约 1.0，CIE76 约 2.3——两套阈值不可混用。** 上表仅适用于 CIEDE2000。

### kL 明度权重

印刷 / 屏幕场景 `kL=1`；纺织品的表面纹理削弱了人眼对明度的敏感度，故 `kL=2`。

脚本和网页都会按色库的 `meta.system` 自动判断（`TCX` / `TPG` / `TEXTILE` → 2），也可以手动覆盖。

### 差异拆解

结果里的 **ΔL / ΔC / ΔH** 告诉你差在哪：是偏亮偏暗、偏艳偏灰，还是色相不同。

只给一个数字的工具，和能解释差异的工具，是玩具和专业工具的分界。

---

## 精度限制

这一点必须说白：

- **色库本身的质量是上限。** 第三方从 Lab 反推的 hex 表，反推过程本身就有误差，再怎么算也无法还原。
- **屏幕 ≠ 实物。** 屏幕发光的色域和纸张油墨的色域不是一回事，任何屏幕匹配都只是近似。**实际指定色号请以官方色卡为准。**
- **体系要对得上。** 拿屏幕 RGB 去匹配纺织 TCX 色库、或者忘了切 kL，结果会系统性偏移。

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
│   └── libraries/         你的色库（gitignored，仅 .gitkeep 入库）
├── tools/                 serve · build-standalone · make-demo-libraries
│                          make-zh-colornames · install-skill · scan-protected
├── tests/                 105 项测试（node --test）
├── .github/workflows/     CI：测试 + 合规扫描 + 生成物校验
└── docs/                  CLF-FORMAT.md · GETTING-LIBRARIES.md
```

**关键设计**：`core/` 是唯一实现算法的地方，网页端和 Skill 端 import 的是同一份代码。

这是「网页和 agent 结果对不上」这个问题的唯一可靠解法——不是靠对两边的行为，而是让两边根本就是同一个东西。测试里有一条专门交叉验证页面渲染结果与 `core/` 逐位一致。

---

## 开发与测试

```bash
npm test            # node --test，105 项
npm run check       # 合规扫描：仓库里有没有不该有的色库数据
npm run serve       # 本地服务（127.0.0.1:8787）
npm run build       # 生成 dist/coloroteca.html 单文件版
npm run build:docs  # 校验生成物（示例色库、单文件包）是否与源码同步
npm run skill:install
```

零运行时依赖，零构建步骤。唯一的「构建」是可选的单文件打包。

CI 在 Node 20 / 22 / 24 上跑测试，并在 Node 22 上跑合规扫描与生成物校验（见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。因为没有任何依赖，所以没有 lockfile，CI 里也就没有安装步骤。

**技术决策记录**

- **不用 colorjs.io / culori**：核心算法约 250 行，用 Sharma 官方数据验证过正确性后，自实现 + 权威验证优于引依赖 + 信任。也让离线分发与长期维护成本归零。
- **不用 γ=2.2 近似 sRGB 传递函数**：暗部误差肉眼可见，必须用标准分段函数。
- **不引入 KD-tree**：2300 条线性扫描亚毫秒级。超过约 5 万条再说。

**贡献**

欢迎 Issue 与 PR。改动请一并附上测试——`npm test` 与 `npm run check` 都必须通过。

⚠️ **请勿提交任何色库数据**（`.ase` / `.acb` / `.aco` / `.act`、色卡表、第三方色号列表）。这类文件会被 `.gitignore` 挡下，CI 也会拦；本项目只收引擎与格式代码。

---

## 合规

这是本项目的立身之本，所以有工程手段兜着：

- `.gitignore` 排除 `data/libraries/` 与所有 `.ase` / `.acb` / `.aco` / `.act`
- `tools/scan-protected.mjs` 检测五类结构特征：色库二进制文件、非自由许可的 CLF、粘贴的批量色卡表、色名表来源越界、用户色库被误纳入版本管理
- 每次 push 与 PR 都由 GitHub Actions 自动跑这个扫描和完整测试套件
- **该扫描器自身不含任何受保护色值清单**——放一份清单进仓库，本身就是把要拒绝的数据放进来，而且它只能抓到已经知道的色库。所以它检测的是**结构特征**，不是内容匹配
- 内置数据只有两份，许可分别是 CC0 与 MIT
- 中文色名表刻意剔除带商标 / 品牌归属的色名（蒂芙尼蓝、克莱因蓝等），并有测试守着不让它们回来

### 边界：我们审查仓库，不审查用户

**扫描器只检查这个仓库里有什么，从不检查你机器上有什么。**

你导进一份自己买了授权的 Pantone 色库、或者从任何来源拿到的色卡，工具都会照常读取、转换、匹配——不会拒绝、不会中止、不会拦着你说教。

CLF 里的 `source` 与 `license` 是为了**记下事实**（以后你或别人看到这个文件，知道它不能再分发），不是为了设卡：缺了这两个字段只在校验时记一条警告，库照样能导入能用，网页上标一个琥珀色的 `proprietary` 徽章而已。

理由很简单：**在自己电脑上使用一份合法获得的色卡不违法，再分发才违法。** 我们做的是壳子，壳子没有资格审查用户。这条路走歪了会同时毁掉两头——拦不住真想违规的人，却凭空给正常用户添堵。

---

## 许可

[MIT](LICENSE)。

> 本项目为独立项目，与 Pantone LLC 无隶属关系，未获其认可或赞助。「Pantone」是其各自权利人的商标，此处仅作指称之用。
