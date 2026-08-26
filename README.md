# dsh-sidebar

DSH Web Client 的 VSCode 风格文件树侧栏。作为 `#root` 的兄弟节点挂载在 `document.body` 上，通过 CSS layout push 让 DSH 原生界面让出右侧空间；不占用 DSH 原生 `details` slot，因此 blank 会话也能打开。特性：

- 侧栏最右侧提供常驻的 VSCode 风格 Activity Bar 图标栏，可切换“文件资源管理器”和“Git 追踪”两个视图；点击当前视图图标可收起/展开侧栏
- 以当前会话工作区目录（session cwd）为根展示文件树
- 目录按需懒加载，树与代码视图都做了虚拟滚动
- 默认不显示内容预览区；点击文件后，在右栏下方预览内容（上方为文件树）
- 支持多文件 tabs：可同时打开多个文件、横向滚动、点击 `×` 关闭
- “Git 追踪”视图提供 VSCode 风格的三个子页：**改动**（当前分支、暂存区改动、工作区未暂存改动与未跟踪文件，点击可预览带行级高亮的 diff 或未跟踪文件内容）、**历史**（提交记录、提交信息与单次提交 diff，支持加载更多）、**分支**（本地/远端分支列表，可切换分支或把远端分支检出为本地追踪分支）；面板头部提供拉取（pull）与推送（push）操作，执行前会弹出确认框；状态、diff、历史与分支都会随文件监听和 Git 操作自动刷新，无需手动刷新
- 支持文本/代码（带行号与基础语法高亮）、Markdown 渲染 / 源码切换、常见图片预览
- 使用 `chokidar` 监听当前工作区文件变化，文件/目录的新增、修改、删除会自动刷新文件树，并自动重读当前激活的文件预览；未激活的 tab 在切换时读取最新内容，因此面板内不再保留手动刷新按钮
- 不预置目录忽略规则，文件系统里有什么就展示什么（`node_modules` 等大目录靠懒加载 + 虚拟化抗压；文件监听默认忽略 `node_modules` 和 `.git`，并自动遵循工作区 `.gitignore` 声明的忽略路径，避免监听构建产物等大目录；可通过 `watchIgnored` 追加忽略规则）

## 架构

插件分两半：

- **Host half（`src/index.ts`）**：注入 `fs`、`connection` 与 `webServer`，在 `/dsh-sidebar` 注册一个仅 loopback 可访问的 Connection RPC channel，提供 `meta` / `list` / `read` / `git-status` / `git-diff` / `git-log` / `git-show` / `git-branches` / `git-switch` / `git-pull` / `git-push` 等端点；同时在 `/dsh-sidebar/events` 注册同源 SSE 通道，用 `chokidar` 监听当前工作区并把文件变化推送给浏览器。
- **Browser half（`src/client.tsx`）**：注入 `sessions`、`workspaces`、`connection`，在 `document.body` 上创建自己的 React root 并挂载右侧栏；通过 `EventSource` 订阅文件变化事件，自动失效并重载受影响的目录，同时重读当前激活的预览。右侧栏是 `#root` 的兄弟节点，不注册任何 DSH slot：
  - 打开时通过 `--dsh-sidebar-width` 让 `#root` 让出宽度，形成“真占位”的 VSCode 式侧栏，而不是 overlay；收起时至少让出 40px 给常驻 Activity Bar；
  - 面板本身可拖拽调整宽度（280–640px），宽度与开关状态按 localStorage 持久化；
  - 最右侧是 40px 的 Activity Bar，可在“文件资源管理器”和“Git 追踪”间切换；点击当前视图图标收起侧栏，再次点击展开或切换视图；
  - 两个视图保持挂载以保留文件树/预览状态，当前视图也会持久化；面板头部不显示刷新和关闭按钮；
  - 不依赖 `ctx.layout.openDetails()`，所以 blank / 无消息会话也能打开。

> 不修改 DSH 源码，也不替换 DSH 原生 `details` 面板；原生 `details` 是否打开与本插件互不影响。

源码按职责拆分，入口文件只保留插件注册逻辑：

- `src/index.ts`：Host 插件入口；RPC、文件系统、Git、配置等逻辑在 `src/host/`（`config` / `fs` / `git` / `handlers` / `rpc` / `result` / `utils`）。
- `src/client.tsx`：Browser 插件入口；React 组件、状态与 API 封装在 `src/client/`（`api` / `activity-bar` / `git-panel` / `diff-view` / `tree` / `preview` / `sidebar-shell` / `styles` 等）。
- `src/client-model.ts`：与 React 无关的纯模型（路径、扁平化、树交互 reducer），可独立单测。

前端样式直接消费 DSH 的主题 alias token（`--dsw-alias-*`），不维护独立色板；组件使用 Tailwind CSS 编写，构建时由 `tailwindcss` 从 `src/client.css` 生成 utility CSS 并内联进客户端 bundle。

## 安装

要求 DSH `0.1.0-rc.8` 或更新版本、pnpm 10+ 与 Node.js 20+。

### 本地安装（源码 / 开发）

从仓库或本地源码安装：

```bash
git clone https://github.com/kaijia323/dsh-sidebar.git
cd dsh-sidebar
pnpm install
pnpm build
dsh plugin --profile web add .
```

重启 `dsh web` 后，右侧文件树会自动作为 body 兄弟节点打开并展示；即使当前会话是 blank 也能打开。侧栏最右侧的 Activity Bar 常驻：点击当前视图图标可收起/展开，点击另一个图标切换视图；展开状态下左侧边缘可拖拽调整宽度。

### 正式安装（npm 发布版 / 分发制品）

正式版已发布到 npm，直接安装：

```bash
dsh plugin --profile web add @kaijia/dsh-sidebar
```

`dsh plugin` 会将该包安装到 `$DSH_HOME/profiles/web`，识别 `dsh.bundle` 配置并自动激活插件层。如果不想依赖 npm registry，也可以先用 `pnpm pack` 生成 tarball 来做正式分发（文件名中的版本号以当前 `package.json` 的 `version` 为准）：

```bash
pnpm build
pnpm pack
dsh plugin --profile web add ./kaijia-dsh-sidebar-0.1.2.tgz
```

两种方式安装后，都可以用以下命令确认配置层已生效：

```bash
dsh --profile web --dump-config
```

输出中应能看到 `# == @kaijia/dsh-sidebar` 层；随后重启 `dsh web` 即可使用。卸载时执行：

```bash
dsh plugin --profile web remove @kaijia/dsh-sidebar
```

> npm 发布包名为 `@kaijia/dsh-sidebar`。

## 开发

本地开发时修改源码后重跑 `pnpm build`，然后重启 `dsh web`。只改 `cordis.yml` 里的 `config` 时 DSH 会热替换插件实例。

### Tailwind 与主题

- `src/client.css` 是 Tailwind 入口：只开启 `components` + `utilities`，**不注入 `base` preflight**，避免污染 DSH 宿主样式。
- 颜色、边框、背景、状态色全部使用 `var(--dsw-alias-*)`，随 DSH 明暗主题自动切换。
- `pnpm build` 会优先调用 Tailwind CLI 生成 `lib/client.css` 并内联到 `lib/client.js`；如果当前环境尚未安装 Tailwind（如未执行 `pnpm install`），会自动回退到 `src/client.fallback.css`，保证本地构建可用。

### 热插拔 / HMR

- Host 半的 RPC channel 注册和 Browser 半的 slot 注册都挂在 Cordis fiber 上，插件卸载/HMR 时自动撤销。
- 每个插件 fiber 都会创建**自己的** `<style data-dsh-sidebar-style>` 节点，disposer 只移除自己创建的那个，因此热替换重叠期间不会互相删除样式，也不会残留旧样式。

## 配置

```yaml
- insert:
    - id: dsh-sidebar
      name: '@kaijia/dsh-sidebar'
      config:
        maxTextBytes: 2097152
        maxImageBytes: 8388608
        maxEntriesPerDirectory: 2000
        maxTreeRows: 100000
        watchEnabled: true
        watchDebounceMs: 200
        watchIgnored:
          - '**/node_modules/**'
          - '**/.git/**'
```

| 配置 | 默认值 | 说明 |
| --- | --- | --- |
| `maxTextBytes` | `2097152` | 单次文本预览上限（UTF-8 字节） |
| `maxImageBytes` | `8388608` | 单张图片预览上限（字节，经 base64 返回） |
| `maxEntriesPerDirectory` | `2000` | 单目录最多返回的条目数；超出时截断并在树上提示 |
| `maxTreeRows` | `100000` | 客户端展开后可扁平化的最大树行数，防止超大目录打爆内存 |
| `watchEnabled` | `true` | 是否开启文件监听实时刷新（文件树与当前激活预览）；关闭后侧栏不再自动刷新（当前不提供内置手动刷新按钮） |
| `watchDebounceMs` | `200` | `chokidar` 写入稳定后触发通知的等待时间（同时是客户端批量刷新窗口） |
| `watchIgnored` | `['**/node_modules/**', '**/.git/**']` | 文件监听忽略的 glob 列表；仅影响自动刷新通知，不影响文件树展示 |

## 测试

```bash
pnpm test
```

覆盖：

- 客户端纯模型：路径处理、根目录解析、懒加载扁平化、行数上限、循环引用保护
- Host RPC：`meta` / `list` / `read` 成功路径、截断、二进制回退、超大文件、非法路径；Git 的 `status` / `diff` / `log` / `show` / `branches` / `switch` 与远端分支检出
- 客户端契约回归：标准 hooks 必须传 selector、侧栏必须作为 body 兄弟节点挂载且不注册 `details` / `shell.overlay`、必须通过 `#root` margin-right 做 layout push、lazy-CJS bundle 可物化
- 前端契约：样式必须使用 DSH alias token + Tailwind 入口（且不注入 preflight）、style installer 必须按 fiber 独立创建/移除（热插拔安全）

## 常见问题

- **右侧看不到文件树内容？** 当前会话必须带工作区 cwd；无 cwd 时右栏会显示提示。右栏会保持打开。
- **点了文件显示“二进制文件”？** 非 UTF-8 文本会回退为二进制提示，这是 `dsh-fs` 的文本语义。
- **图片看不到？** 仅支持 png / jpg / jpeg / gif / webp / bmp / ico / avif，且大小不能超过 `maxImageBytes`。
- **Git 追踪显示错误？** “Git 追踪”视图依赖本机 `git` 命令；当前工作区目录需要处于 Git 仓库内，才能显示分支、改动和 diff。
- **升级 DSH 后布局异常？** 本插件依赖 `#root` 作为 DSH 原生根节点和 `--dsh-sidebar-width` 做 layout push；升级后若 DSH 调整根节点结构，先检查 `#root` 的 margin-right 是否仍生效。

## License

MIT
