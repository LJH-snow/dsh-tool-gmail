#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import process from 'node:process'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const DEFAULT_PORT = 53683
const DEFAULT_CALLBACK_PATH = '/oauth2callback'
const DEFAULT_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

function printHelp() {
  console.log(`Gmail OAuth helper for @libai168/dsh-tool-gmail

Usage:
  npm run auth:gmail -- --client-id <id> --client-secret <secret>
  npm run auth:gmail -- --client-id <id> --client-secret <secret> --no-open
  npm run auth:gmail -- --client-id <id> --client-secret <secret> --code <authorization-code>
  npm run auth:gmail -- --client-id <id> --print-url

Options:
  --client-id <id>          Google OAuth client ID. Env: GOOGLE_CLIENT_ID
  --client-secret <secret>  Google OAuth client secret. Env: GOOGLE_CLIENT_SECRET
  --redirect-uri <uri>      OAuth redirect URI. Env: GOOGLE_REDIRECT_URI
                            Default: http://127.0.0.1:${DEFAULT_PORT}${DEFAULT_CALLBACK_PATH}
  --port <number>           Local callback server port when --redirect-uri is omitted.
  --scope <scope>           Add one scope. May be repeated. Defaults to Gmail readonly.
  --scopes <list>           Space or comma separated scopes. Overrides defaults.
  --code <code>             Exchange an authorization code directly instead of starting server.
  --code-verifier <value>   PKCE verifier for a code produced by a prior --print-url run.
  --no-open                 Print the URL, but do not open a browser.
  --print-url               Print the authorization URL and exit without network calls.
  --json                    After token exchange, also print the raw token response as JSON.
  -h, --help                Show this help.

Notes:
  - The authorization URL intentionally never includes the client secret.
  - Use access_type=offline and prompt=consent so Google can return a refresh token.
  - The redirect URI must match your Google Cloud OAuth client configuration.
  - Prefer the normal callback flow; use --code only when you cannot receive loopback callbacks.
`)
}

function takeValue(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function splitScopes(value) {
  return value.split(/[\s,]+/).map(scope => scope.trim()).filter(Boolean)
}

export function parseArgs(argv) {
  const args = {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || '',
    port: DEFAULT_PORT,
    scopes: [...DEFAULT_SCOPES],
    scopesSpecified: false,
    code: '',
    codeVerifier: '',
    noOpen: false,
    printUrl: false,
    json: false,
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '--client-id': args.clientId = takeValue(argv, i, arg); i += 1; break
      case '--client-secret': args.clientSecret = takeValue(argv, i, arg); i += 1; break
      case '--redirect-uri': args.redirectUri = takeValue(argv, i, arg); i += 1; break
      case '--port': {
        const raw = takeValue(argv, i, arg); i += 1
        const port = Number(raw)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('--port must be an integer from 1 to 65535')
        args.port = port
        break
      }
      case '--scope': {
        const value = takeValue(argv, i, arg); i += 1
        if (!args.scopesSpecified) { args.scopes = []; args.scopesSpecified = true }
        args.scopes.push(...splitScopes(value))
        break
      }
      case '--scopes': {
        const value = takeValue(argv, i, arg); i += 1
        args.scopes = splitScopes(value)
        args.scopesSpecified = true
        break
      }
      case '--code': args.code = takeValue(argv, i, arg); i += 1; break
      case '--code-verifier': args.codeVerifier = takeValue(argv, i, arg); i += 1; break
      case '--no-open': args.noOpen = true; break
      case '--print-url': args.printUrl = true; args.noOpen = true; break
      case '--json': args.json = true; break
      case '-h':
      case '--help': args.help = true; break
      default: throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!args.redirectUri) args.redirectUri = `http://127.0.0.1:${args.port}${DEFAULT_CALLBACK_PATH}`
  args.scopes = [...new Set(args.scopes)]
  return args
}

function requireAuthConfig(args) {
  if (!args.clientId) throw new Error('Missing --client-id or GOOGLE_CLIENT_ID')
  if (!args.clientSecret && !args.printUrl) throw new Error('Missing --client-secret or GOOGLE_CLIENT_SECRET')
  if (!args.scopes.length) throw new Error('At least one OAuth scope is required')
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createPkcePair() {
  const verifier = base64Url(randomBytes(64))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge, method: 'S256' }
}

export function buildAuthorizationUrl({ clientId, redirectUri, scopes, state, codeChallenge }) {
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)
  if (codeChallenge) {
    url.searchParams.set('code_challenge', codeChallenge)
    url.searchParams.set('code_challenge_method', 'S256')
  }
  return url.toString()
}

async function openBrowser(url) {
  const command = process.platform === 'darwin'
    ? ['open', url]
    : process.platform === 'win32'
      ? ['cmd', '/c', 'start', '', url]
      : ['xdg-open', url]
  const child = spawn(command[0], command.slice(1), { stdio: 'ignore', detached: true })
  child.unref()
}

function html(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`
}

async function waitForAuthorizationCode({ redirectUri, expectedState }) {
  const redirect = new URL(redirectUri)
  if (!['127.0.0.1', 'localhost'].includes(redirect.hostname)) {
    throw new Error('Automatic callback server only supports localhost/127.0.0.1 redirect URIs. Use --code for non-local redirects.')
  }
  if (redirect.protocol !== 'http:') throw new Error('Automatic callback server requires an http:// loopback redirect URI')

  return await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url || '/', redirect.origin)
      if (requestUrl.pathname !== redirect.pathname) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }

      const error = requestUrl.searchParams.get('error')
      const code = requestUrl.searchParams.get('code')
      const state = requestUrl.searchParams.get('state')

      if (error) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html('Google OAuth failed', `Google returned: ${error}. You can close this tab.`))
        server.close(() => reject(new Error(`Google OAuth error: ${error}`)))
        return
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(html('Google OAuth failed', 'State mismatch. You can close this tab.'))
        server.close(() => reject(new Error('OAuth state mismatch')))
        return
      }

      if (!code) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Missing code')
        return
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html('Google OAuth complete', 'Authorization code received. Return to your terminal.'))
      server.close(() => resolve(code))
    })

    server.once('error', reject)
    server.listen(Number(redirect.port), redirect.hostname, () => {
      server.off('error', reject)
    })
  })
}

export async function exchangeAuthorizationCode({ clientId, clientSecret, redirectUri, code, codeVerifier }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  if (codeVerifier) body.set('code_verifier', codeVerifier)

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await response.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { raw: text } }

  if (!response.ok) {
    const detail = parsed.error_description || parsed.error || text || `${response.status} ${response.statusText}`
    throw new Error(`Token exchange failed: ${detail}`)
  }
  return parsed
}

function yamlSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function renderCordisSnippet({ clientId, clientSecret, refreshToken }) {
  return `- name: 'github:LJH-snow/dsh-tool-gmail'\n  config:\n    clientId: ${yamlSingleQuote(clientId)}\n    clientSecret: ${yamlSingleQuote(clientSecret)}\n    refreshToken: ${yamlSingleQuote(refreshToken)}\n`
}

function printNextSteps(args, tokenResponse) {
  if (!tokenResponse.refresh_token) {
    console.error('\nNo refresh_token was returned by Google.')
    console.error('Try again with prompt=consent (already enabled here), or remove the old grant for this app and reauthorize.')
    process.exitCode = 2
    return
  }

  console.log('\nSuccess. Copy this snippet into your DeepSeek Harness / Cordis config:\n')
  console.log(renderCordisSnippet({ clientId: args.clientId, clientSecret: args.clientSecret, refreshToken: tokenResponse.refresh_token }))
  console.log('Keep the refresh token and client secret private. Do not commit them to git.')
  if (args.json) {
    console.log('\nRaw token response JSON:\n')
    console.log(JSON.stringify(tokenResponse, null, 2))
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) { printHelp(); return }
  requireAuthConfig(args)

  if (args.code) {
    console.log('Exchanging supplied authorization code for tokens...')
    const tokenResponse = await exchangeAuthorizationCode({
      clientId: args.clientId,
      clientSecret: args.clientSecret,
      redirectUri: args.redirectUri,
      code: args.code,
      codeVerifier: args.codeVerifier,
    })
    printNextSteps(args, tokenResponse)
    return
  }

  const state = base64Url(randomBytes(24))
  const pkce = createPkcePair()
  const url = buildAuthorizationUrl({
    clientId: args.clientId,
    redirectUri: args.redirectUri,
    scopes: args.scopes,
    state,
    codeChallenge: pkce.challenge,
  })

  console.log('Google authorization URL:\n')
  console.log(url)
  console.log('\nRequested scopes:')
  for (const scope of args.scopes) console.log(`- ${scope}`)

  if (args.printUrl) {
    console.log('\nPKCE code verifier for later --code exchange (keep temporary/private):')
    console.log(pkce.verifier)
    return
  }

  console.log(`\nWaiting for OAuth callback at ${args.redirectUri}`)
  if (!args.noOpen) await openBrowser(url)
  else console.log('Browser auto-open disabled. Open the URL above manually.')
  const code = await waitForAuthorizationCode({ redirectUri: args.redirectUri, expectedState: state })

  console.log('\nExchanging authorization code for tokens...')
  const tokenResponse = await exchangeAuthorizationCode({
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    redirectUri: args.redirectUri,
    code,
    codeVerifier: pkce.verifier,
  })
  printNextSteps(args, tokenResponse)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
