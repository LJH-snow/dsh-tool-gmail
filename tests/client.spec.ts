import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GmailClient, GmailError } from '../src/client.js'

/** Deterministic DNS so tests never depend on real resolution. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }]


function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
}

function base64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('GmailClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('authenticates with a static access token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ emailAddress: 'user@example.com', messagesTotal: 10, threadsTotal: 3, historyId: '42' }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    const auth = await client.authTest()

    expect(auth).toMatchObject({ ok: true, authMethod: 'access_token', emailAddress: 'user@example.com', messagesTotal: 10, threadsTotal: 3, historyId: '42' })
    expect(auth.tokenPreview).toBe('ya29.sta...')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toContain('https://gmail.googleapis.com/gmail/v1/users/me/profile')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ya29.static')
  })

  it('refreshes access token and caches it', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'ya29.refresh', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ emailAddress: 'user@example.com', messagesTotal: 10, threadsTotal: 3, historyId: '42' }))
    const client = new GmailClient({ lookupImpl: publicLookup, clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtok', fetchImpl })

    const auth = await client.authTest()
    expect(auth).toMatchObject({ ok: true, authMethod: 'refresh_token', emailAddress: 'user@example.com' })

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(String(tokenInit.body)).toContain('grant_type=refresh_token')
    expect(String(tokenInit.body)).toContain('refresh_token=rtok')
    const [gmailUrl, gmailInit] = fetchImpl.mock.calls[1] as unknown as [URL, RequestInit]
    expect(String(gmailUrl)).toContain('/users/me/profile')
    expect((gmailInit.headers as Record<string, string>).authorization).toBe('Bearer ya29.refresh')
  })

  it('lists messages and threads with Gmail search parameters', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'msg_1', threadId: 'thr_1', snippet: 'hello', labelIds: ['INBOX'], historyId: '100', internalDate: '123' }], nextPageToken: 'next', resultSizeEstimate: 1 }))
      .mockResolvedValueOnce(jsonResponse({ threads: [{ id: 'thr_1', snippet: 'thread snippet', historyId: '200' }], nextPageToken: 'next-thread', resultSizeEstimate: 1 }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    const messages = await client.listMessages({ q: 'from:alice', labelIds: ['INBOX'], maxResults: 5, includeSpamTrash: true })
    const threads = await client.listThreads({ q: 'subject:report', maxResults: 10 })

    expect(messages).toMatchObject({ nextPageToken: 'next', resultSizeEstimate: 1, items: [{ id: 'msg_1', threadId: 'thr_1', snippet: 'hello' }] })
    expect(threads).toMatchObject({ nextPageToken: 'next-thread', resultSizeEstimate: 1, items: [{ id: 'thr_1', snippet: 'thread snippet' }] })
    const [messagesUrl] = fetchImpl.mock.calls[0] as unknown as [URL]
    const [threadsUrl] = fetchImpl.mock.calls[1] as unknown as [URL]
    expect(String(messagesUrl)).toContain('/users/me/messages')
    expect(String(messagesUrl)).toContain('q=from%3Aalice')
    expect(String(messagesUrl)).toContain('labelIds=INBOX')
    expect(String(messagesUrl)).toContain('includeSpamTrash=true')
    expect(String(messagesUrl)).toContain('maxResults=5')
    expect(String(threadsUrl)).toContain('/users/me/threads')
    expect(String(threadsUrl)).toContain('q=subject%3Areport')
  })

  it('parses message bodies, headers, and attachments', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'msg_1', threadId: 'thr_1', snippet: 'hello snippet', labelIds: ['INBOX'], historyId: '100', internalDate: '123',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject', value: 'Weekly report' },
          { name: 'From', value: 'alice@example.com' },
          { name: 'To', value: 'bob@example.com' },
          { name: 'Date', value: 'Mon, 1 Sep 2026 10:00:00 +0800' },
          { name: 'Message-ID', value: '<msg-1@example.com>' },
        ],
        parts: [
          { mimeType: 'text/plain', body: { data: base64Url('Hello team\n') } },
          { filename: 'report.pdf', mimeType: 'application/pdf', body: { attachmentId: 'att_1', size: 1234 } },
        ],
      },
    }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    const message = await client.getMessage('msg_1')

    expect(message).toMatchObject({
      id: 'msg_1',
      threadId: 'thr_1',
      subject: 'Weekly report',
      from: 'alice@example.com',
      to: 'bob@example.com',
      messageId: '<msg-1@example.com>',
      bodyText: 'Hello team',
      partCount: 3,
    })
    expect(message.attachments[0]).toMatchObject({ filename: 'report.pdf', mimeType: 'application/pdf', attachmentId: 'att_1', size: 1234 })
  })

  it('parses threads with embedded message details', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      id: 'thr_1', snippet: 'thread snippet', historyId: '200', messages: [{
        id: 'msg_1', threadId: 'thr_1', snippet: 'hello', labelIds: ['INBOX'], historyId: '100', internalDate: '123',
        payload: {
          headers: [{ name: 'Subject', value: 'Thread subject' }, { name: 'From', value: 'alice@example.com' }],
          parts: [{ mimeType: 'text/plain', body: { data: base64Url('Thread body') } }],
        },
      }],
    }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    const thread = await client.getThread('thr_1')

    expect(thread).toMatchObject({ id: 'thr_1', messageCount: 1, messages: [{ id: 'msg_1', subject: 'Thread subject', from: 'alice@example.com', bodyText: 'Thread body' }] })
  })

  it('gets an attachment as bounded base64url data', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: base64Url('hello attachment'), size: 16 }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    const attachment = await client.getAttachment('msg_1', 'att_1', { userId: 'me', maxBytes: 100 })

    expect(attachment).toEqual({
      userId: 'me',
      messageId: 'msg_1',
      attachmentId: 'att_1',
      size: 16,
      dataBase64Url: base64Url('hello attachment'),
      truncated: false,
    })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toContain('/users/me/messages/msg_1/attachments/att_1')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ya29.static')
  })

  it('omits attachment data when it exceeds the requested byte cap', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: base64Url('0123456789'), size: 10 }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    await expect(client.getAttachment('msg_1', 'att_1', { maxBytes: 5 })).resolves.toMatchObject({
      messageId: 'msg_1',
      attachmentId: 'att_1',
      size: 10,
      dataBase64Url: '',
      truncated: true,
    })
  })

  it('lists Gmail labels', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ labels: [{ id: 'INBOX', name: 'Inbox', type: 'system', messagesTotal: 3, threadsTotal: 2, unreadCount: 1, color: { textColor: '#000', backgroundColor: '#fff' } }] }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })

    const labels = await client.listLabels()

    expect(labels.items[0]).toMatchObject({ id: 'INBOX', name: 'Inbox', type: 'system', messagesTotal: 3, threadsTotal: 2, unreadCount: 1 })
    expect(labels.items[0].color).toContain('backgroundColor')
  })
})

describe('Gmail endpoint security', () => {
  const valid = { accessToken: 'ya29.test' }

  it('rejects invalid base URLs without exposing their contents', () => {
    for (const baseUrl of [
      'gmail.googleapis.com/gmail/v1',
      'ftp://gmail.googleapis.com/gmail/v1',
      'https://user:secretgmail.googleapis.com/gmail/v1',
      'https://gmail.googleapis.com/gmail/v1?token=secret',
      'https://gmail.googleapis.com/gmail/v1#fragment',
    ]) {
      let error: unknown
      try { new GmailClient({ ...valid, baseUrl }) } catch (thrown) { error = thrown }
      expect(error).toBeInstanceOf(GmailError)
      expect(String(error)).not.toContain('secret')
    }
  })

  it('rejects literal local, private, and reserved addresses before fetch', async () => {
    for (const baseUrl of [
      'http://localhost',
      'http://service.localhost',
      'http://service.local',
      'http://127.0.0.1',
      'http://169.254.169.254',
      'http://10.0.0.1',
      'http://192.168.1.1',
      'http://192.0.2.1',
      'http://198.18.0.1',
      'http://224.0.0.1',
      'http://192.175.48.1',
      'http://[::1]',
      'http://[fc00::1]',
      'http://[fe80::1]',
      'http://[fec0::1]',
      'http://[2001:db8::1]',
      'http://[2001:3::1]',
      'http://[2001:4:112::1]',
      'http://[2001:30::1]',
      'http://[5f00::1]',
      'http://[100:0:0:1::1]',
      'http://[2620:4f:8000::1]',
      'http://[64:ff9b::7f00:1]',
      'http://[ff02::1]',
    ]) {
      const fetchImpl = vi.fn()
      await expect(new GmailClient({ ...valid, baseUrl, fetchImpl }).listLabels()).rejects.toMatchObject({ name: 'GmailError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('fails closed on blocked, failed, empty, or inconsistent DNS results', async () => {
    for (const lookupImpl of [
      async () => [{ address: '192.168.1.10', family: 4 as const }],
      async () => [{ address: '93.184.216.34', family: 4 as const }, { address: '169.254.169.254', family: 4 as const }],
      async () => { throw new Error('dns failure') },
      async () => [],
      async () => [{ address: '2001:db8::1', family: 4 as const }],
    ]) {
      const fetchImpl = vi.fn()
      await expect(new GmailClient({ ...valid, baseUrl: 'https://gmail.example.test', fetchImpl, lookupImpl }).listLabels()).rejects.toMatchObject({ name: 'GmailError' })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })

  it('allows a public endpoint that resolves to a public address', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    await new GmailClient({ ...valid, baseUrl: 'https://gmail.example.test', fetchImpl, lookupImpl: publicLookup }).listLabels().catch(() => undefined)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
