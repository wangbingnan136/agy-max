# Security Policy / 安全策略

## Supported Versions / 受支持版本

目前仅对最新的主发布版本与 `main` 分支提供安全修复。

| Version | Supported |
| --- | --- |
| Latest `1.x` / `main` | Yes |
| Older releases | No |

## Reporting a Vulnerability / 如何报告安全漏洞

**请勿通过公开的 GitHub Issue、Discussion 或 Pull Request 披露安全漏洞。**
**Please do NOT report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

请优先通过 GitHub 的 **Private Vulnerability Reporting（私密漏洞报告）** 提交：

1. 打开本仓库的 **Security → Advisories → Report a vulnerability** 页面。
2. 提供漏洞类型、受影响文件/版本、最小复现步骤与潜在影响（提交日志或截图前请抹去个人 Token、凭据与隐私路径）。

### 响应预期 / Response Expectations

- 收到报告后通常在 **72 小时内** 确认受理并评估严重程度。
- 在修复补丁与新版本发布前，请协助保持漏洞细节保密。

## Security Scope / 重点安全边界

本项目作为本地桌面工作台增强插件，重点保护以下边界：

- 系统凭据库与多账号隔离（`lib/credential-vault.mjs`、`lib/accounts.mjs`）
- 安装包 / 应用内更新的完整性与 SHA-256 校验（`lib/package.mjs`、`lib/update-manager.mjs`、`lib/updates.mjs`）
- 本地 CDP、代理、SSH 与外部命令执行边界（`lib/proxy.mjs`、`lib/ssh-config.mjs`、`lib/ssh-remote.mjs`、`lib/omni-gateway.mjs`、`lib/launcher.mjs`）
- 仓库自动化流程与 Agent 规则安全（`.github/workflows/`、`rules/`、`skills/`）
