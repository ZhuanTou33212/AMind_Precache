# annot.aminer.cn — 网页全栈分析报告

> **URL:** `https://annot.aminer.cn/project/label_page_feed/241929?start=1782176400`
> **分析工具:** Jina Reader（内容提取）、curl/Invoke-WebRequest（HTTP 层）、静态 JS 分析（DOM/框架层）
> **分析日期:** 2026-06-24

---

## 1. HTTP 层分析

### 1.1 请求-响应摘要

| 项目 | 值 |
|------|-----|
| URL | `https://annot.aminer.cn/project/label_page_feed/241929?start=1782176400` |
| 方法 | GET |
| 状态码 | **200 OK** |
| 内容长度 | 2,111 bytes |
| 内容类型 | `text/html` |

### 1.2 响应头分析

| Header | 值 | 含义 |
|--------|------|------|
| `Server` | `openresty/1.27.1.1` | 基于 Nginx 的 Web 服务器，支持 Lua 脚本扩展 |
| `Content-Type` | `text/html` | HTML 文档 |
| `Content-Length` | 2111 | 极小的 HTML shell（SPA 特性） |
| `Cache-Control` | `no-store, no-cache` | **禁止缓存** — 每次请求都从服务器获取最新内容 |
| `ETag` | `"6a39e902-83f"` | 弱验证 ETag（`83f` = 2111 bytes hex，与 Content-Length 一致性校验） |
| `Last-Modified` | `Tue, 23 Jun 2026 02:01:38 GMT` | 最后修改时间 |
| `Accept-Ranges` | `bytes` | 支持断点续传/部分请求 |
| `Connection` | `keep-alive` | 长连接复用 |
| `Date` | `Tue, 23 Jun 2026 16:55:54 GMT` | 响应时间 |

### 1.3 Cookie 分析

- 初始 GET 请求 **无任何 Cookie 下发**
- 当前未认证，页面需登录后才能使用完整功能

### 1.4 URL 参数分析

```
https://annot.aminer.cn/project/label_page_feed/241929?start=1782176400
```

| 参数 | 值 | 分析 |
|------|------|------|
| `path` | `/project/label_page_feed/241929` | RESTful 路由：项目ID = 241929 的标注页面 feed |
| `241929` | 项目 ID | 可能对应标注项目的唯一标识 |
| `start` | `1782176400` | Unix 时间戳（2026-06-23 01:00:00 UTC），推测为时间范围起点 |

---

## 2. DOM 层分析

### 2.1 HTML 结构

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <link rel="icon" href="/assets/zxh-b45be9b0.ico" />
  <meta name="description" content="To be continued" />
  <title>ZP Crazy Annotation Platform</title>
  <script type="module" crossorigin src="/assets/index-99d6c266.js"></script>
  <link rel="stylesheet" href="/assets/index-f9c290e4.css">
</head>
<body>
  <noscript>You need to enable JavaScript to run this app.</noscript>
  <div id="root"></div>
  <!-- Lark SDK -->
  <script src="https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.28.js"></script>
</body>
</html>
```

### 2.2 SPA 架构分析

这是一个典型的 **React 单页应用（SPA）**：
- **挂载点:** `<div id="root"></div>` — 所有内容由 JS 动态渲染
- **无 JS 后备:** `<noscript>` 提示需要启用 JavaScript
- **JS 主包:** `/assets/index-99d6c266.js`（Vite 构建，模块脚本）
- **CSS 包:** `/assets/index-f9c290e4.css`

### 2.3 favicon 与 PWA

| 资源 | 路径 |
|------|------|
| favicon | `/assets/zxh-b45be9b0.ico` |
| 应用名称 | `react-template-admin`（manifest.json）|
| manifest | `/manifest.json` |
| PWA 模式 | `standalone` — 可安装为桌面应用 |
| 图标 | favicon.ico、logo192.png、logo512.png |

---

## 3. 框架与技术栈分析

### 3.1 前端框架

| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 18.x | 核心 UI 框架 |
| **React Router** | v6.14.2 | 客户端路由 |
| **Vite** | （最新） | 构建工具、HMR |
| **TypeScript** | — | 类型安全 |
| **Tailwind CSS** | v3 | 原子化 CSS（shadcn/ui） |
| **shadcn/ui** | — | Radix UI + Tailwind 组件库 |
| **Ant Design** | （antd） | 企业级 UI 组件 |
| **Radix UI** | — | 无障碍 UI 原语 |

### 3.2 JS 包分析（从 bundle 中发现）

| 依赖 | 说明 |
|------|------|
| `@remix-run/router` | React Router 底层路由引擎 |
| `@ant-design/icons` | Ant Design 图标库 |
| `@ant-design/fast-color` | 高性能颜色处理 |
| `antd-style` | Ant Design CSS-in-JS |
| `radix-ui/*` | 多个组件：navigation-menu、select、dropdown-menu、hover-card、menubar、toast、collapsible、tabs、dialog、popover、tooltip 等 |
| `lucide-react` | 图标库 |
| `classnames` | 条件类名拼接 |
| `recharts` | 图表（可能性大） |
| `date-fns` | 日期处理（从 Calendar 组件推断）|

### 3.3 第三方集成

| 集成 | 用途 |
|------|------|
| **飞书 Lark SDK** | 企业即时通讯集成，用于发送标注通知/消息 |
| `lf1-cdn-tos.bytegoofy.com` | Lark SDK CDN（字节跳动）|

### 3.4 自定义特性

- **MapleMono 字体:** 等宽编程字体，WOFF2 格式
- **Markdown 编辑器:** 内置 Markdown 编辑/预览（Typora 风格）
- **VConsole（注释掉）:** 调试用移动端控制台

---

## 4. 网络请求与资源分析

### 4.1 静态资源清单

| 资源 | 路径 | 大小（估计）|
|------|------|------------|
| 主 JS | `/assets/index-99d6c266.js` | ~2 MB |
| 主 CSS | `/assets/index-f9c290e4.css` | ~500 KB |
| 字体 | `/MapleMono-NF-Regular.woff2` | ~500 KB |
| favicon | `/assets/zxh-b45be9b0.ico` | ~15 KB |
| Lark SDK | `https://lf1-cdn-tos.bytegoofy.com/...` | ~50 KB |
| PWA Icons | `/logo192.png`, `/logo512.png` | ~50 KB |

### 4.2 推断的 API 端点

从框架结构和 URL 路径推断：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录（密码/SSO）|
| `/api/auth/logout` | POST | 退出登录 |
| `/api/user/info` | GET | 获取当前用户信息 |
| `/api/project/list` | GET | 项目列表 |
| `/project/label_page_feed/{id}` | GET | 项目标注页面 |
| `/api/label/task/list` | GET | 标注任务列表 |
| `/api/image/upload` | POST | 图片上传 |
| `/api/oss/config` | GET | OSS 配置 |
| `/api/label/submit` | POST | 提交标注结果 |

> **注:** 实际端点需通过登录后抓取或分析 JS bundle 获取

### 4.3 页面加载性能分析

```
1. DNS Lookup
2. TCP Connect
3. TLS Handshake
4. Request → Response (2111 bytes HTML)
5. Parse HTML → Discover JS/CSS assets
6. Fetch JS bundle (~2MB) + CSS (~500KB)
7. Parse/Execute JS → React 初始化
8. API calls → Fetch user data
9. Render full page
```

**关键瓶颈:** JS bundle 体积大（~2MB），首次加载慢

---

## 5. 安全分析

### 5.1 传输安全

| 项目 | 状态 |
|------|------|
| HTTPS | ✅ 启用 |
| HSTS | 未检测（需全量扫描）|
| CSP | 未在响应头中发现 |
| CORS | 需要登录后测试 |

### 5.2 应用安全

- SPA 无需 CSRF Token（JSON API 方式）
- 疑似 JWT/Access Token 认证（无 Cookie 下发）
- Lark SDK 可能用于企业内部 SSO 登录

---

## 6. 总结

### 6.1 架构图

```
┌─────────────────────────────────────────────────────────┐
│                   用户浏览器 (Chrome/Edge)                │
│  ┌─────────────────────────────────────────────────────┐│
│  │          React SPA (annot.aminer.cn)                 ││
│  │  Tailwind + shadcn/ui + Ant Design + Radix UI       ││
│  │  React Router v6 · TypeScript · Vite                ││
│  └──────────────────────┬──────────────────────────────┘│
│                         │ API calls                     │
└─────────────────────────┼──────────────────────────────┘
                          │
┌─────────────────────────┼──────────────────────────────┐
│                  openresty/1.27.1.1                     │
│  ┌──────────────────────┴──────────────────────────────┐│
│  │               API Gateway / Reverse Proxy            ││
│  └──────────────────────┬──────────────────────────────┘│
│                         │                                │
│  ┌──────────────────────┴──────────────────────────────┐│
│  │           Backend Services (Python/Go/Java?)         ││
│  │   Authentication · Project · Label · Image · OSS    ││
│  └──────────────────────┬──────────────────────────────┘│
│                         │                                │
│  ┌──────────────────────┴──────────────────────────────┐│
│  │              Database (MySQL/PostgreSQL?)             ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 6.2 关键发现

1. **SPA 架构** — 页面内容全部由 React JS 渲染，静态 HTML 仅为 2KB 的 shell
2. **企业级技术栈** — Ant Design + shadcn/ui 表明面向专业标注人员
3. **飞书集成** — Lark SDK 说明与字节跳动飞书系统对接
4. **禁止缓存** — `Cache-Control: no-store` 确保标注数据实时性
5. **标注平台** — "ZP Crazy Annotation Platform" 用于数据标注/标签任务管理
6. **项目ID 241929** — 具体标注项目，时间范围从 `start=1782176400`（2026-06-23）开始
7. **PWA 支持** — 可安装为桌面应用

### 6.3 建议后续分析

1. 使用浏览器 DevTools 登录后抓取 API 请求
2. 使用 Firecrawl `firecrawl_interact` 工具与 SPA 交互获取渲染内容
3. 分析 API 端点的鉴权方式（JWT/OAuth2）
4. 测试标注提交流程的完整 API 链路
5. 确认与 AMiner Desktop 的 OSS 缓存集成点
