# dsh-ymc-sidebar

DSH Web Client 的 VSCode 风格文件树侧栏。基于 DSH 原生 `details` 右栏，保持右侧文件树常驻；打开后：

- 以当前会话工作区目录（session cwd）为根展示文件树
- 目录按需懒加载，树与代码视图都做了虚拟滚动
- 默认不显示内容预览区；点击文件后，在右栏下方预览内容（上方为文件树）
- 支持多文件 tabs：可同时打开多个文件、横向滚动、点击 `×` 关闭
- 支持文本/代码（带行号与基础语法高亮）、Markdown 渲染 / 源码切换、常见图片预览
- 不预置目录忽略规则，文件系统里有什么就展示什么（`node_modules` 等大目录靠懒加载 + 虚拟化抗压）

## 架构

插件分两半，与 DSH 的 `dsh.client` + slot 体系对齐：

- **Host half（`src/index.ts`）**：注入 `fs` 与 `connection`，在 `/dsh-ymc-sidebar` 注册一个仅 loopback 可访问的 Connection RPC channel，提供 `meta` / `list` / `read` 三个端点。
- **Browser half（`src/client.tsx`）**：注入 `slots`、`sessions`、`workspaces`、`connection`、`layout`，注册：
  - `details`（single）：整个右栏，包含虚拟化文件树 + 可拖拽上下分割的预览区
  - 右栏保持打开，文件树内容常驻展示，不依赖标题栏或额外展开/收起按钮

> `details` 是 single slot：注册后替换 DSH 内置工具详情面板；插件卸载后原生面板自动恢复。

前端样式直接消费 DSH 的主题 alias token（`--dsw-alias-*`），不维护独立色板；组件使用 Tailwind CSS 编写，构建时由 `tailwindcss` 从 `src/client.css` 生成 utility CSS 并内联进客户端 bundle。

## 安装 / 开发

要求 DSH `0.1.0-rc.7`、pnpm 10+ 与 Node.js 20+。

```bash
pnpm install
pnpm build
dsh plugin --profile web add .
```

重启 `dsh web` 后，进入某个会话，右侧 `details` 面板会自动保持打开并展示文件树。

本地开发时修改源码后重跑 `pnpm build`，然后重启 `dsh web`。只改 `cordis.yml` 里的 `config` 时 DSH 会热替换插件实例。

### Tailwind 与主题

- `src/client.css` 是 Tailwind 入口：只开启 `components` + `utilities`，**不注入 `base` preflight**，避免污染 DSH 宿主样式。
- 颜色、边框、背景、状态色全部使用 `var(--dsw-alias-*)`，随 DSH 明暗主题自动切换。
- `pnpm build` 会优先调用 Tailwind CLI 生成 `lib/client.css` 并内联到 `lib/client.js`；如果当前环境尚未安装 Tailwind（如未执行 `pnpm install`），会自动回退到 `src/client.fallback.css`，保证本地构建可用。

### 热插拔 / HMR

- Host 半的 RPC channel 注册和 Browser 半的 slot 注册都挂在 Cordis fiber 上，插件卸载/HMR 时自动撤销。
- 每个插件 fiber 都会创建**自己的** `<style data-dsh-ymc-sidebar-style>` 节点，disposer 只移除自己创建的那个，因此热替换重叠期间不会互相删除样式，也不会残留旧样式。

## 配置

```yaml
- insert:
    - id: dsh-ymc-sidebar
      name: dsh-ymc-sidebar
      config:
        maxTextBytes: 2097152
        maxImageBytes: 8388608
        maxEntriesPerDirectory: 2000
        maxTreeRows: 100000
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `maxTextBytes` | `2097152` | 单次文本预览上限（UTF-8 字节） |
| `maxImageBytes` | `8388608` | 单张图片预览上限（字节，经 base64 返回） |
| `maxEntriesPerDirectory` | `2000` | 单目录最多返回的条目数；超出时截断并在树上提示 |
| `maxTreeRows` | `100000` | 客户端展开后可扁平化的最大树行数，防止超大目录打爆内存 |

## 测试

```bash
pnpm test
```

覆盖：

- 客户端纯模型：路径处理、根目录解析、懒加载扁平化、行数上限、循环引用保护
- Host RPC：`meta` / `list` / `read` 成功路径、截断、二进制回退、超大文件、非法路径
- 客户端契约回归：标准 hooks 必须传 selector（本插件最初的空详情 bug 根因）、`details` 必须以 `priority: -1` shadow 内置面板、lazy-CJS bundle 可物化
- 前端契约：样式必须使用 DSH alias token + Tailwind 入口（且不注入 preflight）、style installer 必须按 fiber 独立创建/移除（热插拔安全）

## 常见问题

- **右侧看不到文件树内容？** 当前会话必须带工作区 cwd；无 cwd 时右栏会显示提示。右栏会保持打开。
- **点了文件显示“二进制文件”？** 非 UTF-8 文本会回退为二进制提示，这是 `dsh-fs` 的文本语义。
- **图片看不到？** 仅支持 png / jpg / jpeg / gif / webp / bmp / ico / avif，且大小不能超过 `maxImageBytes`。
- **升级 DSH 后 slot 不生效？** slot 清单随版本变化，先用 `ctx.slots.snapshot()` 复验目标版本。

## License

MIT
