import { describe, expect, it, vi } from 'vitest'
import { GmailClient } from '../src/client.js'
import { createTools } from '../src/index.js'

/** Deterministic DNS so tests never depend on real resolution. */
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 as const }]


function exec(signal = new AbortController().signal) {
  return { signal } as any
}

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
}

describe('Gmail tools', () => {
  it('registers the Gmail tool set', () => {
    expect(createTools(new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static' })).map(tool => tool.name)).toEqual([
      'gmail_auth_test',
      'gmail_list_messages',
      'gmail_search_messages',
      'gmail_get_message',
      'gmail_get_attachment',
      'gmail_list_threads',
      'gmail_get_thread',
      'gmail_list_labels',
    ])
  })

  it('allows thread listings to accept a Gmail query', () => {
    const tools = createTools(new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static' }))
    expect((tools[5].parameters as any).properties.q).toMatchObject({ type: 'string' })
  })

  it('keeps auth test parameter-free', () => {
    expect(createTools(new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static' }))[0].parameters).toEqual({ type: 'object', properties: {} })
  })

  it('reports missing credentials cleanly', async () => {
    const map = createTools(new GmailClient())
    expect(await map[0].execute({}, exec())).toMatchObject({ ok: false })
    expect(await map[1].execute({}, exec())).toMatchObject({ found: false })
  })

  it('renders messages and labels', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'msg_1', threadId: 'thr_1', snippet: 'hello', labelIds: ['INBOX'] }], resultSizeEstimate: 1 }))
      .mockResolvedValueOnce(jsonResponse({ messages: [{ id: 'msg_1', threadId: 'thr_1', snippet: 'hello', labelIds: ['INBOX'] }], resultSizeEstimate: 1 }))
      .mockResolvedValueOnce(jsonResponse({ labels: [{ id: 'INBOX', name: 'Inbox', type: 'system', messagesTotal: 1, threadsTotal: 1, unreadCount: 0 }] }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })
    const tools = createTools(client)
    const list = await tools[1].execute({ labelIds: ['INBOX'] }, exec())
    const renderedList = tools[1].output.render?.({}, list as any)
    const search = await tools[2].execute({ q: 'in:inbox' }, exec())
    const renderedSearch = tools[2].output.render?.({}, search as any)
    const labels = await tools[7].execute({}, exec())
    const renderedLabels = tools[7].output.render?.({}, labels as any)

    expect(renderedList).toEqual([{ type: 'text', text: expect.stringContaining('msg_1') }])
    expect(renderedSearch).toEqual([{ type: 'text', text: expect.stringContaining('msg_1') }])
    expect(renderedLabels).toEqual([{ type: 'text', text: expect.stringContaining('Inbox') }])
  })

  it('executes auth, message, thread, and label tools', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ emailAddress: 'user@example.com', messagesTotal: 10, threadsTotal: 3, historyId: '42' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'msg_1', threadId: 'thr_1', snippet: 'hello', labelIds: ['INBOX'], historyId: '100', internalDate: '123', payload: { headers: [{ name: 'Subject', value: 'Subject' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Body', 'utf8').toString('base64url') } }] } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'thr_1', snippet: 'thread', historyId: '200', messages: [{ id: 'msg_1', threadId: 'thr_1', snippet: 'hello', labelIds: ['INBOX'], historyId: '100', internalDate: '123', payload: { headers: [{ name: 'Subject', value: 'Subject' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Body', 'utf8').toString('base64url') } }] } }] }))
      .mockResolvedValueOnce(jsonResponse({ labels: [{ id: 'INBOX', name: 'Inbox', type: 'system', messagesTotal: 1, threadsTotal: 1, unreadCount: 0 }] }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })
    const tools = createTools(client)

    const auth = await tools[0].execute({}, exec())
    const message = await tools[3].execute({ messageId: 'msg_1' }, exec())
    const thread = await tools[6].execute({ threadId: 'thr_1' }, exec())
    const labels = await tools[7].execute({}, exec())

    expect(auth).toMatchObject({ ok: true, emailAddress: 'user@example.com' })
    expect(message).toMatchObject({ subject: 'Subject', bodyText: 'Body' })
    expect(thread).toMatchObject({ messageCount: 1, messages: [{ subject: 'Subject', bodyText: 'Body' }] })
    expect(labels).toMatchObject({ items: [{ name: 'Inbox' }] })
  })

  it('passes thread search queries through to the client', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ threads: [{ id: 'thr_1', snippet: 'thread snippet', historyId: '200' }], resultSizeEstimate: 1 }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })
    const tools = createTools(client)

    await tools[5].execute({ q: 'subject:report', labelIds: ['INBOX'] }, exec())

    const [url] = fetchImpl.mock.calls[0] as unknown as [URL]
    expect(String(url)).toContain('/users/me/threads')
    expect(String(url)).toContain('q=subject%3Areport')
    expect(String(url)).toContain('labelIds=INBOX')
  })

  it('gets an attachment and renders bounded data metadata', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: Buffer.from('hello', 'utf8').toString('base64url'), size: 5 }))
    const client = new GmailClient({ lookupImpl: publicLookup, accessToken: 'ya29.static', fetchImpl })
    const tools = createTools(client)
    const attachmentTool = tools.find(tool => tool.name === 'gmail_get_attachment')!

    const result = await attachmentTool.execute({ messageId: 'msg_1', attachmentId: 'att_1', maxBytes: 100 }, exec()) as any
    expect(result).toMatchObject({ found: true, messageId: 'msg_1', attachmentId: 'att_1', size: 5, dataBase64Url: 'aGVsbG8', truncated: false })
    const rendered = (await attachmentTool.output.render({}, result))[0] as { text?: string }
    expect(String(rendered.text)).toContain('dataBase64Url=aGVsbG8')
    expect(attachmentTool.presentCall!({ messageId: 'msg_1', attachmentId: 'att_1' })).toMatchObject({ card: 'generic', kind: 'read' })
  })

  it('reports missing Gmail credentials for attachment reads', async () => {
    const attachmentTool = createTools(new GmailClient()).find(tool => tool.name === 'gmail_get_attachment')!
    expect(await attachmentTool.execute({ messageId: 'msg_1', attachmentId: 'att_1' }, exec())).toMatchObject({ found: false, reason: expect.stringContaining('credentials') })
  })
})
