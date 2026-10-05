# dsh-tool-gmail 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-gmail` |
| 定位 | DeepSeek Harness 的 Gmail 只读集成插件 |
| 版本 | v0.1.0 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | Gmail API v1 |
| 认证 | static access token 或 OAuth refresh token |

### 1.1 目录

```text
src/client.ts        GmailClient：token 管理、fetch 注入、错误映射、邮件/线程/标签映射
src/index.ts         7 个 defineTool 定义与插件 apply
scripts/auth-gmail.mjs  OAuth 授权辅助脚本，用于生成 refreshToken 配置
tests/client.spec.ts    客户端契约测试
tests/tools.spec.ts     工具注册、凭证保护、业务值测试
tests/auth-script.spec.ts OAuth helper 的非交互契约测试
examples/cordis.yml     dsh 组合配置示例
```

## 2. 技术决策

### 2.1 认证

Gmail 插件支持两种常见场景：
- accessToken：直接使用现成 OAuth access token，适合本地快速接入。
- clientId + clientSecret + refreshToken：通过 OAuth refresh token 自动换取并缓存 access token。

`npm run auth:gmail` 提供本地授权辅助流程：生成 Google 授权 URL，监听 `127.0.0.1` loopback callback，用授权码请求 token endpoint，并输出可复制的 Cordis YAML。脚本使用 Node 内置模块实现，不引入 Google SDK 运行时依赖；授权 URL 包含 `access_type=offline`、`prompt=consent` 与 `include_granted_scopes=true`。

### 2.2 工具范围

v0.1 覆盖常见只读 Gmail 工作流：
- 凭证检查。
- 邮件列表/搜索与邮件详情查看。
- 线程列表筛选与线程详情查看。
- 标签列表查看。
- Gmail 查询语法过滤，例如 `from:`, `label:`, `subject:`, `has:attachment`, `newer_than:`。

### 2.3 错误映射

| 场景 | 返回/行为 |
|---|---|
| 未配置凭证 | `{ ok: false, reason }` 或 `{ found: false, reason }` |
| Gmail API 非 2xx | 抛 `GmailError` |
| 超时或网络失败 | 透传异常 |

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
```

当前测试覆盖：

- 静态 access token 认证。
- refresh token 换取 access token 与缓存。
- 邮件列表与搜索参数。
- 邮件详情、正文与附件解析。
- 线程列表与线程详情。
- 标签列表。
- 工具注册、render 函数与输出 schema。
- OAuth helper `--print-url` 非交互路径、授权 URL 参数、secret 不出现在 URL/输出、自定义 scopes、端口配置和 npm/bin 入口。

## 4. 后续方向

- 邮件附件提取与落盘。
- 线程摘要更友好的列表视图。
- 支持按标签/查询组合的更快聚合工具。
