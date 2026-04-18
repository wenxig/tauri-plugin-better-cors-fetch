![tauri-plugin-cors-fetch](./banner.png)

[![MIT licensed](https://img.shields.io/github/license/wenxig/tauri-plugin-better-cors-fetch)](./LICENSE)

An **unofficial** Tauri plugin that enables **seamless cross-origin (CORS) requests** by transparently proxying the native `fetch` API through Tauri's HTTP client.

**Fork from <https://github.com/idootop/tauri-plugin-cors-fetch>**

## Features

- **Low Code Change**: Use standard `fetch()` as you normally would.
- **Streaming & SSE**: Full support for Response Streaming and Server-Sent Events (SSE).
- **Configurable**: Granular control over which domains bypass CORS.
- **Multi-platform**: Supports _Windows, macOS, Linux, iOS, and Android_.

## Quick Start

### 1. Install Dependencies

Install the plugin by your package manager:

```sh
pnpm i https://github.com/wenxig/tauri-plugin-better-cors-fetch
```

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-better-cors-fetch = { git = "https://github.com/wenxig/tauri-plugin-better-cors-fetch", branch = "main" }
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

Once initialized, the plugin automatically hooks into the global `fetch`. No changes to your frontend code are required:

```ts
// This request now bypasses CORS automatically
const response = await fetch('https://api.openai.com')
const data = await response.json()
```

If you don't want to automatically inject to global, you can do:

```ts
await CORSFetch.init({ request: { instanceKey: "some" } })
//                                       ^^^^^^ it will disabled injection to global.
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

### Direct Access APIs (if inject to global)

- `window.fetchCORS(url, init)`: Explicitly use the CORS-bypassing fetch.
- `window.fetchNative(url, init)`: Use the original browser fetch (subject to CORS).

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

- **Fetch Only**: Does not support `XMLHttpRequest` (XHR).

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang)
MIT License © 2026-PRESENT [Wenxig](https://wenxig.vercel.app)
