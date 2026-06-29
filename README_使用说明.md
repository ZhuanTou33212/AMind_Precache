# AMiner 图片预缓存系统 使用说明

## 文件说明

- `aminer-desktop.exe`: 本地缓存服务，提供 `http://127.0.0.1:9800`
- `extension/`: 浏览器扩展，负责自动同步 Token、预取图片、替换页面图片地址
- `extension/settings.json`: 缓存数量默认配置，当前默认 `200`
- `启动_AMiner预缓存.bat`: 双击启动本地服务并打开 Edge 标注页面
- `启动_AMiner预缓存.ps1`: PowerShell 启动脚本

## 第一次使用

1. 解压整个文件夹到本机任意位置。
2. 双击运行 `启动_AMiner预缓存.bat`。
3. 如果 Windows 提示脚本执行限制，可执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\启动_AMiner预缓存.ps1
```

4. Edge 打开后登录 AMiner 标注页面。
5. 正常进入标注页后，扩展会自动同步 Token、任务 ID 和日期到本地服务。
6. 等待缓存数量增长，页面图片会逐步切换为本机加载。

## 修改缓存数量

标注页面左下角会出现缓存控制条：`已缓存 X 张 / 目标 [输入框] 保存`。
直接输入想要预缓存的图片数量并点击“保存”即可生效；这个值会保存在当前 Edge 扩展配置里，下次打开仍会使用。

也可以在分发前编辑 `extension/settings.json` 作为默认值：

```json
{
  "cacheSize": 200
}
```

支持范围: 大于等于 `1`，程序不再设置人为最大上限。数字越大，首次预取越慢，占用磁盘越多，但后续标注等待图片的概率越低；实际可缓存数量仍受任务剩余图片数量和本机资源影响。

如果只修改 `extension/settings.json`，请关闭 Edge 后重新运行 `启动_AMiner预缓存.ps1`。

## 修改标注入口

打开 `启动_AMiner预缓存.ps1`，修改顶部的 `$StartUrl`：

```powershell
$StartUrl = 'https://annot.aminer.cn/project/label_page_feed/181903?start=1781830800'
```

其中：

- `181903` 是任务 ID
- `start=...` 是 AMiner 页面日期参数

## 日常使用

每次使用时：

1. 运行 `启动_AMiner预缓存.bat`
2. 在打开的 Edge 里正常标注
3. 不需要手动复制 Token

## 故障排查

- 图片不缓存：确认 `aminer-desktop.exe` 正在运行，且 Edge 加载了 `extension/`
- 缓存数量不变：刷新标注页，或关闭 Edge 后重新运行启动脚本
- 401/invalid signature：Token 过期，刷新 AMiner 页面并重新登录
- 页面提示没有数据：检查 `$StartUrl` 里的 `start` 日期是否是当前可用日期
- 端口被占用：关闭已有的 `aminer-desktop.exe` 后重试

## 不要分发的数据

不要把运行后生成的 `data/` 目录发给别人。里面可能包含 Token、SQLite 缓存和图片文件。
