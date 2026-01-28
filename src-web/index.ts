import { invoke } from "@tauri-apps/api/core"
import { isString, merge } from "es-toolkit"

declare global {
  interface Window {
    CORSFetch?: CORSFetch
    fetchNative: typeof fetch
    fetchCORS: (input: Parameters<typeof fetch>[0], init: CORSFetchInit) => ReturnType<CORSFetch['fetchCORS']>
    fetch: CORSFetch['fetchCORS']
  }
}

export interface CORSFetchConfig {
  include: (string | RegExp)[]
  exclude: (string | RegExp)[]
  request: {
    proxy?: Record<string, string>,
    connectTimeout?: number,
    maxRedirections?: number,
    userAgent?: string,
    danger?: {
      acceptInvalidCerts: boolean,
      acceptInvalidHostnames: boolean,
    },
  },
}

export type CORSFetchInit = RequestInit & Partial<CORSFetchConfig['request']>

export class CORSFetch {
  public static init() {
    if (!window.CORSFetch)
      window.CORSFetch = new CORSFetch()
    return window.CORSFetch!
  }
  protected constructor() {
    window.fetchNative = window.fetch.bind(window)
    window.fetch = this.fetchCORS.bind(this)
    window.fetchCORS = (input, init) => this.fetchCORS(input, init, true)
  }

  private _config: CORSFetchConfig = {
    include: [],
    exclude: [],
    request: {
      proxy: undefined,
      connectTimeout: undefined,
      maxRedirections: undefined,
      userAgent: navigator.userAgent,
      danger: {
        acceptInvalidCerts: false,
        acceptInvalidHostnames: false,
      },
    },
  };

  public config(newConfig: Partial<CORSFetchConfig>) {

    this._config = merge(this._config, newConfig)
  }

  public async fetchCORS(input: Parameters<typeof fetch>[0], init?: CORSFetchInit, force = false) {
    const urlStr = input instanceof Request ? input.url : String(input)
    console.debug(`[fetchCORS] begin -> ${urlStr}`)

    if (!force && !this.shouldUseCORSProxy(urlStr)) {
      console.debug(`[fetchCORS] ${urlStr} browser`)
      return window.fetchNative(input, init)
    }

    const signal =
      isString(input) ? init?.signal
        : (input instanceof URL) ? init?.signal
          : init?.signal ?? input.signal
    if (signal?.aborted) throw this.cancel_error

    let rid: string | null = null
    let responseRid: string | null = null

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort)

      if (responseRid !== null) {
        invoke("plugin:cors-fetch|fetch_cancel_body", {
          rid: responseRid,
        }).catch(() => { })
        responseRid = null
      }

      if (rid !== null) {
        invoke("plugin:cors-fetch|fetch_cancel", { rid }).catch(() => { })
        rid = null
      }
    }

    const onAbort = () => cleanup()
    signal?.addEventListener("abort", onAbort)

    const {
      maxRedirections = this._config.request.maxRedirections,
      connectTimeout = this._config.request.connectTimeout,
      proxy = this._config.request.proxy,
      danger = this._config.request.danger,
      userAgent = this._config.request.userAgent,
      ...nativeInit
    } = (init || {})

    const req = input instanceof Request ? input : new Request(input, nativeInit)
    const buffer = await req.arrayBuffer()

    if (signal?.aborted) throw this.cancel_error

    if (!req.headers.has('Content-Type'))
      req.headers.set('Content-Type', 'application/json')

    try {
      const clientConfig = {
        method: req.method,
        url: urlStr,
        headers: Object.entries(req.headers),
        data: buffer.byteLength ? Array.from(new Uint8Array(buffer)) : null,
        maxRedirections,
        connectTimeout,
        proxy,
        danger,
        userAgent,
      }


      console.debug(`[fetchCORS] ${urlStr}`, 'config:', clientConfig, 'headers:', req.headers, 'request:', req)

      rid = await invoke("plugin:cors-fetch|fetch", {
        clientConfig
      })

      if (signal?.aborted) throw this.cancel_error

      const {
        status,
        statusText,
        url,
        headers: responseHeaders,
        rid: _rid,
      } = await invoke<{
        statusText: string,
        url: string
        rid: string
        headers: Record<string, string>
        status: number
      }>("plugin:cors-fetch|fetch_send", {
        rid,
      })
      responseRid = _rid

      if (signal?.aborted) throw this.cancel_error

      const readChunk = async (controller: ReadableStreamDefaultController) => {
        if (signal?.aborted) {
          controller.error(this.cancel_error)
          return
        }

        try {
          const data = await invoke<ArrayBuffer>("plugin:cors-fetch|fetch_read_body", {
            rid: responseRid,
          })
          const dataUint8 = new Uint8Array(data)
          const lastByte = dataUint8[dataUint8.byteLength - 1]
          const actualData = dataUint8.slice(0, dataUint8.byteLength - 1)

          // close when the signal to close (last byte is 1) is sent from the IPC.
          if (lastByte === 1) {
            controller.close()
            return
          }

          controller.enqueue(actualData)
        } catch (e) {
          controller.error(e)
          cleanup()
        }
      }

      // no body for 101, 103, 204, 205 and 304
      // see https://fetch.spec.whatwg.org/#null-body-status
      const body = [101, 103, 204, 205, 304].includes(status)
        ? null
        : new ReadableStream({ pull: readChunk, cancel: onAbort })

      const res = new Response(body, {
        status,
        statusText,
      })

      // Set `Response` properties that are ignored by the
      // constructor, like url and some headers
      //
      // Since url and headers are read only properties
      // this is the only way to set them.
      Object.defineProperty(res, "url", { value: url })
      Object.defineProperty(res, "headers", {
        value: new Headers(responseHeaders),
      })

      return res
    } catch (err) {
      cleanup()
      throw err
    }
  }

  private cancel_error = "User cancelled the request";

  private matchesPattern(url: string, patterns: (string | RegExp)[]) {
    return patterns.some((pattern) => {
      if (isString(pattern)) return url.includes(pattern)
      if (pattern instanceof RegExp) return pattern.test(url)
      return false
    })
  }

  private shouldUseCORSProxy(url: string) {
    // Exclude Tauri internal protocols (ipc:// or asset://)
    // https://github.com/tauri-apps/tauri/blob/b5c549d1898ecdb712822c02dc665cc6771fbd07/crates/tauri/scripts/core.js#L16
    const isTauriProtocol =
      /^(ipc|asset):\/\/localhost\//i.test(url) ||
      /^http:\/\/(ipc|asset)\.localhost\//i.test(url)
    if (isTauriProtocol) return false

    const { include, exclude } = this._config

    // Priority: exclusion list
    if (exclude.length > 0 && this.matchesPattern(url, exclude)) {
      return false
    }

    // If there is an inclusion list, only proxy URLs in that list
    if (include.length > 0) {
      return this.matchesPattern(url, include)
    }

    // Default: proxy all http(s) requests
    return /^https?:\/\//i.test(url)
  }
}