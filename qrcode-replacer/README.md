# QR Code Replacer · 二维码替换工具

> 上传一张含有二维码的海报/邀请函/名片，自动识别原二维码的四角位置，并把你的新二维码以**透视变换**的方式精确合成到模板图片中。

[![Vue 3](https://img.shields.io/badge/Vue-3.x-42b883?logo=vue.js)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/Vite-5.x-646cff?logo=vite)](https://vitejs.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 1. 项目概述

### 功能

- 自动识别模板图片中二维码的四角锚点（基于 Finder Pattern + 特征点投票）
- 读取新二维码图片或文本，并重新生成一个"干净"的标准二维码
- 通过**单应性矩阵 + 透视变换**把新二维码合成到模板的原位置，支持任意角度 / 梯形形变
- 可视化工件：在画布上显示锚点、支持拖拽微调、一键导出 PNG

### 目标用户

- 活动运营 / 设计师：需要批量把海报中的旧二维码替换为新链接
- 自媒体 / 社群维护者：快速把模板中的二维码替换为带推广参数的版本
- 开发者：一个开箱即用、纯前端、无需部署后端的二维码合成工具

### 价值定位

- **纯前端运行**：全部图像运算（检测、合成、导出）在浏览器中完成，数据不上传
- **精度稳定**：轴对齐矩形到非轴对齐四边形的映射均保持像素级误差
- **上手零门槛**：上传模板 → 上传/输入二维码 → 导出成品

---

## 2. 技术架构

### 2.1 技术栈

| 分层     | 技术                                       | 版本   | 作用                              |
| -------- | ------------------------------------------ | ------ | --------------------------------- |
| 框架     | [Vue](https://vuejs.org/)                  | 3.4.x  | 组合式 API 构建组件化 UI          |
| 构建工具 | [Vite](https://vitejs.dev/)                | 5.2.x  | 开发服务器 / 构建 / HMR           |
| 语言     | TypeScript                                 | 5.4.x  | 强类型约束，降低重构成本          |
| 样式     | Tailwind CSS                               | 3.4.x  | 原子化 CSS、主题统一              |
| 图形渲染 | [Fabric.js](https://fabricjs.com/)         | 5.3.x  | 画布交互 / 锚点拖拽 / 缩放        |
| 二维码   | [jsqr](https://github.com/cozmo/jsQR)      | 1.4.x  | 检测并读取二维码内容              |
| 二维码   | [qrcode](https://github.com/soldair/node-qrcode) | 1.5.x | 根据文本生成标准二维码            |
| 数值计算 | ml-matrix                                  | 6.11.x | 矩阵 / SVD 运算（历史实现）       |

> 项目**没有后端**，也**没有数据库**。二维码检测与图像合成全部在浏览器主线程 + 离屏 Canvas 中完成。

### 2.2 核心模块结构

```
qrcode-replacer/
├── src/
│   ├── components/          # UI 组件
│   │   ├── App.vue            页面外壳 / 导航 / 布局
│   │   ├── UploadPanel.vue    模板与二维码上传面板
│   │   ├── CanvasPreview.vue  锚点检测 + 透视合成画布
│   │   ├── Toolbar.vue        工具栏（重置 / 重新检测 / 导出）
│   │   ├── TemplateSelector.vue 预置模板选择器
│   │   ├── SupportModal.vue   捐赠/反馈弹窗
│   │   └── Toast.vue          全局消息
│   ├── composables/         # 组合式逻辑
│   │   ├── useQRDetect.ts     锚点检测流水线
│   │   ├── usePerspectiveTransform.ts  单应性矩阵求解
│   │   ├── useImageUpload.ts  文件读取
│   │   └── useExport.ts       画布导出
│   ├── stores/              # 轻量响应式状态
│   │   └── useAppStore.ts
│   ├── utils/               # 核心算法
│   │   ├── finderPatternDetector.ts   二维码 Finder Pattern
│   │   ├── featureBasedDetector.ts    密度投票 / 角点拟合
│   │   ├── perspectiveUtils.ts        Hartley 归一化 + 8×8 方程组
│   │   ├── qrGenerator.ts             二维码重新生成
│   │   ├── imageUtils.ts              Canvas / ImageData 工具
│   │   └── errorHandler.ts            错误文案集中定义
│   ├── types/               # 全局类型定义
│   └── main.ts
├── public/templates/         # 预置模板图片 + templates.json
└── vite.config.ts / tsconfig.json / tailwind.config.js
```

### 2.3 系统架构图（运行时数据流）

```
 ┌──────────────────────┐    ┌──────────────────────┐    ┌──────────────────────┐
 │   UploadPanel.vue    │    │   CanvasPreview.vue  │    │    Toolbar.vue       │
 │                      │    │                      │    │                      │
 │  上传模板图 / QR图   │───▶│  ① 锚点检测          │───▶│  导出 PNG            │
 │  输入文本生成 QR     │    │  ② 生成标准二维码    │    │                      │
 │                      │    │  ③ 透视变换合成      │    │                      │
 └──────────────────────┘    │  ④ 显示 + 拖拽微调  │    └──────────────────────┘
                             └──────────┬───────────┘
                                        │
                     ┌──────────────────┴──────────────────────────────┐
                     │         composables + utils                    │
                     │  useQRDetect ─▶ finderPatternDetector          │
                     │  usePerspectiveTransform ─▶ perspectiveUtils    │
                     │  useImageUpload ─▶ imageUtils                   │
                     │  useExport ─▶ imageUtils                        │
                     └─────────────────────────────────────────────────┘
```

### 2.4 关键技术亮点与选型理由

1. **Hartley 归一化 + 固定 h₉=1 的 8×8 线性方程组求解**
   - 背景：通用 SVD 在轴对齐矩形场景下容易退化，返回无意义的"无穷远单应性"，导致数万像素误差
   - 做法：把 4 对源/目标点做平移+缩放归一化 → 在归一化空间解 `A·h = rhs`（高斯-约当消元，部分主元） → 用 `H = T⁻¹ · H_norm · T` 反归一化
   - 好处：对轴对齐矩形做到 0 像素误差；任意凸四边形也远低于 1 像素

2. **基于密度投票的角点恢复**
   - 做法：先使用 jsqr 的 Finder Pattern 找到二维码大致中心和尺寸 → 再在四个角做局部亮度/密度投票 → 拟合四边形并做形状健康度过滤
   - 好处：对海报中的高对比度 / 低对比度二维码都较稳定，避免锚点跳动

3. **Fabric.js 作为交互层 + 离屏 Canvas 作为渲染层**
   - Fabric 负责锚点、网格、边框的拖拽与缩放；离屏 Canvas 单独做重绘/合成，每帧仅对 Fabric 贴图一次
   - 好处：结构清晰；重绘与交互解耦；可导出高质量 PNG

4. **`import.meta.env.BASE_URL` 统一资源前缀**
   - 资源（templates.json、预置模板图）路径不写死站点根目录
   - 好处：同一份产物可部署到 `/`、子路径 `/xxx/`、GitHub Pages 等任意位置，不需改代码重构建

---

## 3. 环境要求

| 工具     | 最低推荐版本 | 说明                     |
| -------- | ------------ | ------------------------ |
| Node.js  | 20.x         | 推荐 20 LTS，与 `engines` 一致 |
| npm      | 9.x / 10.x  | 自带于 Node.js           |
| 浏览器   | 最新一版 Chrome / Edge / Firefox / Safari | 需要 Canvas 2D + ES2020 |
| 系统     | Windows / macOS / Linux | 均已测试可用 |

> 项目不依赖 Node.js 原生模块，全部是浏览器 API。Node 仅用于开发/构建。

---

## 4. 安装与使用

### 4.1 克隆仓库

```bash
git clone https://github.com/fshby/fshby.github.io.qrcode-replacer.git
cd fshby.github.io.qrcode-replacer/qrcode-replacer
```

### 4.2 安装依赖

```bash
npm install
# 或：
npm ci
```

### 4.3 环境变量

项目默认无敏感配置，`vite.config.ts` 内置 base 策略：

- `npm run dev`：`base: '/'`
- `npm run build`：`base: './'`（可部署到任意子路径）

如需指定自定义 base（例如 GitHub Pages 子路径）：

```bash
# Windows PowerShell
$env:VITE_BASE = "/fshby.github.io.qrcode-replacer/"; npm run build

# macOS / Linux
VITE_BASE="/fshby.github.io.qrcode-replacer/" npm run build
```

### 4.4 启动开发环境

```bash
npm run dev
# 默认打开 http://localhost:5173
```

### 4.5 构建生产环境

```bash
npm run build
# 产物输出到 dist/
```

### 4.6 本地预览生产产物

```bash
npm run preview
# 默认打开 http://localhost:4173
```

### 4.7 部署到 GitHub Pages（推荐）

```bash
npm run build
npx gh-pages -d dist -b gh-pages
```

然后在仓库 `Settings → Pages` 中把 Source 指向 `gh-pages` 分支的 `/ (root)`。

---

## 5. 开发规范

### 5.1 代码风格

- **TypeScript 严格模式**：`tsconfig.json` 启用 `strict: true`、`noUnusedLocals`、`noUnusedParameters`，`vue-tsc` 在构建前做类型检查
- **ESLint**：使用 `eslint-plugin-vue`，规则在 `.eslintrc.*` 中统一维护；`npm run lint` 检查
- **Vue 组件**：统一采用 `<script setup lang="ts">`，props 使用 `defineProps<{ ... }>()`
- **路径别名**：`@/xxx` 映射到 `src/xxx`，禁止使用 `../../` 相对路径跨多个层级

### 5.2 提交信息（Conventional Commits）

格式：

```
<type>(<scope>): <subject>
<BLANK LINE>
<body>
```

常见 type：

| type     | 说明                 |
| -------- | -------------------- |
| feat     | 新增功能             |
| fix      | 修复 bug             |
| refactor | 代码重构，不改变行为 |
| perf     | 性能优化             |
| style    | 样式/格式调整        |
| docs     | 文档                 |
| test     | 新增/调整测试        |
| build    | 构建脚本 / 依赖变更  |
| ci       | CI 配置              |
| chore    | 其他杂项             |

示例：

```
feat(detector): 对低对比度二维码使用自适应阈值
fix(utils): 修正 perspectiveUtils 中 denormalize 展开错误
docs(readme): 新增安装与部署步骤
```

### 5.3 分支管理（简化 Git Flow）

- **`main`**：发布分支，始终可构建；只接受来自 PR 的合并
- **`dev`**：集成分支，开发者从 `main` 切出 `feat/*`、`fix/*` 分支，完成后向 `dev` 提 PR
- **`feat/<issue-id>-<slug>`**：新功能分支
- **`fix/<issue-id>-<slug>`**：bug 修复分支
- **`release/<x.y.z>`**：版本发布分支（仅在需要多轮发布测试时使用）

分支命名示例：`feat/17-homography-degenerate`、`fix/base-url-for-gh-pages`

### 5.4 Pull Request 与代码审查

- PR 必须关联至少一个 issue / discussion（"close #xx" / "fix #xx"）
- 通过构建（`npm run build` exit 0）并通过 `npm run lint`
- 禁止包含：
  - 未使用的变量 / 导入（TypeScript `noUnusedLocals` 会报错）
  - 任何硬编码的绝对路径（如 `/templates/...`），应使用 `import.meta.env.BASE_URL` 或相对路径
  - 大型二进制资源（>2MB），图片素材尽量走 CDN 或放到 Git LFS
- 代码审查关注点：
  1. 算法正确性：特别是 `perspectiveUtils.ts` 的单应性部分
  2. 类型安全：不允许 `any`、`// @ts-ignore` 滥用
  3. 可维护性：复杂函数必须有顶层注释描述输入/输出/异常

---

## 6. 交流沟通

- 首选在 GitHub [Issues](https://github.com/fshby/fshby.github.io.qrcode-replacer/issues) 讨论：
  - Bug 反馈：请附带 **模板图 / 二维码图 / 浏览器版本 / 操作系统**
  - 功能建议：请说明场景 + 期望结果
  - 技术讨论：请先查 README 与已关 issue
- 如果仓库配置了"官方交流群"（微信群 / Discord / QQ），入口与邀请链接将写在 Discussion 区置顶。
- 沟通礼仪：
  - 使用中文与清晰表述；不要刷屏
  - 提问前先尝试 `npm run build` 并核对 README 的相关步骤
  - 欢迎提供 PR / 测试用例 / 示例模板

---

## 7. 版权信息

```
MIT License

Copyright (c) 2026 fshby

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

详见仓库根目录的 [LICENSE](LICENSE) 文件。

---

## 附录：目录速查

| 文件 / 目录                                         | 说明                                |
| --------------------------------------------------- | ----------------------------------- |
| [src/App.vue](src/App.vue)                          | 页面外壳与主布局                    |
| [src/components/CanvasPreview.vue](src/components/CanvasPreview.vue) | 锚点检测 + 透视合成画布 |
| [src/utils/perspectiveUtils.ts](src/utils/perspectiveUtils.ts) | Hartley 归一化 + 8×8 方程组 |
| [src/composables/useQRDetect.ts](src/composables/useQRDetect.ts) | 二维码锚点检测流水线 |
| [public/templates/templates.json](public/templates/templates.json) | 预置模板清单 |
| [vite.config.ts](vite.config.ts)                    | 构建与 base 路径配置                |

祝你玩得开心！🎉
