import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const node = process.execPath
const script = 'scripts/auth-gmail.mjs'

async function runAuthScript(args: string[]) {
  return execFileAsync(node, [script, ...args], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' },
  })
}

describe('Gmail OAuth helper script', () => {
  it('prints a safe authorization URL without requiring a client secret', async () => {
    const { stdout } = await runAuthScript([
      '--client-id', 'cid.apps.googleusercontent.com',
      '--redirect-uri', 'http://127.0.0.1:4100/oauth2callback',
      '--print-url',
    ])

    expect(stdout).not.toContain('client_secret')
    const urlLine = stdout.split('\n').find((line) => line.startsWith('https://accounts.google.com/o/oauth2/v2/auth'))
    expect(urlLine).toBeTruthy()

    const url = new URL(urlLine!)
    expect(url.searchParams.get('client_id')).toBe('cid.apps.googleusercontent.com')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4100/oauth2callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('supports custom scopes and configurable callback port', async () => {
    const { stdout } = await runAuthScript([
      '--client-id', 'cid.apps.googleusercontent.com',
      '--client-secret', 'super-secret',
      '--port', '4242',
      '--scopes', 'https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/userinfo.email',
      '--print-url',
    ])

    expect(stdout).not.toContain('super-secret')
    const urlLine = stdout.split('\n').find((line) => line.startsWith('https://accounts.google.com/o/oauth2/v2/auth'))
    const url = new URL(urlLine!)
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4242/oauth2callback')
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ])
  })

  it('publishes auth helper npm entry points', async () => {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const pkg = JSON.parse(raw) as { scripts: Record<string, string>, bin: Record<string, string>, files: string[] }
    expect(pkg.scripts['auth:gmail']).toBe('node scripts/auth-gmail.mjs')
    // npm normalizes a leading "./" here and warns on every publish, so the
    // manifest keeps the normalized form.
    expect(pkg.bin['dsh-gmail-auth']).toBe('scripts/auth-gmail.mjs')
    expect(pkg.files).toContain('scripts')
  })
})
