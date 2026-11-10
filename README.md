# PromptStudio

提示词管理 / 逐词翻译 / AI 一键生成 / 返图管理 / ComfyUI MOSS-Image 画框布局。

## 安装（普通用户）

1. 打开 [Releases](https://github.com/CtingBall/PromptStudio/releases/latest)，下载 `PromptStudio-Setup-x.y.z.exe`。
2. 双击安装。Windows 提示「已保护你的电脑」时，点「更多信息 → 仍要运行」（安装包没有付费签名）。
3. 打开后在 ⚙️ 设置里填 AI 的 API 地址和 Key。

之后有新版本会自动下载，下载完会提示重启更新。数据保存在本机，更新和卸载重装都不会丢。

从旧的网页版（启动.bat）迁移：在网页版设置里点「备份全部数据」，再在桌面版点「导入」选那个文件。

## 开发

```
pnpm install
pnpm dev        # 浏览器调试 http://localhost:5188
pnpm app        # 另开一个终端：用桌面窗口打开 dev 服务器
pnpm dist       # 本地打安装包到 release/
```

## 发布新版本

1. 改 `package.json` 里的 `version`，提交。
2. `git tag v0.1.1 && git push origin main --tags`
3. GitHub Actions 自动构建安装包并发布到 Releases，已安装的用户会自动更新。
