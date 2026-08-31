# Changelog

本项目所有重要更改都记录在该文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.1.9] - 2026-08-31

### Changed

- 适配 DSH `0.1.2-alpha.2`：升级 `@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-host-webserver`、`@deepseek-ai/schemastery` 与 `@deepseek-ai/cordis` 依赖版本。
- 移除已删除的 `@deepseek-ai/dsh-client-runtime`，客户端上下文改用 `@deepseek-ai/cordis` 的 `Context`。
- 浏览器客户端依赖改为 `@deepseek-ai/dsh-api-session-controller` 与 `@deepseek-ai/dsh-api-workspace-controller` 提供 sessions / workspaces 服务。
- Host RPC 适配 DSH 0.1.2 新的 `connection.rpc.handle` 签名，移除已不存在的 `ConnectionRpcHandlerOptions`。
- 工作区根目录的“最近工作区”回退改为根据 workspace 所属 session 的活跃时间推导，适配 DSH 0.1.2 移除 `recentWorkspaceId` 的变化。

## [0.1.8] - 2026-08-27

### Added

- 浏览器面板头部新增当前工作区 HTML 文件快捷菜单，按文件夹层级展开/收起，可直接在浏览器视图中打开，无需返回文件树查找；支持重新扫描，并自动跳过 `node_modules` 和 `.git` 等目录。

## [0.1.7] - 2026-08-27

### Added

- 在文件树中选择 `.html` / `.htm` 文件时自动切换到侧栏“浏览器”视图，并新建标签页查看，不会覆盖已打开的网站；通过新增的 loopback 本地文件路由加载 HTML 及其相对资源。
- 浏览器标签页会尽量抓取已加载页面的 `<title>` 作为标签标题，而不是只显示地址。

## [0.1.6] - 2026-08-27

### Added

- 新增“浏览器”视图：内置 Bing 搜索首页与地址栏，支持后退 / 前进 / 刷新 / 主页，以及在外部浏览器中打开当前页面。
- “浏览器”视图支持 Edge 风格多标签页：可新建、切换、关闭标签页，每个标签页独立保留自己的导航历史。

### Changed

- 移除侧栏最大宽度限制，现在可以拖拽扩展到任意宽度。
- 完善浏览器面板的 UI 与交互细节，提升视觉一致性和使用手感。
- 更新客户端契约回归测试，覆盖浏览器视图中 body 兄弟节点挂载与非 slot 约定。

## [0.1.5] - 2026-08-26

### Performance

- 加快文件树加载速度，缓存会话根目录。

### Fixed

- 修复文件内容变化时预览区域闪烁的问题。

## [0.1.4] - 2026-08-26

### Changed

- 将 DSH 依赖升级到 `0.1.1-rc.2`。
- 构建时自动生成 `lib/`，并加固跨平台路径处理。

### Fixed

- 修复 Git 详情分隔条不可拖拽的问题。

## [0.1.2] - 2026-08-26

### Added

- 新增 Git 追踪面板：改动、历史、分支，支持分支切换、拉取、推送和自动刷新。
- 新增文件变化自动刷新：文件树、当前预览和 Git 状态会随工作区变化自动更新。
