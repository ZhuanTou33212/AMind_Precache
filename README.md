# AMiner 图片预缓存系统

## 概述
三组件协作的本地图片缓存加速系统，将标注页面的 OSS 图片请求替换为本地缓存，加载延迟从 200-700ms 降至 5-50ms。

## 组件
| 组件 | 位置 | 端口 | 作用 |
|------|------|------|------|
| 桌面应用 | dist/AMiner-Precache/aminer-desktop.exe | 9800 | 下载/存储/提供图片 |
| 浏览器扩展 | extension/ | — | 检测题号、替换图片 URL、触发缓存 |
| Edge 浏览器 | system | — | 运行标注页面 + 扩展 |

## 启动
### 一键启动
双击 `启动_AMiner预缓存.bat`

### 分步启动
```
1. 启动桌面应用: dist\AMiner-Precache\aminer-desktop.exe
2. 打开标注页面（扩展已手动安装到 Edge）
```

## 配置
- 桌面应用 UI → 配置面板 → Cache 输入框 → 修改数字 → 保存
- settings.json: `{ "cacheSize": 200 }`
- 缓存数量每 2 秒自动刷新

## 编译
```
cd src-aminer-desktop
D:\go\bin\go build -buildvcs=false -o ..\aminer-desktop.exe .
copy ..\aminer-desktop.exe ..\dist\AMiner-Precache\
```

## 安装扩展
1. 打开 edge://extensions/
2. 开启开发人员模式
3. 将 extension/ 文件夹拖入扩展页面

## 工作原理
```
网页 React 设置 img.src
  → monitor.js MutationObserver 检测新 img
  → 替换 src: OSS URL → http://127.0.0.1:9800/api/image/{hash}
  → 浏览器从本地桌面应用加载（1-5ms）

同时:
  monitor-main.js 检测题号 → background.js
  → background.js → 桌面应用预缓存 N 张图片
```

## 文件结构
```
aminer-desktop/
├── dist/AMiner-Precache/aminer-desktop.exe
├── extension/
│   ├── manifest.json      # 权限: storage
│   ├── background.js       # service worker
│   ├── monitor-main.js     # 页面监控(MAIN world)
│   ├── monitor.js          # 图片替换(ISOLATED world)
│   ├── rules.json          # 空
│   └── settings.json       # cacheSize
├── src-aminer-desktop/     # Go 源码
├── data/                   # 运行时数据
├── Obsidian/backups/       # 备份
└── 启动_AMiner预缓存.bat
```

## 修复记录
| 问题 | 修复 |
|------|------|
| DNR 规则重定向 OSS → 9801 图片全挂 | 移除 declarativeNetRequest 权限 |
| background.js PROXY 未定义崩溃 | 删除 DNR 代理代码 |
| monitor-main.js 拦截 img.src 重定向代理 | 删除图像代理模块 |
| --load-extension 不生效 | Edge 手动安装扩展 |
| cacheSize 不控制上限 | SetMaxKeep + 锁粒度修复 |
| 缓存数量不自动更新 | UI setInterval 轮询 |
| 云端进度不自动清理 | 自动启动 pollAnnotations |
| 保存配置卡死 | 异步 loadPrompts |
| 扩展覆盖 cacheSize | API 按字段合并 |
