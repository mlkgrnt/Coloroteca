# CLF — Coloroteca Library Format

**版本 1.0** · 扩展名 `.clf.json` · 编码 UTF-8

CLF 是本项目的交换格式。所有导入格式（ASE / ACB / GPL / 文本）最终都归一到它，匹配引擎只认它。把格式统一在一处，是"新增一种色库格式"只需要写一个解析器、而不是改动匹配逻辑的原因。

CLF 的设计目标是**让来源可追溯**。色库数据经常来源不明、许可不明，而这两件事恰好决定了它能不能用、能不能分发。所以 `source` 和 `license` 是必填字段，不是可选项。

---

## 1. 最小可用示例

```json
{
  "format": "coloroteca-library",
  "version": "1.0",
  "id": "example",
  "meta": {
    "name": "示例色库",
    "system": "CUSTOM",
    "colorCount": 2,
    "source": "user-imported",
    "license": "unknown"
  },
  "colors": [
    { "code": "1", "hex": "#FF6B6B" },
    { "code": "2", "hex": "#0A2BD9", "lab": [31.35, 56.85, -87.83] }
  ]
}
```

---

## 2. 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `format` | string | ✅ | 固定为 `"coloroteca-library"`。格式识别的依据 |
| `version` | string | ✅ | 规范版本，当前只有 `"1.0"` |
| `id` | string | ✅ | 库唯一标识。同名时后导入的覆盖先导入的 |
| `meta` | object | ✅ | 元数据，见下 |
| `colors` | array | ✅ | 色条目数组 |

不属于以上字段的内容会被忽略而非报错——宽松读取，严格校验。

---

## 3. `meta`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | ✅ | 展示名 |
| `system` | string | | 色号体系：`PMS` / `TCX` / `RAL` / `NCS` / `CUSTOM`。**影响 kL 默认值** |
| `substrate` | string \| null | | `coated` / `uncoated` |
| `prefix` | string \| null | | 展示前缀，如 `PANTONE` |
| `suffix` | string \| null | | 展示后缀，如 `C` |
| `colorCount` | number | ✅ | 条目数。与 `colors.length` 不一致时警告（不致命） |
| `source` | string | ✅ | 数据来源。UI 会展示 |
| `license` | string | ✅ | 许可状态，建议用：`proprietary` / `mit` / `cc0` / `unknown` |
| `importedAt` | string | | ISO 8601 时间戳 |
| `note` | string | | 自由文本备注 |

### 关于 `system` 与 kL

匹配时的明度权重 kL 默认由 `system` 推导：`TCX` / `TPG` / `TEXTILE` → kL = 2（纺织），其余 → kL = 1（图形艺术）。理由是纺织品的表面纹理削弱了人眼对明度差的敏感度。

如果你的色库其实是纺织体系但 `system` 写的是 `CUSTOM`，要么把 `system` 改对，要么在调用时显式指定 kL。

### 关于 `license`

**`source` 与 `license` 空着会触发警告，`license` 不在自由许可白名单里会在合规扫描中被判为错误。** 这是刻意的：一个说不清来源的色库，没法判断能不能随项目分发。

`tools/scan-protected.mjs` 认可的自由许可：`mit`、`cc0`、`public-domain`、`apache-2.0`、`bsd`、`bsd-2-clause`、`bsd-3-clause`、`ofl`、`cc-by`、`cc-by-sa`。

---

## 4. 色条目

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | ✅ | 色号主体。缺失或为空时退回用 hex 去 `#` 充当 |
| `name` | string \| null | | 色名 |
| `hex` | string | ✅ | `^#[0-9a-f]{6}$`，小写 |
| `rgb` | [n,n,n] | | 0–255 整数。缺失时由 hex 推导 |
| `cmyk` | [n,n,n,n] | | 0–100 |
| `lab` | [n,n,n] | | CIELAB，**D65 白点**。见第 5 节 |
| `spot` | boolean | | 是否专色 |
| `displayName` | string | | 覆盖 `prefix + code + suffix` 的拼装结果 |
| `note` | string | | 备注（中国传统色的释义就放这里） |

`code` 是字符串而不是数字，因为现实里的色号形如 `185 C`、`19-4052`、`胭脂`——强制成数字会丢信息。

### 展示码的拼装

```
displayName ?? [prefix, code, suffix].filter(Boolean).join(' ')
```

例如 `prefix: "PANTONE"` + `code: "185"` + `suffix: "C"` → `PANTONE 185 C`。前缀和后缀的**首尾空格会被保留**（有人在里面塞了刻意的不换行空格），所以 `"TST "` 与 `"TST"` 是两个不同的后缀。

---

## 5. `lab` 字段的优先级规则（重要）

**若条目带 `lab`，匹配时直接用它；否则才由 `hex` 转出来。**

理由是数据质量的方向问题：Pantone 官方发布的是**油墨 Lab 值**，hex 是第三方从 Lab 反推的屏幕近似。所以 `Lab > RGB`。

具体要求：

1. **导入时若源文件提供 Lab，必须保留。** ASE 的 `LAB ` 色块、ACB 色库都带 Lab，这是唯一能提升精度的机会，错过就没了。
2. **`lab` 必须统一到 D65 白点。** ASE 与 ACB 里存的 Lab 是 **D50**（印刷参考白点），必须先经 Bradford 色适应转到 D65，再拿去和 sRGB 推导出的 Lab 比较。不转的话会产生一个固定的、与颜色相关的偏差——很容易被误当成"色库不准"。
   - 导入器已自动处理：`core/color-space.js` 的 `labD50ToLabD65()`。
   - 手写 CLF 时注意：如果你的 Lab 是从印刷资料抄来的 D50 值，要么自己转，要么别填（让引擎从 hex 推导，误差更小也更一致）。
3. **不预计算 Lab 写回文件。** 保持 CLF 是"纯数据"：算法迭代时无需重算所有色库。运行时 2300 条转换 < 10 ms，配合内存缓存完全够用。

---

## 6. 校验规则

读取时逐项校验，**失败项计数并报告，不静默丢弃**。

会被拒绝（`valid: false`）：

- `format` 不是 `"coloroteca-library"`
- 缺少 `meta` 对象
- `colors` 不是数组

会产生警告（仍可加载）：

- `version` 不在已知版本列表中
- `meta.name` / `meta.source` / `meta.license` 为空
- `meta.colorCount` 与 `colors.length` 不一致
- 有条目因缺 `hex` 或 `hex` 格式非法而不可用（计入 `stats.dropped`）
- `code` 重复

`convert.mjs` 在解析出 0 个可用色值时会直接失败，不写出空库——一个能加载但匹配不到任何东西的文件，比一个报错更难排查。

---

## 7. 文件命名与存放

- 默认仓库：`~/.coloroteca/libraries/`
- 命名：`<id>.clf.json`。id 由名称 slug 而来，保留中文字符（色库名常是中文）
- **该目录被 `.gitignore` 排除。** 里面装的是你自备的色库，其中很可能有专有数据，不属于代码仓库

---

## 8. 与其他格式的对应关系

| 来源 | 映射要点 |
|---|---|
| **ACB** | `code` ← 色号，`name` ← 色名，`lab` ← 原生 D50 Lab（转 D65），`cmyk` ← 字节值**反转**后换算（255 → 0%，0 → 100%），`prefix`/`suffix` ← 库头信息。ACB 的 Pascal 字符串是 **32 位长度 + UTF-16BE**，与 ASE 的 16 位长度不同 |
| **ASE** | `code` ← 色块名，`lab` ← `LAB ` 色块原生 D50 Lab（转 D65），`rgb` ← float32 × 255 后取整。组块（`0xc001`/`0xc002`）不产生色条目。未知颜色模型跳过并计数 |
| **GPL** | `code` ← 行尾名称，`rgb` ← 三个整数 |
| **文本** | `code` ← 色值前后的标签文本；无标签时以 hex 去 `#` 充当 |

---

## 9. 版本演进

`version` 目前只有 `1.0`。读到未知版本时是警告而非拒绝，以便前向兼容：新版写入的库在旧版读取时仍会尽量加载。

修改规范时的约定：**新增可选字段不升版本；改变已有字段的语义、或新增必填字段才升版本。**
