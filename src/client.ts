/** Gmail API client with injected fetch for testability. */

export interface GmailClientOptions {
  accessToken?: string
  clientId?: string
  clientSecret?: string
  refreshToken?: string
  baseUrl?: string
  tokenUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class GmailError extends Error {
  constructor(
    message: string,
    public readonly code: number,
  ) {
    super(message)
    this.name = 'GmailError'
  }
}

interface TokenCache {
  token: string
  expiresAt: number
}

export interface GmailProfileInfo {
  emailAddress: string
  messagesTotal: number
  threadsTotal: number
  historyId: string
}

export interface GmailMessageHeader {
  name: string
  value: string
}

export interface GmailAttachmentInfo {
  filename: string
  mimeType: string
  attachmentId: string
  size: number
}

export interface GmailMessageSummary {
  id: string
  threadId: string
  snippet: string
  labelIds: string[]
  historyId: string
  internalDate: string
}

export interface GmailMessageDetail extends GmailMessageSummary {
  subject: string
  from: string
  to: string
  cc: string
  bcc: string
  date: string
  messageId: string
  payloadMimeType: string
  bodyText: string
  bodyHtml: string
  headers: GmailMessageHeader[]
  attachments: GmailAttachmentInfo[]
  partCount: number
}

export interface GmailThreadSummary {
  id: string
  snippet: string
  historyId: string
}

export interface GmailThreadDetail extends GmailThreadSummary {
  messageCount: number
  messages: GmailMessageDetail[]
}

export interface GmailLabelInfo {
  id: string
  name: string
  type: string
  messageListVisibility: string
  labelListVisibility: string
  messagesTotal: number
  threadsTotal: number
  unreadCount: number
  color: string
}

export interface GmailListMessagesOptions {
  userId?: string
  q?: string
  labelIds?: string[]
  maxResults?: number
  pageToken?: string
  includeSpamTrash?: boolean
}

export interface GmailListThreadsOptions extends GmailListMessagesOptions {}

export interface GmailGetMessageOptions {
  userId?: string
  format?: 'full' | 'metadata' | 'minimal' | 'raw'
}

export interface GmailGetThreadOptions {
  userId?: string
  format?: 'full' | 'metadata' | 'minimal'
}

export interface GmailGetAttachmentOptions {
  userId?: string
  /** Maximum decoded bytes to expose in the tool result (default 1 MiB). */
  maxBytes?: number
}

export interface GmailAttachmentData {
  userId: string
  messageId: string
  attachmentId: string
  size: number
  dataBase64Url: string
  truncated: boolean
}

export interface GmailListResult<T> {
  userId: string
  q: string
  labelIds: string[]
  maxResults: number
  pageToken: string
  includeSpamTrash: boolean
  nextPageToken: string
  resultSizeEstimate: number
  items: T[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : value != null ? String(value) : ''
}

function asNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' ? value : Number(value ?? 0) || 0
}

function asBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  return typeof value === 'boolean' ? value : false
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map(item => String(item))
}

function clampAttachmentBytes(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1024 * 1024
  return Math.max(1, Math.min(5 * 1024 * 1024, Math.trunc(value as number)))
}

function toJson(value: unknown): string {
  try { return JSON.stringify(value ?? {}) } catch { return '{}' }
}

function decodeBase64Url(value: string): string {
  if (!value) return ''
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function headerValue(headers: GmailMessageHeader[], name: string): string {
  const target = name.toLowerCase()
  const header = headers.find(item => item.name.toLowerCase() === target)
  return header?.value ?? ''
}

function mapHeaders(value: unknown): GmailMessageHeader[] {
  return asArray(value).map(item => {
    const record = asRecord(item)
    return {
      name: asString(record, 'name'),
      value: asString(record, 'value'),
    }
  }).filter(item => item.name)
}

function mapAttachments(part: unknown): GmailAttachmentInfo[] {
  const record = asRecord(part)
  const headers = mapHeaders(record.headers)
  const body = asRecord(record.body)
  const attachmentId = asString(body, 'attachmentId')
  const parts = asArray(record.parts)
  const collected = parts.flatMap(mapAttachments)

  const filename = asString(record, 'filename')
  if (filename && attachmentId) {
    return [{
      filename,
      mimeType: asString(record, 'mimeType'),
      attachmentId,
      size: asNumber(body, 'size'),
    }, ...collected]
  }

  const nested = headers.length > 0 || collected.length > 0 ? collected : []
  return nested
}

function collectMessageText(part: unknown): { text: string; html: string; partCount: number } {
  const record = asRecord(part)
  const mimeType = asString(record, 'mimeType').toLowerCase()
  const body = asRecord(record.body)
  const parts = asArray(record.parts)

  let text = ''
  let html = ''
  let partCount = 1

  const data = asString(body, 'data')
  if (mimeType === 'text/plain' && data) text += `${decodeBase64Url(data)}\n`
  if (mimeType === 'text/html' && data) html += `${decodeBase64Url(data)}\n`

  for (const child of parts) {
    const nested = collectMessageText(child)
    text += nested.text
    html += nested.html
    partCount += nested.partCount
  }

  if (!parts.length && data && mimeType && mimeType.startsWith('text/') && mimeType !== 'text/plain' && mimeType !== 'text/html') {
    text += `${decodeBase64Url(data)}\n`
  }

  return { text, html, partCount }
}

function collectMessagePayload(payload: unknown): { text: string; html: string; partCount: number; attachments: GmailAttachmentInfo[] } {
  const record = asRecord(payload)
  const parts = asArray(record.parts)
  const base = collectMessageText(record)
  const attachments = mapAttachments(record)
  if (!parts.length && !base.text && !base.html) {
    const body = asRecord(record.body)
    const data = asString(body, 'data')
    const mimeType = asString(record, 'mimeType').toLowerCase()
    if (data && mimeType === 'text/plain') base.text = `${decodeBase64Url(data)}\n`
    if (data && mimeType === 'text/html') base.html = `${decodeBase64Url(data)}\n`
  }
  return {
    text: base.text.trim(),
    html: base.html.trim(),
    partCount: base.partCount,
    attachments,
  }
}

function normalizeListItem(data: unknown): GmailMessageSummary {
  const record = asRecord(data)
  return {
    id: asString(record, 'id'),
    threadId: asString(record, 'threadId'),
    snippet: asString(record, 'snippet'),
    labelIds: asStringArray(record.labelIds),
    historyId: asString(record, 'historyId'),
    internalDate: asString(record, 'internalDate'),
  }
}

function normalizeThreadItem(data: unknown): GmailThreadSummary {
  const record = asRecord(data)
  return {
    id: asString(record, 'id'),
    snippet: asString(record, 'snippet'),
    historyId: asString(record, 'historyId'),
  }
}

function normalizeMessageDetail(data: unknown): GmailMessageDetail {
  const record = asRecord(data)
  const payload = asRecord(record.payload)
  const headers = mapHeaders(payload.headers)
  const body = collectMessagePayload(payload)
  return {
    id: asString(record, 'id'),
    threadId: asString(record, 'threadId'),
    snippet: asString(record, 'snippet'),
    labelIds: asStringArray(record.labelIds),
    historyId: asString(record, 'historyId'),
    internalDate: asString(record, 'internalDate'),
    subject: headerValue(headers, 'Subject'),
    from: headerValue(headers, 'From'),
    to: headerValue(headers, 'To'),
    cc: headerValue(headers, 'Cc'),
    bcc: headerValue(headers, 'Bcc'),
    date: headerValue(headers, 'Date'),
    messageId: headerValue(headers, 'Message-ID'),
    payloadMimeType: asString(payload, 'mimeType'),
    bodyText: body.text,
    bodyHtml: body.html,
    headers,
    attachments: body.attachments,
    partCount: body.partCount,
  }
}

function normalizeThreadDetail(data: unknown): GmailThreadDetail {
  const record = asRecord(data)
  const messages = asArray(record.messages).map(normalizeMessageDetail)
  return {
    id: asString(record, 'id'),
    snippet: asString(record, 'snippet'),
    historyId: asString(record, 'historyId'),
    messageCount: messages.length,
    messages,
  }
}

function normalizeLabel(data: unknown): GmailLabelInfo {
  const record = asRecord(data)
  const messageListVisibility = asString(record, 'messageListVisibility') || asString(record, 'message_list_visibility')
  const labelListVisibility = asString(record, 'labelListVisibility') || asString(record, 'label_list_visibility')
  const color = toJson(record.color)
  return {
    id: asString(record, 'id'),
    name: asString(record, 'name'),
    type: asString(record, 'type'),
    messageListVisibility,
    labelListVisibility,
    messagesTotal: asNumber(record, 'messagesTotal'),
    threadsTotal: asNumber(record, 'threadsTotal'),
    unreadCount: asNumber(record, 'unreadCount'),
    color,
  }
}

export class GmailClient {
  private readonly accessToken: string
  private readonly clientId: string
  private readonly clientSecret: string
  private readonly refreshToken: string
  private readonly baseUrl: string
  private readonly tokenUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private tokenCache: TokenCache | null = null

  constructor(options: GmailClientOptions = {}) {
    this.accessToken = options.accessToken ?? ''
    this.clientId = options.clientId ?? ''
    this.clientSecret = options.clientSecret ?? ''
    this.refreshToken = options.refreshToken ?? ''
    this.baseUrl = options.baseUrl ?? 'https://gmail.googleapis.com/gmail/v1'
    this.tokenUrl = options.tokenUrl ?? 'https://oauth2.googleapis.com/token'
    this.timeoutMs = options.timeoutMs ?? 15000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  hasCredentials() {
    return Boolean(this.accessToken || (this.clientId && this.clientSecret && this.refreshToken))
  }

  async authTest(signal?: AbortSignal): Promise<GmailProfileInfo & { ok: true; authMethod: string; tokenPreview: string }> {
    const profile = await this.requestJson('users/me/profile', { signal })
    const token = this.accessToken || await this.getAccessToken(signal)
    const record = asRecord(profile)
    return {
      ok: true,
      authMethod: this.accessToken ? 'access_token' : 'refresh_token',
      tokenPreview: `${token.slice(0, 8)}...`,
      emailAddress: asString(record, 'emailAddress'),
      messagesTotal: asNumber(record, 'messagesTotal'),
      threadsTotal: asNumber(record, 'threadsTotal'),
      historyId: asString(record, 'historyId'),
    }
  }

  async listMessages(options: GmailListMessagesOptions = {}, signal?: AbortSignal): Promise<GmailListResult<GmailMessageSummary>> {
    const userId = options.userId || 'me'
    const data = await this.requestJson(`users/${encodeURIComponent(userId)}/messages`, {
      params: {
        q: options.q,
        labelIds: options.labelIds,
        maxResults: options.maxResults ?? 20,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash,
      },
      signal,
    })
    const record = asRecord(data)
    return {
      userId,
      q: options.q ?? '',
      labelIds: options.labelIds ?? [],
      maxResults: options.maxResults ?? 20,
      pageToken: options.pageToken ?? '',
      includeSpamTrash: Boolean(options.includeSpamTrash),
      nextPageToken: asString(record, 'nextPageToken'),
      resultSizeEstimate: asNumber(record, 'resultSizeEstimate'),
      items: asArray(record.messages).map(normalizeListItem),
    }
  }

  async searchMessages(options: GmailListMessagesOptions = {}, signal?: AbortSignal) {
    return this.listMessages(options, signal)
  }

  async getMessage(messageId: string, options: GmailGetMessageOptions = {}, signal?: AbortSignal): Promise<GmailMessageDetail> {
    const userId = options.userId || 'me'
    const data = await this.requestJson(`users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}`, {
      params: { format: options.format ?? 'full' },
      signal,
    })
    return normalizeMessageDetail(data)
  }

  async listThreads(options: GmailListThreadsOptions = {}, signal?: AbortSignal): Promise<GmailListResult<GmailThreadSummary>> {
    const userId = options.userId || 'me'
    const data = await this.requestJson(`users/${encodeURIComponent(userId)}/threads`, {
      params: {
        q: options.q,
        labelIds: options.labelIds,
        maxResults: options.maxResults ?? 20,
        pageToken: options.pageToken,
        includeSpamTrash: options.includeSpamTrash,
      },
      signal,
    })
    const record = asRecord(data)
    return {
      userId,
      q: options.q ?? '',
      labelIds: options.labelIds ?? [],
      maxResults: options.maxResults ?? 20,
      pageToken: options.pageToken ?? '',
      includeSpamTrash: Boolean(options.includeSpamTrash),
      nextPageToken: asString(record, 'nextPageToken'),
      resultSizeEstimate: asNumber(record, 'resultSizeEstimate'),
      items: asArray(record.threads).map(normalizeThreadItem),
    }
  }

  async getThread(threadId: string, options: GmailGetThreadOptions = {}, signal?: AbortSignal): Promise<GmailThreadDetail> {
    const userId = options.userId || 'me'
    const data = await this.requestJson(`users/${encodeURIComponent(userId)}/threads/${encodeURIComponent(threadId)}`, {
      params: { format: options.format ?? 'full' },
      signal,
    })
    return normalizeThreadDetail(data)
  }

  async getAttachment(messageId: string, attachmentId: string, options: GmailGetAttachmentOptions = {}, signal?: AbortSignal): Promise<GmailAttachmentData> {
    const userId = options.userId || 'me'
    const raw = asRecord(await this.requestJson(
      `users/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { signal },
    ))
    const dataBase64Url = asString(raw, 'data')
    const size = asNumber(raw, 'size')
    const maxBytes = clampAttachmentBytes(options.maxBytes)
    const decodedBytes = dataBase64Url ? Buffer.from(dataBase64Url, 'base64url').byteLength : 0
    const actualBytes = Math.max(size, decodedBytes)
    const truncated = actualBytes > maxBytes
    return {
      userId,
      messageId,
      attachmentId,
      size: actualBytes,
      dataBase64Url: truncated ? '' : dataBase64Url,
      truncated,
    }
  }

  async listLabels(userIdOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<{ userId: string; items: GmailLabelInfo[] }> {
    let userId = 'me'
    let effectiveSignal = signal
    if (typeof userIdOrSignal === 'string') userId = userIdOrSignal
    else if (userIdOrSignal) effectiveSignal = userIdOrSignal
    const data = await this.requestJson(`users/${encodeURIComponent(userId)}/labels`, { signal: effectiveSignal })
    const record = asRecord(data)
    return { userId, items: asArray(record.labels).map(normalizeLabel) }
  }

  private async getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.accessToken) return this.accessToken
    const now = Date.now()
    if (this.tokenCache && this.tokenCache.expiresAt > now) return this.tokenCache.token
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      throw new GmailError('Gmail accessToken or refresh token credentials are not configured.', 401)
    }

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.refreshToken,
      grant_type: 'refresh_token',
    })
    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: this.withTimeout(signal),
    })
    const raw = await response.text()
    let payload: Record<string, unknown>
    try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { raw } }

    if (!response.ok) {
      const detail = typeof payload.error_description === 'string' ? payload.error_description : typeof payload.error === 'string' ? payload.error : raw || `${response.status} ${response.statusText}`
      throw new GmailError(`OAuth token refresh failed: ${detail}`, response.status)
    }

    const token = typeof payload.access_token === 'string' ? payload.access_token : ''
    if (!token) throw new GmailError('OAuth token refresh response did not include an access token.', response.status)
    const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in ?? 3600) || 3600
    this.tokenCache = { token, expiresAt: now + Math.max(60, expiresIn - 30) * 1000 }
    return token
  }

  private withTimeout(signal?: AbortSignal) {
    if (!this.timeoutMs) return signal
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs)
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  }

  private async requestJson(path: string, options: { params?: Record<string, unknown>; signal?: AbortSignal } = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`)
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value == null || value === '') continue
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item))
      } else {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = { accept: 'application/json' }
    if (path !== 'users/me/profile' && path !== 'users/me/labels' && !path.endsWith('/profile') && !path.endsWith('/labels')) {
      headers.authorization = `Bearer ${await this.getAccessToken(options.signal)}`
    } else {
      headers.authorization = `Bearer ${await this.getAccessToken(options.signal)}`
    }

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers,
      signal: this.withTimeout(options.signal),
    })
    const raw = await response.text()
    let payload: unknown
    try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { raw } }

    if (!response.ok) {
      const record = asRecord(payload)
      const detail = typeof record.error === 'string'
        ? record.error
        : typeof record.message === 'string'
          ? record.message
          : raw || `${response.status} ${response.statusText}`
      throw new GmailError(detail, response.status)
    }
    return payload
  }
}
