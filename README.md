![tauri-plugin-cors-fetch](./banner.png)

[![MIT licensed](https://img.shields.io/github/license/delta-comic/tauri-plugin-cors-fetch-no-aws)](./LICENSE)

An **unofficial** Tauri plugin that enables **seamless cross-origin (CORS) requests** by transparently proxying the native `fetch` API through Tauri's HTTP client.

**Fork from <https://github.com/idootop/tauri-plugin-cors-fetch>**

## Features

- **Zero Code Change**: Use standard `fetch()` as you normally would.
- **Streaming & SSE**: Full support for Response Streaming and Server-Sent Events (SSE).
- **Configurable**: Granular control over which domains bypass CORS.
- **Multi-platform**: Supports _Windows, macOS, Linux, iOS, and Android_.

## Quick Start

**1. Install Dependencies**

Add the plugin to your `Cargo.toml`:

```toml
[dependencies]
tauri-plugin-cors-fetch = { git = "https://github.com/delta-comic/tauri-plugin-cors-fetch-no-aws", branch = "main", features = [
  "rustls-tls"
] }
```

**2. Initialize Plugin**

Register the plugin in your Tauri setup:

```rust
// src-tauri/src/lib.rs
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cors_fetch::init()) // 👈 here
        .run(tauri::generate_context!())
        .expect("failed to run app");
}
```

**3. Configure Permissions & Settings**

Add the required permission to your capability file:

```json
// src-tauri/capabilities/default.json
{
  "permissions": ["cors-fetch:default"]
}
```

Ensure `withGlobalTauri` is enabled in `tauri.conf.json`:

```json
// src-tauri/tauri.conf.json
{
  "app": {
    "withGlobalTauri": true
  }
}
```

## Usage

Once initialized, the plugin automatically hooks into the global `fetch`. No changes to your frontend code are required:

```javascript
// This request now bypasses CORS automatically
const response = await fetch("https://api.openai.com");
const data = await response.json();
```

### Configuration

You can fine-tune the behavior via `window.CORSFetch.config()`:

```javascript
window.CORSFetch.config({
  include: [/^https?:\/\//i], // Patterns to proxy (default: all)
  exclude: ["https://api.openai.com/v1/chat/completions"],
  // Default request options for Tauri HTTP Client
  request: {
    connectTimeout: 30 * 1000, // ms
    maxRedirections: 5,
    proxy: {
      all: "http://127.0.0.1:7890",
    },
    danger: {
      acceptInvalidCerts: false,
      acceptInvalidHostnames: false,
    },
    userAgent: navigator.userAgent,
  },
});
```

### Direct Access APIs

- `window.fetchCORS(url, init)`: Explicitly use the CORS-bypassing fetch.
- `window.fetchNative(url, init)`: Use the original browser fetch (subject to CORS).

## Limitations

- **Fetch Only**: Does not support `XMLHttpRequest` (XHR).

## License

MIT License © 2024-PRESENT [Del Wang](https://del.wang)
