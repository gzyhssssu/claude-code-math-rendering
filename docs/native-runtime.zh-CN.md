# 原版入口常驻模式（Windows，实验性）

[English](native-runtime.md) · [项目说明](../README.zh-CN.md)

此模式保留原来的 Claude 图标和启动入口，每次启动时自动为受支持的线上公式脚本应用补丁，不依赖之前修改过的 HTTP 缓存。

**会修改 `resources/app.asar` 以及 `claude.exe` 中对应的归档校验哈希，使 EXE 的原 Authenticode 数字签名失效。** Electron 的 ASAR 完整性校验开关保持启用。Windows 商店保护目录的安装和回滚需要管理员权限；需要保留签名时，请使用缓存模式。

已在一台 Windows 商店版 Claude **4.4212.0.0** 上验证：从原版入口启动，正常退出，再从同一入口启动，两次均自动处理三层公式模块。隔离副本的引号、长公式、单字符、纯数字检查在重启后仍通过。完整客户端副本的安装和回滚也通过，回滚后 EXE 签名恢复为 Valid。这不代表所有版本或安装方式都兼容。

## 准备条件

- Windows、Node.js 24+、Python 3.11+，以及本机兼容的 Claude Desktop。
- 保留准备时使用的 Node 安装路径：运行时通过该 Node 执行公式转换与语法检查。
- 安装或回滚前通过“文件 → 退出”或托盘菜单完全退出 Claude。工具不会结束进程。
- 生成包必须保存在源码目录之外，可能占用数百 MB。包里包含第三方客户端文件和本机安装路径，**不要上传到 GitHub、Issue 或 Release**。

## 本机准备（无需管理员权限）

在项目目录运行 PowerShell：

```powershell
$claudePackage = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1
if (-not $claudePackage) { throw '未找到商店版 Claude，请手动指定安装的 app 目录。' }
$claudeApp = Join-Path $claudePackage.InstallLocation 'app'
$nativeState = Join-Path $env:LOCALAPPDATA ('claude-code-math-rendering\native\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
node bin/cli.js native-prepare --app-dir "$claudeApp" --output "$nativeState"
```

其他安装方式可手动将 `$claudeApp` 指向包含 `claude.exe` 和 `resources/app.asar` 的目录，但归档和启动脚本结构也必须兼容。准备命令只在输出目录写入原始备份和候选文件，不修改已安装客户端。确认命令成功后再继续。

输出目录必须新建或为空，请一起保留 `manifest.json`、`*.before`、`*.after`。已安装常驻钩子时不能再次对同一启动归档准备新包；请使用原 manifest 检查或回滚。

## 安装和检查

完全退出 Claude 后：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Native.ps1 -Action install -Manifest "$nativeState\manifest.json"
```

系统可能弹出 UAC，请本人确认。提升权限后需使用同一份 Python；自动定位不明确时，可加 `-Python 'C:\path\to\python.exe'`。

继续用原图标启动 Claude，打开旧公式会话，再完全退出并重启检查。文件安装成功不等于实际页面已加载补丁。

无需提权的文件状态检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Native.ps1 -Action check -Manifest "$nativeState\manifest.json"
```

运行日志位于 Claude 当前配置目录的 `ccmr-runtime.jsonl`。商店版通常为 `%LOCALAPPDATA%\Claude-Data\claude_PACKAGEFAMILY`；重启后应出现新的 `attached` 和 `patched` 事件。日志记录补丁类型、公共脚本文件名、时间和状态，不主动记录聊天、Cookie 或凭据。分享诊断前仍请去掉本机路径。

## 回滚

完全退出 Claude，再使用本次安装对应的 manifest：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Manage-Native.ps1 -Action restore -Manifest "$nativeState\manifest.json"
```

回滚恢复到常驻安装之前的字节；原 EXE 签名有效时也会恢复有效签名，安装前已有的其他改动仍保留。工具会校验备份和当前文件，拒绝覆盖不认识的内容，并在写入期间独占两个目标文件。普通写入失败会尝试恢复两者的起始状态，结果记入本地日志；断电或磁盘故障仍可能需要手动恢复。

## 能保持多久

- 普通退出、重启 App 或电脑后会重新加载，无需额外启动器、后台服务或计划任务，也不使用代理、证书、外部调试端口或安全开关修改。
- 线上脚本换文件名后，只要模块前缀和源码结构仍受支持，也会自动处理。不兼容结构将放行原响应，可能需要更新本工具。KaTeX 语法和资源限制保留。
- 桌面客户端更新、商店修复、重装可能覆盖钩子。届时为新版本选择新输出目录，重新准备和安装。**不要拿旧包回滚覆盖更新后的客户端**；哈希校验会阻止这种写入。
- 只升级本工具、桌面版本没变时，先用旧 manifest 回滚，再用新版工具准备新包并安装。在恢复之前保留旧备份。
- 钩子只在 Claude 页面导航时挂接进程内 debugger，已有 debugger 时跳过。打开 DevTools 可能导致其脱离，重启 Claude 可恢复；其他使用同一 debugger 的工具可能冲突。
- 只截取精确 Anthropic 资源域名下四种受支持公式模块的 GET/200 脚本响应。其他流量、跳转和不兼容代码直接放行；转换器只做静态改写与语法解析，模块最后由客户端正常执行。

源码和技术依据见[英文说明](native-runtime.md)。
