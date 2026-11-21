# VisOrder

轻量视觉注意 + FPS 瞄准训练。认知侧用舒尔特等经典练习练搜索与抑制；瞄准侧提供 Aim Lab 风格模式，并可用多增益短测估计更适合你的灵敏度（cm/360）。

每天约 5–15 分钟即可：先练注意，再练枪，或单独做灵敏度校准。

## 本地开发

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

| 路径 | 内容 |
| --- | --- |
| `/` | 产品介绍 + 公开排行榜（舒尔特 / 瞄准 / 本周活跃） |
| `/u/[handle]` | 选手公开主页（点击排行榜昵称进入） |
| `/train` | 六项认知训练（舒尔特、字色干扰、数值干扰、序列记忆、反向线索、视觉完形） |
| `/aim` | 瞄准训练 + **灵敏度校准** |
| `/dashboard` | 练习数据仪表盘（认知 / 瞄准 / 校准汇总） |

可选：配置 `.env.local` 中的 Supabase 后，登录可将认知训练、套件摘要、瞄准局日志、校准推荐与 DPI/感度设置同步到云端（仍分表存储，不与 drill 分数混推感度）。未登录时全部只写本机。

## 功能概览

**认知训练（`/train`）**

- 单练或按套件顺序连做
- 结果写入 localStorage；登录后可与 `training_sessions` 同步
- 多钻套件摘要写入 localStorage，登录后同步到 `suite_runs`，供灵敏度校准作**先验/疲劳门控**（不会直接改游戏感度）

**瞄准训练（`/aim`）**

- 模式：网格射击、3×3、六目标（含新手）
- 设置：游戏档案（VALORANT / CS2 / **和平精英 PC 模拟器**）、感度、**鼠标 DPI**、准心、场景、音效；登录后 DPI/感度同步到 `aim_settings`，每局日志同步到 `aim_sessions`
- 统一用 `cm/360` / eDPI 理解增益；跨游戏比较请看 cm/360，不要只比 in-game 数字
- 设置 → 操控可把当前感度**自动换算**到另一档案（含我的世界 Java / 和平精英模拟器）

**灵敏度校准**

- 入口：瞄准菜单「灵敏度校准」，或设置 → 操控
- 流程：填 DPI → 选任务族（平衡 / 甩枪 / 微调）→ 对数网格多增益短测 → 每组舒适度评分 → 独立验证 → 推荐点 + 区间
- 推荐写入当前档案的 in-game sens；内部存 **cm/360**（本地历史 + 登录后 `sensitivity_recommendations`），换档案可再换算
- 设计说明见 [`docs/optimal-sensitivity.md`](docs/optimal-sensitivity.md)

使用前请关闭系统鼠标加速与游戏加速度（raw input），并填写真实 DPI。

---

## 灵敏度相关计算（实现口径）

下列公式与代码一致，主要实现于 `src/lib/aim-trainer/core/gain.ts`、`core/sensitivity.ts`、`calib/*`。假设：**无加速、raw input**。

### 档案常量（yaw / 增益模型）

| 档案 | 模型 | 系数 |
| --- | --- | --- |
| VALORANT | 线性 | `yawDeg = 0.07`（° / count @ sens=1） |
| CS2 | 线性 | `yawDeg = 0.022` |
| Apex 英雄 | 线性 | `yawDeg = 0.022` |
| 和平精英 · PC模拟器 | 指数（PUBG 系） | `°/count = 0.005 × 10^(镜头灵敏度 / 50)` |
| 我的世界 Java | 三次曲线 | `°/count = 1.2 × (0.6 × %/200 + 0.2)³`（滑条 0–200%） |

和平精英模拟器请先固定模拟器鼠标灵敏度，再把校准结果写入游戏内「镜头灵敏度」；训练场实测 360° 做校验（端游/模拟器输入链路并非严格线性）。

我的世界灵敏度不是线性 eDPI：100% 约等于 `0.15°/count`。跨游戏请用下方 cm/360 换算，不要直接抄 VALORANT/CS2 数字。

### 跨游戏自动换算

设置 → 操控 → **跨游戏换算**：在已填 DPI 的前提下，保持当前 `cm/360`，把感度映射到目标档案（含我的世界 / 和平精英指数滑条）。点「应用到该档案」会切换游戏档案并写入换算后的 in-game 值；若目标滑条够不到精确 cm/360，会钳到边界并提示。

实现：`convertSensAcrossProfiles`（`src/lib/aim-trainer/core/gain.ts`）。

### 视角映射（每 count 弧度）

线性档案的默认旋转公式（可在设置里改表达式）：

\[
\text{rad\_per\_count} = \text{sens} \times \text{yawDeg} \times \frac{\pi}{180}
\]

和平精英 / 我的世界等非线档案改用 `degPerCountForProfile` 算出的有效 °/count，再转成弧度，避免把 sens 再乘一遍。

引擎用该值把鼠标位移（count）变成 yaw/pitch。

### eDPI（仅同游戏内可比）

\[
\text{eDPI} = \text{DPI} \times \text{sens}
\]

不同游戏的 yaw / 增益曲线不同，**不能**用 eDPI 跨档案比较；和平精英与我的世界 UI 不展示 eDPI。

### cm/360（跨游戏统一度量）

转一圈视角需要划过的鼠标行程（厘米）。线性档案：

\[
\text{cm/360} = \frac{2.54 \times 360}{\text{DPI} \times \text{sens} \times \text{yawDeg}}
\]

一般形式（任意档案）用有效 °/count：

\[
\text{cm/360} = \frac{2.54 \times 360}{\text{DPI} \times (\text{°/count})}
\]

反算写入游戏内感度时按各档案模型求逆（线性除 yaw；指数取 log；我的世界开立方），再按 `sensitivityRange` 步进钳位。

**读数习惯：** cm/360 **越小** → 同样手部位移视角转得越多（增益更高）。

示例：VALORANT、DPI 800、sens 0.4 →

\[
\text{cm/360} = \frac{2.54 \times 360}{800 \times 0.4 \times 0.07} \approx 40.8
\]

### 校准搜索网格（韦伯式相对步长）

不以固定 ±0.05 sens 搜，而在 **cm/360** 上对冷启动中心 \(S_0\)（当前感度换算）做等比偏移：

\[
\text{factors} = \{0.8,\ 0.9,\ 1,\ 1.12,\ 1.25\}
\]

\[
\text{cm/360}_i = \mathrm{clamp}\bigl(S_0 \times f_i,\ [10,\ 80]\bigr)
\]

若存在鼠标垫宽度 `deskCm`，上界再收为 \(\min(80,\ 0.9\times\text{deskCm})\)。

认知先验会缩放偏移幅度：

\[
f'_i = 1 + (f_i - 1)\times \text{priorWidthScale}
\]

每个增益水平默认重复 **2** 次；水平顺序随机，同一水平的重复连在一起，便于块后打舒适分。

### 客观分 \(S_{\text{obj}}\)（单试次）

试次采集：命中率、平均击杀时间、过冲角、方向反转次数。先归一化再加权（权重见 `calib/metrics.ts`）：

\[
\begin{aligned}
\text{speed} &= \mathrm{clamp}_{01}\bigl(1 - \tfrac{\text{avgKillTime}}{1.8}\bigr) \\
\text{accuracy} &= \mathrm{clamp}_{01}(\text{accuracy\%}/100) \\
\text{overshoot} &= \mathrm{clamp}_{01}(\text{meanOvershootDeg}/25) \\
\text{reversals} &= \mathrm{clamp}_{01}(\text{meanReversals}/4) \\
S_{\text{obj}}^{\text{trial}} &= \mathrm{clamp}_{01}\bigl(
  0.35\cdot\text{speed} + 0.35\cdot\text{accuracy}
  - 0.15\cdot\text{overshoot} - 0.15\cdot\text{reversals}
\bigr)
\end{aligned}
\]

同一 cm/360 上，按任务族对 Fitts 变体加权平均：

| 任务族 | farLarge | farSmall | nearSmall |
| --- | --- | --- | --- |
| balanced | 1 | 1 | 1 |
| flick | 1.2 | 1.4 | 0.6 |
| micro | 0.6 | 1 | 1.5 |

\[
S_{\text{obj}}(G) = \frac{\sum_j w_j\, S_{\text{obj}}^{\text{trial},j}}{\sum_j w_j}
\]

### 主观分 \(S_{\text{sub}}\)

每组增益结束后 Likert 1–5：

\[
S_{\text{sub}} = \frac{\text{comfort} - 1}{4} \in [0,1]
\]

### 推荐规则（双目标）

1. 找客观峰：\(G_{\text{obj}}^* = \arg\max_G S_{\text{obj}}(G)\)
2. 可接受带：所有满足 \(S_{\text{obj}}(G) \ge 0.92 \cdot S_{\text{obj}}(G_{\text{obj}}^*)\) 的增益
3. **推荐**：在带内最大化 \(S_{\text{sub}}\)（无人打分时退回客观峰）
4. UI 同时给出：推荐点、表现最佳、最舒适、以及相邻网格步构成的 cm/360 区间

置信度粗估：

\[
\text{confidence} = \mathrm{clamp}_{01}\bigl((0.55 + 0.03\cdot N_{\text{trials}}) \times \text{priorDiscount}\bigr)
\]

### Hold-out 验证

拟合后对「推荐增益」与「邻近网格步」各再打一局短测，比较 \(S_{\text{obj}}\)：

- 推荐 \(\ge\) 邻近 − 0.02 → 标记 `verified`
- 否则加宽区间约 ±8%，并把置信乘 0.7

### 日常局代理分（漂移监测）

普通瞄准局没有过冲/反转时，用 HUD 代理：

\[
S_{\text{proxy}} = \mathrm{clamp}_{01}\bigl(
  0.4\cdot\text{speed} + 0.4\cdot\text{accuracy} + 0.2\cdot\mathrm{clamp}_{01}(\text{score}/30000)
\bigr)
\]

校准后、在推荐 cm/360 附近（相对误差 ≤ 8%）的近期局，若均值低于校准后基线的 **85%**，菜单提示复测。

### 认知先验在算什么（不改感度）

只用近期舒尔特用时、干扰类正确率等，输出：

- `priorWidthScale`：收窄/放宽上面的 factor 网格
- `confidenceDiscount`：打折置信
- `deferCalibration`：表现过差时建议暂缓校准

**禁止**把 Stroop / 记忆分和 aim 分加权去反推 in-game sens。

### 代码入口

| 内容 | 路径 |
| --- | --- |
| cm/360 · eDPI · 网格 | `src/lib/aim-trainer/core/gain.ts` |
| rad/count | `src/lib/aim-trainer/core/sensitivity.ts` |
| \(S_{\text{obj}}\) / \(S_{\text{sub}}\) | `src/lib/aim-trainer/calib/metrics.ts` |
| 带内推荐 · hold-out | `src/lib/aim-trainer/calib/fit.ts` |
| 条件编排 | `src/lib/aim-trainer/calib/orchestrator.ts` |
| 科学背景与产品约束 | `docs/optimal-sensitivity.md` |

---

## 技术栈

- Next.js 16（App Router）· React 19 · TypeScript
- Tailwind CSS v4
- Three.js（瞄准场景）
- Supabase（可选：账号与认知训练云同步）

## 致谢

瞄准训练（`/aim`）移植自 [aim-trainer-web](https://github.com/jiao329/aim-trainer-web)（MIT），感谢作者开源的浏览器端 FPS 练枪实现：Three.js 场景、Aim Lab 式计分、准心/灵敏度/场景/音效设置等均基于该项目。源码保留于 `src/lib/aim-trainer/`，许可证见同目录 [`LICENSE`](src/lib/aim-trainer/LICENSE)。
