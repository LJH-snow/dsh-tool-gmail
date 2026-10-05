import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { GmailClient, GmailError } from './client.js'

export const name = 'dsh-tool-gmail'
export const inject = ['tools']

export interface GmailPluginConfig {
  accessToken?: string
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  baseUrl?: string
  tokenUrl?: string
  timeoutMs?: number
}

export function apply(ctx: Context, config: GmailPluginConfig = {}) {
  const client = new GmailClient(config)
  for (const tool of createTools(client)) ctx.tools.register(tool)
}

function unavailable(reason: string) {
  return { found: false, reason }
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }]
}

function listParams() {
  return {
    userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
    labelIds: { type: 'array', items: { type: 'string' }, description: 'Optional label IDs to filter by' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    pageToken: { type: 'string', description: 'Opaque cursor from a previous response' },
    includeSpamTrash: { type: 'boolean', description: 'Include spam and trash folders' },
  } as const
}

function threadListParams() {
  return {
    q: { type: 'string', description: 'Optional Gmail search query, e.g. from:alice subject:report newer_than:7d' },
    userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
    labelIds: { type: 'array', items: { type: 'string' }, description: 'Optional label IDs to filter by' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    pageToken: { type: 'string', description: 'Opaque cursor from a previous response' },
    includeSpamTrash: { type: 'boolean', description: 'Include spam and trash folders' },
  } as const
}

function searchParams() {
  return {
    q: { type: 'string', required: true, description: 'Gmail search query, e.g. from:alice subject:report newer_than:7d' },
    userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
    labelIds: { type: 'array', items: { type: 'string' }, description: 'Optional label IDs to filter by' },
    maxResults: { type: 'number', description: 'Maximum results per page' },
    pageToken: { type: 'string', description: 'Opaque cursor from a previous response' },
    includeSpamTrash: { type: 'boolean', description: 'Include spam and trash folders' },
  } as const
}

function messageParams() {
  return {
    messageId: { type: 'string', required: true, description: 'Gmail message ID' },
    userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
    format: { type: 'string', description: 'Message format: full, metadata, minimal, or raw' },
  } as const
}

function threadParams() {
  return {
    threadId: { type: 'string', required: true, description: 'Gmail thread ID' },
    userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
    format: { type: 'string', description: 'Thread format: full, metadata, or minimal' },
  } as const
}

function labelParams() {
  return {
    userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
  } as const
}

function renderMessages(items: Array<{ id?: string; threadId?: string; snippet?: string; labelIds?: string[]; internalDate?: string }>, empty = 'No Gmail messages found.') {
  if (!items.length) return text(empty)
  return text(items.map(item => [
    `${item.id ?? ''} thread=${item.threadId ?? ''}`,
    item.labelIds?.length ? `labels=${item.labelIds.join(',')}` : '',
    item.internalDate ? `date=${item.internalDate}` : '',
    item.snippet ?? '',
  ].filter(Boolean).join('\n')).join('\n\n'))
}

function renderMessage(message: { id?: string; threadId?: string; subject?: string; from?: string; to?: string; date?: string; snippet?: string; bodyText?: string; attachments?: Array<{ filename?: string; mimeType?: string }> }) {
  return text([
    `${message.subject ?? ''} (${message.id ?? ''})`,
    `thread=${message.threadId ?? ''}`,
    message.from ? `from=${message.from}` : '',
    message.to ? `to=${message.to}` : '',
    message.date ? `date=${message.date}` : '',
    message.attachments?.length ? `attachments=${message.attachments.map(att => `${att.filename ?? ''}:${att.mimeType ?? ''}`).join(', ')}` : '',
    message.snippet ? `snippet=${message.snippet}` : '',
    (message.bodyText ?? '').slice(0, 4000),
  ].filter(Boolean).join('\n'))
}

function renderAttachment(value: { found?: boolean; userId?: string; messageId?: string; attachmentId?: string; size?: number; dataBase64Url?: string; truncated?: boolean; reason?: string }) {
  if (!value.found) return text(value.reason ?? 'Gmail attachment not found.')
  const data = value.dataBase64Url ?? ''
  return text([
    `message=${value.messageId ?? ''} attachment=${value.attachmentId ?? ''}`,
    `size=${value.size ?? 0} bytes`,
    value.truncated ? 'data omitted: attachment exceeds maxBytes' : `dataBase64Url=${data.slice(0, 12000)}${data.length > 12000 ? '…' : ''}`,
  ].join('\n'))
}

function renderThreads(items: Array<{ id?: string; snippet?: string; historyId?: string }>, empty = 'No Gmail threads found.') {
  if (!items.length) return text(empty)
  return text(items.map(item => `${item.id ?? ''}${item.historyId ? ` history=${item.historyId}` : ''}\n${item.snippet ?? ''}`.trim()).join('\n\n'))
}

function renderThread(thread: { id?: string; messageCount?: number; snippet?: string; messages?: Array<{ id?: string; subject?: string; from?: string; bodyText?: string }> }) {
  return text([
    `${thread.id ?? ''} messages=${thread.messageCount ?? 0}`,
    thread.snippet ? `snippet=${thread.snippet}` : '',
    ...(thread.messages ?? []).map((message, index) => [
      `#${index + 1} ${message.subject ?? message.id ?? ''}`,
      message.from ? `from=${message.from}` : '',
      (message.bodyText ?? '').slice(0, 1000),
    ].filter(Boolean).join('\n')),
  ].filter(Boolean).join('\n\n'))
}

function renderLabels(items: Array<{ name?: string; id?: string; type?: string; messagesTotal?: number; threadsTotal?: number; unreadCount?: number }>) {
  if (!items.length) return text('No Gmail labels found.')
  return text(items.map(label => [
    `${label.name ?? ''} (${label.id ?? ''})`,
    label.type ? `type=${label.type}` : '',
    `messages=${label.messagesTotal ?? 0} threads=${label.threadsTotal ?? 0} unread=${label.unreadCount ?? 0}`,
  ].filter(Boolean).join('\n')).join('\n\n'))
}

export function createTools(client: GmailClient) {
  return [
    defineTool({
      name: 'gmail_auth_test',
      description: 'Verify Gmail credentials and return token metadata.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
            authMethod: { type: 'string' },
            tokenPreview: { type: 'string' },
            emailAddress: { type: 'string' },
            messagesTotal: { type: 'number' },
            threadsTotal: { type: 'number' },
            historyId: { type: 'string' },
          },
        },
        render: (_args, value) => value.ok ? text(`authMethod: ${value.authMethod}\nemail: ${value.emailAddress}\ntoken: ${value.tokenPreview}`) : text(`Gmail auth failed: ${value.reason}`),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'Verify Gmail credentials', kind: 'read' } },
      async execute(_args, exec: any): Promise<any> {
        if (!client.hasCredentials()) return { ok: false, reason: 'Gmail accessToken or refresh token credentials are not configured.' }
        try { return await client.authTest(exec.signal) as any } catch (error) {
          if (error instanceof GmailError) return { ok: false, reason: error.message }
          throw error
        }
      },
    }),
    defineTool({
      name: 'gmail_list_messages',
      description: 'List Gmail messages with label filters and pagination.',
      parameters: listParams(),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string' },
            q: { type: 'string' },
            labelIds: { type: 'array', items: { type: 'string' } },
            maxResults: { type: 'number' },
            pageToken: { type: 'string' },
            includeSpamTrash: { type: 'boolean' },
            nextPageToken: { type: 'string' },
            resultSizeEstimate: { type: 'number' },
            items: { type: 'array' },
          },
        },
        render: (_args, value: any) => renderMessages(value.items ?? []),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'List Gmail messages', kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        return client.listMessages({ userId: args.userId as string, labelIds: args.labelIds as string[], maxResults: args.maxResults as number, pageToken: args.pageToken as string, includeSpamTrash: args.includeSpamTrash as boolean }, exec.signal) as any
      },
    }),
    defineTool({
      name: 'gmail_search_messages',
      description: 'Search Gmail messages with Gmail query syntax.',
      parameters: searchParams(),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string' },
            q: { type: 'string' },
            labelIds: { type: 'array', items: { type: 'string' } },
            maxResults: { type: 'number' },
            pageToken: { type: 'string' },
            includeSpamTrash: { type: 'boolean' },
            nextPageToken: { type: 'string' },
            resultSizeEstimate: { type: 'number' },
            items: { type: 'array' },
          },
        },
        render: (_args, value: any) => renderMessages(value.items ?? []),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'Search Gmail messages', kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        return client.searchMessages({ q: args.q as string, userId: args.userId as string, labelIds: args.labelIds as string[], maxResults: args.maxResults as number, pageToken: args.pageToken as string, includeSpamTrash: args.includeSpamTrash as boolean }, exec.signal) as any
      },
    }),
    defineTool({
      name: 'gmail_get_message',
      description: 'Get one Gmail message with parsed headers and body text.',
      parameters: messageParams(),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean' },
            reason: { type: 'string' },
            id: { type: 'string' },
            threadId: { type: 'string' },
            snippet: { type: 'string' },
            labelIds: { type: 'array', items: { type: 'string' } },
            historyId: { type: 'string' },
            internalDate: { type: 'string' },
            subject: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            cc: { type: 'string' },
            bcc: { type: 'string' },
            date: { type: 'string' },
            messageId: { type: 'string' },
            payloadMimeType: { type: 'string' },
            bodyText: { type: 'string' },
            bodyHtml: { type: 'string' },
            headers: { type: 'array' },
            attachments: { type: 'array' },
            partCount: { type: 'number' },
          },
        },
        render: (_args, value: any) => value.found ? renderMessage(value) : text(value.reason ?? 'Gmail message not found.')
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Get Gmail message ${args.messageId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        try { return { found: true, ...await client.getMessage(args.messageId as string, { userId: args.userId as string, format: args.format as 'full' | 'metadata' | 'minimal' | 'raw' }, exec.signal) } as any } catch (error) {
          if (error instanceof GmailError) return unavailable(error.message)
          throw error
        }
      },
    }),
    defineTool({
      name: 'gmail_get_attachment',
      description: 'Get one Gmail message attachment as bounded base64url data.',
      parameters: {
        messageId: { type: 'string', required: true, description: 'Gmail message ID containing the attachment' },
        attachmentId: { type: 'string', required: true, description: 'Attachment ID from gmail_get_message' },
        userId: { type: 'string', description: 'Optional Gmail user ID, usually me' },
        maxBytes: { type: 'number', description: 'Maximum decoded bytes to return (default 1048576, capped at 5242880)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean' },
            reason: { type: 'string' },
            userId: { type: 'string' },
            messageId: { type: 'string' },
            attachmentId: { type: 'string' },
            size: { type: 'number' },
            dataBase64Url: { type: 'string' },
            truncated: { type: 'boolean' },
          },
        },
        render: (_args, value: any) => renderAttachment(value),
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Get Gmail attachment ${args.attachmentId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        try {
          return { found: true, ...await client.getAttachment(args.messageId as string, args.attachmentId as string, { userId: args.userId as string, maxBytes: args.maxBytes as number }, exec.signal) } as any
        } catch (error) {
          if (error instanceof GmailError) return unavailable(error.message)
          throw error
        }
      },
    }),
    defineTool({
      name: 'gmail_list_threads',
      description: 'List Gmail threads with label filters, optional search query, and pagination.',
      parameters: threadListParams(),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string' },
            q: { type: 'string' },
            labelIds: { type: 'array', items: { type: 'string' } },
            maxResults: { type: 'number' },
            pageToken: { type: 'string' },
            includeSpamTrash: { type: 'boolean' },
            nextPageToken: { type: 'string' },
            resultSizeEstimate: { type: 'number' },
            items: { type: 'array' },
          },
        },
        render: (_args, value: any) => renderThreads(value.items ?? []),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'List Gmail threads', kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        return client.listThreads({ q: args.q as string, userId: args.userId as string, labelIds: args.labelIds as string[], maxResults: args.maxResults as number, pageToken: args.pageToken as string, includeSpamTrash: args.includeSpamTrash as boolean }, exec.signal) as any
      },
    }),
    defineTool({
      name: 'gmail_get_thread',
      description: 'Get one Gmail thread with parsed message details.',
      parameters: threadParams(),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            found: { type: 'boolean' },
            reason: { type: 'string' },
            id: { type: 'string' },
            snippet: { type: 'string' },
            historyId: { type: 'string' },
            messageCount: { type: 'number' },
            messages: { type: 'array' },
          },
        },
        render: (_args, value: any) => value.found ? renderThread(value) : text(value.reason ?? 'Gmail thread not found.')
      },
      presentCall(args): ToolCallView { return { card: 'generic', title: `Get Gmail thread ${args.threadId ?? ''}`, kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        try { return { found: true, ...await client.getThread(args.threadId as string, { userId: args.userId as string, format: args.format as 'full' | 'metadata' | 'minimal' }, exec.signal) } as any } catch (error) {
          if (error instanceof GmailError) return unavailable(error.message)
          throw error
        }
      },
    }),
    defineTool({
      name: 'gmail_list_labels',
      description: 'List Gmail labels.',
      parameters: labelParams(),
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            userId: { type: 'string' },
            items: { type: 'array' },
          },
        },
        render: (_args, value: any) => renderLabels(value.items ?? []),
      },
      presentCall(): ToolCallView { return { card: 'generic', title: 'List Gmail labels', kind: 'read' } },
      async execute(args, exec) {
        if (!client.hasCredentials()) return unavailable('Gmail accessToken or refresh token credentials are not configured.')
        return client.listLabels(args.userId as string, exec.signal) as any
      },
    }),
  ]
}
