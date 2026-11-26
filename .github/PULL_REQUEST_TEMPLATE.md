## 改动说明 / Summary

- 简要说明本次 PR 解决的问题或新增的能力（请保持 PR 范围精简，避免单次混入大量无关改动）。

## 验证结果 / Verification

- [ ] 已运行 `npm test` 且全部通过
- [ ] 已运行 `npm run security:check` 且全部通过
- [ ] 如涉及安装包/站点改动，已运行 `node scripts/build-release.mjs` / `npm run build:site`

## 高危变更自查 / Security Checklist

如果本次 PR 涉及以下任意一项，请勾选并在上方说明原因与安全影响：

- [ ] 新增或升级了第三方依赖（`package.json` / `package-lock.json` / `lib/vendor/`）
- [ ] 修改了 CI / 工作流 / 安装卸载脚本（`.github/`、`install.*`、`uninstall.*`、`scripts/`）
- [ ] 修改了 Agent 规则或技能文件（`rules/`、`skills/`）
- [ ] 修改了外部命令执行、网络请求、代理、SSH、凭据或更新校验逻辑
- [ ] 确认未提交任何真实密钥、Token、个人路径或隐藏控制字符
