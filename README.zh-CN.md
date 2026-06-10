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

[English](./README.md)

一个**非官方** Tauri 插件，用于让前端以接近原生的方式发起跨域请求。插件会把浏览器侧的 `fetch` 和 `XMLHttpRequest` 透明代理到 Tauri 侧 HTTP client，从而绕过浏览器 CORS 限制。

**Fork from <https://github.com/idootop/tauri-plugin-cors-fetch>**

## 功能

- **低改造成本**：继续使用标准 `fetch()` 和 `XMLHttpRequest`。
- **流式响应与 SSE**：支持 `Response` streaming 和 Server-Sent Events。
- **可配置规则**：通过 `include` / `exclude` 控制哪些域名走 Tauri 代理。
- **多平台**：支持 _Windows、macOS、Linux、iOS 和 Android_。

## 快速开始

### 1. 安装依赖

用你的包管理器安装前端包：

```sh
pnpm i tauri-plugin-better-cors-fetch
```

在 `Cargo.toml` 中加入 Rust 插件：

```toml
[dependencies]
tauri-plugin-better-cors-fetch = "1.3"
```

### 2. 初始化插件

在前端入口初始化：

```ts
// src/app.ts
import { CORSFetch } from 'tauri-plugin-better-cors-fetch'
await CORSFetch.init()
```

在 Tauri 侧注册插件：

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_better_cors_fetch::init())
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
```

### 3. 配置权限

在 capability 文件中加入权限：

```jsonc
// src-tauri/capabilities/default.json
{ "permissions": ["cors-fetch:default"] }
```

## 使用

初始化后，插件会自动接管全局 `fetch` 和 `XMLHttpRequest`。已有前端代码通常无需修改：

```ts
// 该请求会自动绕过浏览器 CORS 限制
const response = await fetch('https://api.openai.com')
const data = await response.json()

const xhr = new XMLHttpRequest()
xhr.open('GET', 'https://api.openai.com')
xhr.onload = () => console.log(xhr.responseText)
xhr.send()
```

### 工作方式

`CORSFetch.init()` 会先保存浏览器原生 API 到 `window.fetchNative` 和 `window.XMLHttpRequestNative`，再把全局 `window.fetch` 和 `window.XMLHttpRequest` 替换为支持 CORS 代理的实现。

默认情况下，所有 `http` 和 `https` 请求都会走 Tauri 侧 HTTP client。你可以通过 `include` 和 `exclude` 缩小或排除代理范围。Tauri 内部 URL 和普通 `data:` fetch 默认仍走浏览器原生实现，除非你显式调用强制代理 API。

### Fetch 用法

初始化后可以继续正常使用 `fetch()`：

```ts
const response = await fetch('https://example.com/api/users', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ page: 1 })
})

const users = await response.json()
```

当你想忽略当前 `include` / `exclude` 规则并强制走 Tauri HTTP 通道时，使用 `window.fetchCORS()`：

```ts
const response = await window.fetchCORS('https://example.com/api/events', {
  headers: { accept: 'text/event-stream' }
})

for await (const chunk of response.body!) {
  console.log(chunk)
}
```

当你明确要使用浏览器原生 fetch 时，使用 `window.fetchNative()`：

```ts
const response = await window.fetchNative('/local.json')
```

### XMLHttpRequest 用法

插件也会接管全局 `XMLHttpRequest`，因此仍使用 XHR 的旧库也可以走同一套 CORS 代理：

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

每个 `CORSFetch` 实例也会暴露一个绑定该实例配置的 XHR 构造器。当你使用非全局实例，并且需要它自己的 `instanceKey`、代理、cookie jar 或 include/exclude 规则时，可以直接使用 `core.XHR`：

```ts
const core = await CORSFetch.init({ request: { instanceKey: 'private-api' } })

const xhr = new core.XHR()
xhr.open('GET', 'https://example.com/private')
xhr.onload = () => console.log(xhr.responseText)
xhr.send()
```

如果你不想自动注入到全局对象，可以指定非空 `instanceKey`：

```ts
const core = await CORSFetch.init({ request: { instanceKey: 'some' } })
//                                       ^^^^^^ 非空 instanceKey 会禁用全局注入

const xhr = new core.XHR()
```

### 配置

你可以通过 `cors.setConfig({ config })` 或 `CORSFetch.init({ config })` 调整行为：

```ts
// 默认配置
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

### 全局直连 API

仅在默认全局注入启用时可用：

- `window.fetchCORS(url, init)`：显式使用绕过 CORS 的 fetch。
- `window.fetchNative(url, init)`：使用浏览器原生 fetch，仍受浏览器 CORS 约束。
- `window.XMLHttpRequestNative`：使用浏览器原生 XHR constructor，仍受浏览器 CORS 约束。
- `core.XHR`：创建绑定到某个 `CORSFetch` 实例的 XHR constructor。

### Cookies

可以通过 `cors.setCookie(url, content)` 在 TS 侧写入 cookie，其中 `content` 是标准 `Set-Cookie` header 值。

每个实例拥有独立 cookie 存储。

```ts
// 应用到根域名和所有子域名
await cors.setCookie(
  'https://example.com',
  'session=abc123; Domain=example.com; Path=/; Secure; HttpOnly; SameSite=Lax'
)
```

插件按 RFC 6265 的 domain/path/secure/expiry 规则匹配 cookie，而不是做简单 URL 前缀匹配。

也可以用分段参数构建 cookie：

```ts
// 1) Host-only cookie，仅发送给 example.com
await cors.setCookieByParts('https://example.com', 'hostOnly', '1', {
  path: '/',
  secure: true,
  sameSite: 'Lax'
})

// 2) 整站和子域名共享 cookie
await cors.setCookieByParts('https://example.com', 'allSite', '1', {
  domain: 'example.com',
  path: '/',
  secure: true,
  sameSite: 'Lax'
})

// 3) 更细粒度的路径范围
await cors.setCookieByParts('https://example.com/account/login', 'scoped', '1', {
  path: '/account',
  maxAge: 60 * 60,
  sameSite: 'Strict'
})

// 4) 读取指定 cookie
const session = await cors.getCookie('https://example.com', 'session')

// 5) 读取该 URL 会发送的所有 cookie
const cookies = await cors.getAllCookies('https://example.com')
// => [{ name: 'session', value: 'abc123' }, ...]

// 6) 删除指定 cookie
const deleted = await cors.deleteCookie('https://example.com', 'session')
```

## 限制

- **XHR 同步模式**：适配器不支持同步 `XMLHttpRequest`，请使用异步 XHR。

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang)
MIT License © 2026-PRESENT [Wenxig](https://wenxig.vercel.app)