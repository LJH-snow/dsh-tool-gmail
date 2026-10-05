# dsh-tool-gmail

[English](README.md) | [中文](README.zh.md)

A Cordis tool plugin that gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) read-only Gmail access. Agents can verify credentials, list and search messages, inspect message details and bounded attachment content, browse threads, and list labels.

## Install

```sh
npm install @libai168/dsh-tool-gmail
```

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies.

## Configuration

```yaml
- name: 'github:LJH-snow/dsh-tool-gmail'
  config:
    accessToken: 'ya29.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    # or OAuth refresh credentials:
    # clientId: 'xxxxxxxx.apps.googleusercontent.com'
    # clientSecret: 'xxxxxxxxxxxxxxxxxxxx'
    # refreshToken: '1//xxxxxxxxxxxxxxxxxxxxxxxx'
    # tokenUrl: 'https://oauth2.googleapis.com/token'
    # timeoutMs: 15000
```

Recommended read-only Gmail OAuth scope:

- Gmail readonly: `https://www.googleapis.com/auth/gmail.readonly`

## OAuth helper

This package includes a no-dependency helper that prints a Gmail OAuth consent URL, listens on a loopback callback, exchanges the authorization code, and prints a ready-to-copy Cordis config snippet with a refresh token.

1. In Google Cloud Console, create or select an OAuth client. Add this redirect URI when your client type requires an explicit redirect URI:

   ```text
   http://127.0.0.1:53683/oauth2callback
   ```

2. Run the helper from this repository or from an installed package checkout:

   ```sh
   npm run auth:gmail -- --client-id 'xxxxxxxx.apps.googleusercontent.com' --client-secret 'xxxxxxxxxxxxxxxxxxxx'
   ```

   If the browser cannot be opened automatically, use `--no-open` and paste the printed URL manually:

   ```sh
   npm run auth:gmail -- --client-id 'xxxxxxxx.apps.googleusercontent.com' --client-secret 'xxxxxxxxxxxxxxxxxxxx' --no-open
   ```

3. After approval, copy the printed YAML snippet into your `dsh` / Cordis config.

Useful options:

- `--print-url` prints the authorization URL without starting the local callback server or making network calls. The URL never includes the client secret.
- `--redirect-uri` or `--port` changes the callback URL when your OAuth client uses a different loopback URI.
- `--scope` can be repeated, and `--scopes` accepts a space- or comma-separated scope list when you want narrower authorization.
- `--code` exchanges a manually copied authorization code without starting the callback server; pass `--code-verifier` too if the code came from a prior `--print-url` run.

The helper requests offline access with consent prompting so Google can return a refresh token. Keep the client secret and refresh token private; do not commit them to git.

## Tools

| Tool | Description | Write |
|---|---|---|
| `gmail_auth_test` | Verify Gmail credentials and return token metadata | no |
| `gmail_list_messages` | List Gmail messages with label filters and pagination | no |
| `gmail_search_messages` | Search Gmail messages with Gmail query syntax | no |
| `gmail_get_message` | Get one Gmail message with parsed headers and body text | no |
| `gmail_get_attachment` | Get one message attachment as bounded base64url data | no |
| `gmail_list_threads` | List Gmail threads with label filters, optional Gmail query, and pagination | no |
| `gmail_get_thread` | Get one Gmail thread with parsed message details | no |
| `gmail_list_labels` | List Gmail labels | no |

## Search examples

- `from:billing@example.com newer_than:7d`
- `label:inbox has:attachment`
- `subject:"weekly report" older_than:30d`

## Common workflows

```text
# Search inbox messages
gmail_search_messages({ q: 'label:inbox newer_than:7d', maxResults: 10 })

# Inspect a single message
gmail_get_message({ messageId: 'msg_id' })

# Read an attachment referenced by gmail_get_message.attachments
gmail_get_attachment({ messageId: 'msg_id', attachmentId: 'attachment_id', maxBytes: 1048576 })

# Browse a thread
gmail_get_thread({ threadId: 'thread_id' })

# Filter threads
gmail_list_threads({ q: 'subject:report newer_than:7d' })

# List labels
gmail_list_labels({})
```

`gmail_get_attachment` uses Gmail's `users.messages.attachments.get` endpoint and returns the attachment's `dataBase64Url`, byte `size`, and a `truncated` flag. The default output cap is 1 MiB and the tool accepts `maxBytes` up to 5 MiB; oversized data is withheld while metadata remains available. Decode the base64url value only in a trusted downstream step, and treat message and attachment content as untrusted input.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE)
