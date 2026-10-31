# Claude Inline Math Unlimited

[English](README.md) · [MIT 许可证](LICENSE)

为 Windows Claude Desktop 的 Code 页提供可回滚的本地缓存补丁，移除已观察到的 **60 字符行内公式识别限制**。

原始修复已在一台安装 Windows 商店版 Claude `4.4212.0.0` 的电脑上验证：旧会话与新会话中的长公式都恢复了显示。本项目将该方法整理成自动定位、备份、校验和回滚工具。通用版 CLI 已通过自行构造的缓存样例测试，尚未覆盖所有版本和安装方式。

**实验性、非官方工具。** 仅处理可识别的公式模块，不保证未来版本、其他操作系统或所有公式都能使用。它移除两个长度判断，其他公式识别规则、KaTeX 语法、宏展开限制以及内存和性能限制仍然存在；极长公式可能拖慢应用。

## 原理

部分合法 `$…$` 公式在 60 字符时显示正常，达到 61 字符后显示为原始文本。虽然页面在客户端渲染，但 JavaScript 来自 Anthropic 的线上资源服务器，因此只修改安装包中的 `ion-dist.asar` 不会影响当前页面。

本工具只识别缓存中兼容的 `ce044ea01-*.js` 公式模块，核对导出结构、长度判断和字符计数调用后，把 `60` 和 `1024` 两个常量改成 JavaScript 无穷大 `1/0`。修改前后的源码字节数不变；重新压缩后的响应字节数也保持不变，必要时补入 Zstandard 可跳过帧。只写入目标响应体，不改缓存条目元数据和 HTTP 头，并把对应的 JavaScript 编译缓存移动到备份目录，让 Chromium 重新编译。

不执行缓存脚本，不修改聊天、安装包、系统权限、证书或调试设置，不使用代理。补丁命令不发网络请求、不上传诊断、不收集遥测，也不绕过登录、订阅或模型访问限制。

## 使用

需要 Windows 和 [Node.js 24+](https://nodejs.org/en/download)。无需 npm 依赖或管理员权限，无需执行 `npm install`。

先正常打开 Claude 的 Code 会话，让包含公式的消息显示一次，以便相关脚本进入缓存。

```powershell
git clone https://github.com/gzyhssssu/claude-inline-math-unlimited.git
cd claude-inline-math-unlimited
node bin/cli.js doctor
```

`doctor` 只读检查兼容、已修改和跳过的缓存资源。历史缓存可能包含多个版本，检查结果不能保证当前页面将加载哪一份。输出可能包含本机配置目录路径，分享前请自行隐去。

**从系统托盘完全退出 Claude**，再执行：

```powershell
node bin/cli.js install
```

随后重新打开 Claude，在旧会话和新会话分别检查超过 60 字符的公式。`success: true` 表示选中的缓存资源已处理，仍需在界面验证效果。工具不会替你结束任何进程。

自动定位有歧义时，用 `--profile` 指定包含 `Cache` 和 `Code Cache` 的目录：

```powershell
node bin/cli.js doctor --profile "$env:LOCALAPPDATA\Claude-Data\claude_PACKAGEFAMILY"
```

将示例中的目录名换成本机实际名称。Windows 商店版配置结构已实测；其他 Windows 安装方式需要缓存格式兼容。安装和回滚暂不支持 macOS/Linux。

## 备份与回滚

默认状态目录：`%LOCALAPPDATA%\claude-inline-math-unlimited\`，与项目源码分开。备份包含本机目标脚本及其编译缓存，请保留在本机，不要提交到 GitHub；工具不会主动导出聊天记录、Cookie 或账号令牌。

完全退出 Claude 后执行：

```powershell
node bin/cli.js restore
```

可以用 `--backup BACKUP_ID` 选择历史备份，或通过 `--state-dir PATH` 指定状态目录；安装与回滚应使用同一状态目录。

回滚会校验备份哈希，并按 URL 和响应体哈希重新寻找条目，不盲写旧偏移。缓存已回收或重新下载时会跳过，避免覆盖被复用的空间。普通写入错误会尝试恢复原内容，但断电或磁盘故障仍可能需要人工恢复，不能保证崩溃时的原子性。

意外中断后若残留 `operation.lock`，先确认没有补丁进程运行，再重命名该锁文件。备份日志会在写入缓存前落盘。

## 能保持多久

只要应用继续使用同一份缓存，正常重启通常可保留修复。但**线上前端更新不一定伴随桌面 App 更新**：脚本换名、清缓存、应用修复/重装或服务器重新下发响应，都可能让补丁失效。

失效后退出 Claude，重新运行 `doctor` 和 `install`。只要源码结构和缓存格式兼容，工具可以识别变化后的变量名和资源文件名；遇到不兼容结构或无法等长压缩的响应会拒绝修改，届时可能需要更新工具。当前没有后台自动维护服务，也不保证永久有效。

可选启动器会先执行同样的检查和补丁，再启动 Windows 商店版 Claude：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Launch-Claude.ps1
```

仍需先完全退出 Claude。新脚本尚未进入缓存时，先正常打开一次公式会话，再退出重试；启动器不会绕过兼容性检查。

## 测试与贡献

```powershell
npm test
```

测试只在系统临时目录构造虚拟缓存，不打开真实配置，不连接 Claude 或 GitHub。覆盖长度变换、解压上限、等长压缩、块分配校验、编译缓存精确匹配、重复安装、回滚、条目移动、写入故障和备份篡改。

项目不分发 Claude 原始代码、提取脚本、二进制文件、真实缓存样例或聊天截图。MIT 许可证仅覆盖本工具自身；本机被修改的第三方资源不因此改变许可证。

提 Issue 请描述操作系统、Claude 版本和现象。**不要上传配置目录、备份、原始缓存、聊天记录或凭据。** 兼容格式依据和英文说明见 [README](README.md)。

本项目与 Anthropic 无隶属或背书关系。
