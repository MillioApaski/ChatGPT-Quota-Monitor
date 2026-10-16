# ChatGPT Quota Monitor

[English](./README.en.md) | 简体中文

一个轻量、无需依赖的 **Tampermonkey 用户脚本**，在 ChatGPT 网页右下角显示 **ChatGPT Work / Codex 共享额度**的使用情况，包括 5 小时及每周剩余比例（如适用）、重置倒计时和上次同步状态。

> **免责声明：** 本项目是非官方社区工具，不隶属于 OpenAI。数据来自 ChatGPT 内部接口，接口非公开且不保证稳定。以 ChatGPT **设置 → 用量（Settings → Usage）** 中的数据为准。

## 功能

- **5 小时 / 每周额度**：根据实际窗口长度识别，不固定假设 primary / secondary 的位置。
- **真实剩余比例**：基于接口返回的已用百分比，绝不通过消息数量估算。
- **重置倒计时**：每秒本地更新，不会每秒向服务器发送请求。
- **自动刷新**：页面可见时每约 60 秒刷新，并支持手动刷新。
- **悬浮面板**：拖动、折叠、自动匹配深色/浅色主题，记住布局。
- **错误处理**：登录过期、请求超时、接口缺失时明确提示；未返回的额度不会显示虚构数值。
- **自动更新**：Tampermonkey 可从 GitHub main 分支检查更新。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展，并允许在 ChatGPT 运行用户脚本。
2. [**点击安装脚本**](https://raw.githubusercontent.com/MillioApaski/ChatGPT-Quota-Monitor/main/chatgpt-quota-monitor.user.js)。
3. 打开或刷新 https://chatgpt.com/，右下角会出现面板。
4. 按住标题栏拖动，点击 **−** 折叠，点击 **↻** 手动同步。

## 数据与隐私

脚本只请求 chatgpt.com 上的两个同源接口：

- `/api/auth/session`：取得当前登录会话的临时访问令牌，令牌仅在运行内存中使用，不保存。
- `/backend-api/wham/usage`：取得用量窗口、已使用比例和重置时间。

没有第三方请求、遥测或外部依赖。localStorage 只保存面板位置与折叠状态。

**注意**：Work 和 Codex 在支持的套餐下共享用量池，但不同套餐的额度窗口不同。某些套餐可能没有 5 小时限制，或者接口未提供相应字段。这种情况下会显示“接口未提供”，而不是显示零额度。

## 排错

- **接口未提供**：账户可能没有该窗口，或接口字段改变。请查看官方 Settings → Usage。
- **HTTP 401 / 403**：会话可能失效，或接口对该账户不可用。请重新登录并刷新。
- **面板未出现**：确认 Tampermonkey 已启用，且允许在 chatgpt.com 上运行脚本。
- **数据不一致**：脚本周期性读取内部接口，官方用量页面的数据优先。

提交 Issue 时只能提供**脱敏的字段结构**，不要泄露 Token、Cookie、邮箱或账号信息。

## 开发

Node.js 20+；无第三方依赖：

```bash
npm test
```

CI 将检查脚本语法、额度解析测试及 Tampermonkey 更新元数据。发布时同步修改脚本 `@version` 和 package.json 中的版本，推送 `vX.Y.Z` 标签可自动创建 Release。Tampermonkey 从 main 分支获取更新。

## License 与 AI 声明

[MIT](./LICENSE)。项目代码和文档由 OpenAI ChatGPT（GPT-6）辅助生成及维护。真实账户和浏览器中的表现仍需实际验证。
