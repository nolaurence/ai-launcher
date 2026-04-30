# Mica Launcher

Win11 Mica 风格的 Electron + TypeScript 启动器原型。

## 功能

- `Alt+Space` 呼出 Launcher。
- 输入应用名搜索 Windows 开始菜单中的 `.lnk` / `.exe` / `.appref-ms`。
- 输入颜色编码直接显示色块，支持 `#fff`、`#ffffff`、`#ffffffff`、`0xRRGGBB`、`rgb()`、`hsl()` 和常见颜色名。
- 输入简单计算式直接显示结果。
- 输入 `clip`、`clipboard` 或 `剪贴板` 打开剪贴板历史。
- `Ctrl+Shift+V` 呼出剪贴板历史。
- 剪贴板历史最多 1000 条，支持文本、图片、文件路径和视频路径预览。
- Launcher 输入文本后按 `Tab` 进入快速 AI 窗口。
- AI 窗口可配置 pi-coding web-ui、API 地址、启动命令，并带技能开关管理区域。

## 开发

```powershell
npm.cmd install
npm.cmd run dev
```

如果系统禁止执行 `npm.ps1`，请使用 `npm.cmd`。

## 配置

运行后会在 Electron 的 `userData` 目录生成 `settings.json`，可配置：

- `clipboardMaxItems`
- `shortcuts.launcher`
- `shortcuts.clipboard`
- `piCoding.webUrl`
- `piCoding.apiBaseUrl`
- `piCoding.command`
- `skills`

## 说明

项目源代码强制 TypeScript，未使用 JavaScript 源文件。构建输出会由 TypeScript/Vite 生成 `.js` 文件，这是 Electron 运行所需产物。
