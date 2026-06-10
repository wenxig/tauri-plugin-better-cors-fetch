![tauri-plugin-better-cors-fetch](./banner.png)

<p align="center">
  <a href="https://github.com/semantic-release/semantic-release">
    <img src="https://img.shields.io/badge/semantic--release-angular-e10079?logo=semantic-release" alt="semantic-release: angular" />
  </a>
  <a href="./LICENSE">
    <img src="https://img.shields.io/github/license/wenxig/tauri-plugin-better-cors-fetch" alt="Repo License" />
  </a>
  <a href="https://www.npmjs.com/package/tauri-plugin-better-cors-fetch">
    <img src="https://img.shields.io/npm/dw/tauri-plugin-better-cors-fetch" alt="Npm Downloads" />
  </a>
  <a href="https://crates.io/crates/tauri-plugin-better-cors-fetch">
    <img src="https://img.shields.io/crates/d/tauri-plugin-better-cors-fetch" alt="Crates.io Total Downloads" />
  </a>
</p>

[简体中文](./README.zh-CN.md)

An **unofficial** Tauri plugin that enables **seamless cross-origin (CORS) requests** by transparently proxying the native `fetch` and `XMLHttpRequest` APIs through Tauri's HTTP client.

**Fork from <https://github.com/idootop/tauri-plugin-cors-fetch>**

## Features

- **Low Code Change**: Use standard `fetch()` and `XMLHttpRequest` as you normally would.
- **Streaming & SSE**: Full support for Response Streaming and Server-Sent Events (SSE).
- **Configurable**: Granular control over which domains bypass CORS.
- **Multi-platform**: Supports _Windows, macOS, Linux, iOS, and Android_.

## Quick Start

### 1. Install Dependencies

Install the plugin by your package manager:

```sh
pnpm i tauri-plugin-better-cors-fetch
```

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-better-cors-fetch = "1.3"
```

### 2. Initialize Plugin

Register the plugin in your Tauri setup:

```ts
// src/app.ts
import { CORSFetch } from 'tauri-plugin-better-cors-fetch'
await CORSFetch.init()
```

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_better_cors_fetch::init()) // 👈 here
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
```

### 3. Configure Permissions & Settings

Add the required permission to your capability file:

```jsonc
// src-tauri/capabilities/default.json
{ "permissions": ["cors-fetch:default"] }
```

## Usage

Once initialized, the plugin automatically hooks into the global `fetch` and `XMLHttpRequest`. No changes to your frontend code are required:

```ts
// This request now bypasses CORS automatically
const response = await fetch('https://api.openai.com')
const data = await response.json()

const xhr = new XMLHttpRequest()
xhr.open('GET', 'https://api.openai.com')
xhr.onload = () => console.log(xhr.responseText)
xhr.send()
```

### How It Works

`CORSFetch.init()` keeps the browser-native APIs at `window.fetchNative` and `window.XMLHttpRequestNative`, then installs CORS-aware replacements for `window.fetch` and `window.XMLHttpRequest`.

By default, all `http` and `https` requests are proxied through the Tauri side. You can narrow that behavior with `include` and `exclude`. Tauri internal URLs and `data:` fetches keep using the native browser implementation unless you call the explicit CORS APIs.

### Fetch

Use `fetch()` normally after initialization:

```ts
const response = await fetch('https://example.com/api/users', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ page: 1 })
})

const users = await response.json()
```

Use `window.fetchCORS()` when you want to force the Tauri HTTP path even if the URL does not match the current `include` / `exclude` rules:

```ts
const response = await window.fetchCORS('https://example.com/api/events', {
  headers: { accept: 'text/event-stream' }
})

for await (const chunk of response.body!) {
  console.log(chunk)
}
```

Use `window.fetchNative()` when you explicitly want the browser implementation:

```ts
const response = await window.fetchNative('/local.json')
```

### XMLHttpRequest

`XMLHttpRequest` is also patched globally, so existing libraries that still use XHR can use the same CORS-bypassing path:

```ts
const xhr = new XMLHttpRequest()
xhr.open('POST', 'https://example.com/api/upload')
xhr.responseType = 'json'
xhr.setRequestHeader('content-type', 'application/json')
xhr.onload = () => {
  console.log(xhr.status, xhr.response)
}
xhr.onerror = () => {
  console.error('request failed')
}
xhr.send(JSON.stringify({ name: 'demo' }))
```

Every `CORSFetch` instance also exposes an instance-bound XHR constructor. This is useful when you use a non-global instance with its own `instanceKey`, proxy, cookie jar, or include/exclude rules:

```ts
const core = await CORSFetch.init({ request: { instanceKey: 'private-api' } })

const xhr = new core.XHR()
xhr.open('GET', 'https://example.com/private')
xhr.onload = () => console.log(xhr.responseText)
xhr.send()
```

If you do not want global API injection, initialize with a non-empty `instanceKey`:

```ts
const core = await CORSFetch.init({ request: { instanceKey: 'some' } })
//                                       ^^^^^^ disables global injection.

const xhr = new core.XHR()
```

### Configuration

You can fine-tune the behavior via `cors.setConfig({ config })` or `CORSFetch.init({ config })`:

```ts
// default
await CORSFetch.init({
  include: [],
  exclude: [],
  request: {
    proxy: null,
    connectTimeout: null,
    maxRedirections: null,
    userAgent: navigator.userAgent,
    danger: { acceptInvalidCerts: false, acceptInvalidHostnames: false },
    instanceKey: GLOBAL_INSTANCE_KEY
  }
})
```

### Direct Access APIs

These APIs are available when the default global injection is enabled:

- `window.fetchCORS(url, init)`: Explicitly use the CORS-bypassing fetch.
- `window.fetchNative(url, init)`: Use the original browser fetch, still subject to browser CORS.
- `window.XMLHttpRequestNative`: Use the original browser XHR constructor, still subject to browser CORS.
- `core.XHR`: Create an XHR constructor bound to a specific `CORSFetch` instance.

### Cookies

You can set cookies from TS by calling `cors.setCookie(url, content)` where `content` is a standard `Set-Cookie` header value.

Cookies are stored independently in each instance.

```ts
// Apply to the apex domain and all subdomains.
await cors.setCookie(
  'https://example.com',
  'session=abc123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax'
)
```

This plugin stores cookies using RFC 6265 matching rules (domain/path/secure/expiry), not plain URL prefix matching.

For convenience, you can also build cookies by parts:

```ts
// 1) Host-only cookie (only sent to example.com)
await cors.setCookieByParts('https://example.com', 'hostOnly', '1', {
  path: '/',
  secure: true,
  sameSite: 'Lax'
})

// 2) Whole-site + subdomain cookie
await cors.setCookieByParts('https://example.com', 'allSite', '1', {
  domain: 'example.com',
  path: '/',
  secure: true,
  sameSite: 'Lax'
})

// 3) More granular scope
await cors.setCookieByParts('https://example.com/account/login', 'scoped', '1', {
  path: '/account',
  maxAge: 60 * 60,
  sameSite: 'Strict'
})

// 4) Read a specific cookie value from the cookie jar
const session = await cors.getCookie('https://example.com', 'session')

// 5) Read all cookies that would be sent for this URL
const cookies = await cors.getAllCookies('https://example.com')
// => [{ name: 'session', value: 'abc123' }, ...]

// 6) Delete a cookie by name for this URL scope
const deleted = await cors.deleteCookie('https://example.com', 'session')
```

## Limitations

- **XHR sync mode**: Synchronous `XMLHttpRequest` is not supported by the adapter; use async XHR.

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang)
MIT License © 2026-PRESENT [Wenxig](https://wenxig.vercel.app)