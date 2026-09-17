# 如何合法获取色库

Coloroteca 不提供、不内置、不代下载任何色库数据。这一页告诉你数据从哪来。

**本文不是法律意见。** 涉及商业分发前请自行核实许可条款，或咨询专业人士。本文只做一件事：把常见途径和它们的性质说清楚，让你能自己判断。

---

## 先分清两件事

这两件事经常被混为一谈，但后果完全不同：

| | 说明 | 通常的做法 |
|---|---|---|
| **在自己工作中指定色号** | 你在设计稿、订单、生产单上写「PANTONE 185 C」 | 行业普遍认为不需要额外授权——就像引用书名不需要授权 |
| **再分发色库数据本身** | 把色号 ↔ 色值的完整对照表打包进产品、上传到公开仓库 | 这才是问题所在。色号体系与其色值列表通常被视为权利人的知识产权 |

**Coloroteca 只处理第二种情况。** 它不捆绑任何色库，就是因为你大概率有权**使用**你的色库，但未必有权**再分发**它。工具本身是中立的——像能读 `.ase` 的播放器不承担音源版权。

所以下面所有途径的取舍标准只有一条：**你有没有权利把这份数据以文件形式放进你的工具里用。你自己本地用，和把它提交到公开仓库，是两件事。**

---

## 途径一：用你已有的（最快）

### Adobe 系软件自带色库

装了 Photoshop / Illustrator / InDesign 的话，安装目录里就带着一批 Color Books（`.acb`）：

```
C:\Program Files\Common Files\Adobe\Color Books\
%APPDATA%\Adobe\Color\Books\
```

macOS 上在 `/Library/Application Support/Adobe/Color/Books/` 一带。

**具体路径随版本和安装选项变化，用文件搜索找 `*.acb` 最稳。** 另外 Creative Cloud 账号里有时能下载更多色库。

**为什么优先用 ACB**：它是唯一自带真实油墨 Lab 值的格式。匹配时 Lab 会被直接使用，精度高于任何从 hex 反推的结果。

```bash
node skill/scripts/convert.mjs "C:\Program Files\Common Files\Adobe\Color Books\PANTONE+Solid Coated.acb" \
    -o ~/.coloroteca/libraries/pms-c.clf.json \
    --system PMS --prefix PANTONE --suffix C \
    --license proprietary \
    --source "Adobe Color Book bundled with my Creative Cloud subscription"
```

注意最后的 `--license proprietary`：这不是在评判什么，只是把事实记下来——这样以后你（或别人）看到这个文件时，知道它不能再分发。

### 设计工具导出的调色板

Figma / Sketch / Illustrator / Procreate 里存的调色板通常能导出 `.ase` 或直接复制色值文本。自己的调色板，自己当然有权用。

```bash
node skill/scripts/convert.mjs my-palette.ase -o ~/.coloroteca/libraries/my-palette.clf.json \
    --name "My palette" --license proprietary
```

**注意这里没有 `--prefix` / `--suffix`，这是有意的。** ASE 的每个色板名本身就是完整标签
（「Freetone 185 C」就是一个名字），转换时整串进入 `code` 字段。再传一次前后缀会拼成
「FREETONE Freetone 185 C C」。**上面 ACB 那条示例必须传，是因为 ACB 里存的是裸数字**——
两者正好相反，不要互相套用。

判断方法：转换后跑一次反查，看色号显示得对不对。

```bash
node skill/scripts/match.mjs --code "185 C" --library my-palette
```

### 直接粘贴

手上只有一张截图或一段文字？用网页版的「导入 → 粘贴色值列表」，一行一个：

```
185 C #E4002B
186 C #C8102E
```

---

## 途径二：官方渠道

想要权威、成体系的色库，正当途径是订阅或购买：

| 体系 | 官方渠道大致形态 |
|---|---|
| **Pantone** | Pantone Connect 订阅（含数字色值）；纸质色卡本身 |
| **RAL** | RAL 官方的数字产品与色卡 |
| **NCS** | NCS 官方数字色库与色卡 |
| **Munsell** | Munsell 官方产品 |

这些渠道的产出通常带明确的使用条款。**看清楚条款里关于「可否用于软件、可否再分发」的部分**，再决定怎么用。

一个务实的做法：订阅拿到的数据，转换后放在自己的 `~/.coloroteca/libraries/` 里自用；**不要提交进任何公开仓库**。本项目的 `.gitignore` 已经替你挡住了这个目录，但这道防线只在你没手动绕开它时有效。

---

## 途径三：开放许可的色库

这些是可以合法打包分发的。**每一条都请以仓库内的 LICENSE 文件为准**——许可是会变的，我这里的描述只是帮你缩小范围。

| 色库 | 大致内容 | 许可（请自行核实） |
|---|---|---|
| `wyvernnot/ancient-chinese-color` | 中国传统色 158 条，带释义 | MIT |
| Material Design 官方配色 | Google 设计体系配色 | Apache-2.0 / CC-BY |
| Open Color | 一套通用 UI 配色 | MIT |
| Nord | 北欧风冷色系配色 | MIT |
| Solarized | Ethan Schoonover 的经典配色 | MIT |
| Tailwind CSS 默认色板 | 大量等间距色阶，适合测色阶匹配 | MIT |
| Catppuccin / Tokyo Night | 社区配色主题 | MIT |

中国传统色另有两个常见仓库，**本项目刻意没有采用**，原因值得你知道：

| 仓库 | 条数 | 为什么没用 |
|---|---|---|
| `liuxunchenglxc/ChineseTraditionalColors` | 526 | GPL-3.0。传染性许可，与本项目的 MIT 冲突 |
| `reorx/cht-colors` | 158 | **没有 LICENSE 文件**。没有许可不等于可以随便用，默认是「保留所有权利」 |

第二条特别容易踩：很多人看到 GitHub 上的公开仓库就以为能随便用。**没有 LICENSE 就是没有任何授权。**

---

## 途径四：自己造

最没有争议的数据是**你自己测量或自己定义**的数据。

- **自定色板**：品牌色、产品色，自己定的自己说了算。Coloroteca 内置的示例色轮就是这么来的（24 色相 × 3 明度 + 11 级灰阶，纯计算生成，CC0）。
- **实物测量**：用分光光度计测自己的物料，得到真实的 Lab 值，写成 CLF。这是精度最高的一条路——因为你要匹配的就是自己的实物。

```json
{
  "format": "coloroteca-library",
  "version": "1.0",
  "id": "my-fabric-2026",
  "meta": {
    "name": "2026 春夏面料",
    "system": "CUSTOM",
    "colorCount": 1,
    "source": "measured in-house with a spectrophotometer, 2026-03",
    "license": "proprietary"
  },
  "colors": [
    { "code": "SS26-01", "name": "主色 米白", "hex": "#EFE7DA", "lab": [91.42, 0.81, 3.62] }
  ]
}
```

**注意 Lab 的白点**：自己测的 Lab 通常是 D50（印刷/测量标准），而 CLF 要求 D65。要么自己转，要么只填 `hex` 让引擎推导——详见 [CLF-FORMAT.md 第 5 节](CLF-FORMAT.md#5-lab-字段的优先级规则重要)。

---

## 不要做的

- **不要从论坛、网盘、GitHub 上随便下载「潘通色值表.csv」用。** 这类文件绝大多数是别人从官方数据转出来的，你无法知道它是否准确，也无法知道它的取得是否正当。它们通常还有肉眼可见的色值错误。
- **不要把色库文件提交到公开仓库。** 包括 fork、gist、issue 附件。这是本项目 `.gitignore` 和合规扫描器重点拦的事情。
- **不要指望 AI 凭记忆报色号对应的色值。** 那是把模型权重当数据库用——既不准（会编），也绕过了一切许可讨论。**一切色值以你导入的色库为准。** Coloroteca 的 Skill 明确禁止这么做。
- **不要以为「公开可见」等于「可自由使用」。** 没有 LICENSE 就是没有授权。

---

## 拿到之后

```bash
# 看现在有什么
node skill/scripts/list.mjs

# 转换 + 标注来源与许可
node skill/scripts/convert.mjs <你的文件> \
    -o ~/.coloroteca/libraries/<名字>.clf.json \
    --name "库名" --system PMS --prefix PANTONE --suffix C \
    --license proprietary --source "从哪来的"

# 开始匹配
node skill/scripts/match.mjs --hex "#FF6B6B"

# 确认仓库里没混进不该有的东西
npm run check
```

`convert.mjs` 在你没指定 `--license` 时会记为 `unknown` 并提示你补上。这不是找麻烦——**一个说不清来源的色库，没法判断能不能用、能不能传给别人**，而这恰好是 CLF 存在的理由。
