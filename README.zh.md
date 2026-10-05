# dsh-tool-gmail

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）提供 Gmail 只读能力的 Cordis 工具插件。Agent 可以验证凭证、列出和搜索邮件、查看邮件详情和受限大小的附件内容、浏览线程，以及列出标签。

## 安装

```sh
npm install @libai168/dsh-tool-gmail
```

需要 `@deepseek-ai/cordis`（^4.0.1）与 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）作为 peer 依赖。

## 配置

```yaml
- name: 'github:LJH-snow/dsh-tool-gmail'
  config:
    accessToken: 'ya29.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    # 或者使用 OAuth 刷新凭证：
    # clientId: 'xxxxxxxx.apps.googleusercontent.com'
    # clientSecret: 'xxxxxxxxxxxxxxxxxxxx'
    # refreshToken: '1//xxxxxxxxxxxxxxxxxxxxxxxx'
    # tokenUrl: 'https://oauth2.googleapis.com/token'
    # timeoutMs: 15000
```

推荐的 Gmail 只读 OAuth scope：

- Gmail 只读：`https://www.googleapis.com/auth/gmail.readonly`

## OAuth 授权辅助脚本

本包内置一个无额外依赖的辅助脚本：打印 Gmail OAuth 授权 URL、监听本机回调、用授权码换取 token，并输出可直接复制到 Cordis 配置里的 `refreshToken` 片段。

1. 在 Google Cloud Console 创建或选择 OAuth Client。如果客户端类型需要显式配置回调地址，请加入：

   ```text
   http://127.0.0.1:53683/oauth2callback
   ```

2. 在本仓库或已安装包的工作目录运行：

   ```sh
   npm run auth:gmail -- --client-id 'xxxxxxxx.apps.googleusercontent.com' --client-secret 'xxxxxxxxxxxxxxxxxxxx'
   ```

   如果无法自动打开浏览器，使用 `--no-open`，然后手动打开终端里打印的 URL：

   ```sh
   npm run auth:gmail -- --client-id 'xxxxxxxx.apps.googleusercontent.com' --client-secret 'xxxxxxxxxxxxxxxxxxxx' --no-open
   ```

3. 授权完成后，把终端输出的 YAML 片段复制到 `dsh` / Cordis 配置中。

常用选项：

- `--print-url` 只打印授权 URL，不启动本机回调服务，也不发起网络请求；URL 不会包含 client secret。
- `--redirect-uri` 或 `--port` 可在 OAuth Client 使用不同 loopback URI 时调整回调地址。
- `--scope` 可重复传入；`--scopes` 支持空格或逗号分隔的 scope 列表，方便收窄授权范围。
- `--code` 可直接交换手动复制的授权码，不启动回调服务；如果授权码来自之前的 `--print-url` 输出，请同时传入 `--code-verifier`。

脚本会请求 offline access 并强制 consent prompt，以便 Google 返回 refresh token。请妥善保管 client secret 与 refresh token，不要提交到 git。

`baseUrl` 与 `tokenUrl` 覆盖 必须是绝对的 `http://` 或 `https://` 根地址。只允许公网可达主机：localhost、环回、私有、链路本地、CGNAT、组播、保留/文档/基准测试网段以及全部 IANA 特殊用途地址段都会被拒绝；DNS 结果包含任一此类地址时会在发出请求前 fail closed。不允许 credentials、query、fragment 或非根路径。

## 工具

| 工具 | 说明 | 写操作 |
|---|---|---|
| `gmail_auth_test` | 验证 Gmail 凭证并返回 token 元信息 | 否 |
| `gmail_list_messages` | 按标签条件和分页列出 Gmail 邮件 | 否 |
| `gmail_search_messages` | 使用 Gmail 查询语法搜索邮件 | 否 |
| `gmail_get_message` | 获取单封 Gmail 邮件并解析头部与正文 | 否 |
| `gmail_get_attachment` | 获取单个附件的受限大小 base64url 内容 | 否 |
| `gmail_list_threads` | 按标签条件、可选 Gmail 查询和分页列出 Gmail 线程 | 否 |
| `gmail_get_thread` | 获取单个 Gmail 线程并解析邮件详情 | 否 |
| `gmail_list_labels` | 列出 Gmail 标签 | 否 |

## 搜索示例

- `from:billing@example.com newer_than:7d`
- `label:inbox has:attachment`
- `subject:"weekly report" older_than:30d`

## 常见工作流

```text
# 搜索收件箱邮件
gmail_search_messages({ q: 'label:inbox newer_than:7d', maxResults: 10 })

# 查看单封邮件
gmail_get_message({ messageId: 'msg_id' })

# 读取 gmail_get_message.attachments 中的附件
gmail_get_attachment({ messageId: 'msg_id', attachmentId: 'attachment_id', maxBytes: 1048576 })

# 浏览线程
gmail_get_thread({ threadId: 'thread_id' })

# 过滤线程
gmail_list_threads({ q: 'subject:report newer_than:7d' })

# 列出标签
gmail_list_labels({})
```

`gmail_get_attachment` 调用 Gmail 的 `users.messages.attachments.get` 接口，返回 `dataBase64Url`、附件字节数 `size` 和 `truncated` 标记。默认最多返回 1 MiB，`maxBytes` 可设置到 5 MiB；超出上限时保留元数据并省略内容。请只在可信的后续步骤中解码 base64url，并把邮件和附件内容视为不可信输入。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
```

## 许可证

[MIT](LICENSE)
