import { invoke } from '@tauri-apps/api/core'
import { isString, merge } from 'es-toolkit'

import { ClientConfig } from './types/ClientConfig'
import type { ContentConfig } from './types/ContentConfig'

declare global {
  interface Window {
    CORSFetch?: CORSFetch
    fetchNative: typeof fetch
    fetchCORS: (
      input: Parameters<typeof fetch>[0],
      init: CORSFetchInit
    ) => ReturnType<CORSFetch['fetch']>
    fetch: CORSFetch['fetch']
  }
}

export interface CORSFetchConfig {
  include: (string | RegExp)[]
  exclude: (string | RegExp)[]
  request: ClientConfig
}
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
export type CORSFetchInit = RequestInit & Partial<CORSFetchConfig['request']>

export class CORSFetch {
  public static init(config?: DeepPartial<CORSFetchConfig>, inject = true) {
    if (inject) {
      if (!window.CORSFetch) window.CORSFetch = new CORSFetch(inject, config)
      return window.CORSFetch!
    }
    return new CORSFetch(false, config)
  }
  protected constructor(inject = true, config?: DeepPartial<CORSFetchConfig>) {
    if (inject) {
      window.fetchNative = window.fetch.bind(window)
      window.fetch = this.fetch.bind(this)
      window.fetchCORS = (input, init) => this.fetch(input, init, true)
    }
    this.config(config ?? {})
  }

  private _streamConfig = { bufferSize: 5, maxBufferBytes: 256 * 1024 }
  private _config: CORSFetchConfig = {
    include: [],
    exclude: [],
    request: {
      proxy: null,
      connectTimeout: null,
      maxRedirections: null,
      userAgent: navigator.userAgent,
      danger: { acceptInvalidCerts: false, acceptInvalidHostnames: false }
    }
  }

  public config(newConfig: DeepPartial<CORSFetchConfig>) {
    this._config = merge(this._config, newConfig)
    return invoke<void>('plugin:cors-fetch|prepare_requester', { config: this._config }).catch(
      () => { }
    )
  }

  private combineChunks(chunks: Uint8Array[], totalSize: number): Uint8Array {
    const combined = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return combined
  }

  public async fetch(input: Parameters<typeof fetch>[0], init?: CORSFetchInit, force = false) {

    const urlStr = input instanceof Request ? input.url : String(input)

    if (!force && urlStr.startsWith('data:')) {
      return window.fetchNative(input, init)
    }
    if (!force && !this.shouldUseCORSProxy(urlStr)) {
      return window.fetchNative(input, init)
    }

    const signal = isString(input)
      ? init?.signal
      : input instanceof URL
        ? init?.signal
        : (init?.signal ?? input.signal)
    if (signal?.aborted) throw this.cancel_error

    let rid: string | null = null
    let responseRid: string | null = null

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)

      if (responseRid !== null) {
        invoke('plugin:cors-fetch|fetch_cancel_body', { rid: responseRid }).catch(() => { })
        responseRid = null
      }

      if (rid !== null) {
        invoke('plugin:cors-fetch|fetch_cancel', { rid }).catch(() => { })
        rid = null
      }
    }

    const onAbort = () => cleanup()
    signal?.addEventListener('abort', onAbort)

    const req = input instanceof Request ? input : new Request(input, init)
    const buffer = await req.arrayBuffer()

    if (signal?.aborted) throw this.cancel_error

    try {
      const contentConfig: ContentConfig = {
        method: req.method,
        url: urlStr,
        headers: Array.from(req.headers.entries()),
        data: buffer.byteLength ? Array.from(new Uint8Array(buffer)) : null,
        client: this._config.request
      }

      rid = await invoke('plugin:cors-fetch|fetch', { contentConfig })

      if (signal?.aborted) throw this.cancel_error

      const {
        status,
        statusText,
        url,
        headers: responseHeaders,
        rid: _rid
      } = await invoke<{
        statusText: string
        url: string
        rid: string
        headers: Record<string, string>
        status: number
      }>('plugin:cors-fetch|fetch_send', { rid })
      responseRid = _rid

      if (signal?.aborted) throw this.cancel_error

      const chunkBuffer: Uint8Array[] = []
      let totalBufferedBytes = 0

      // no body for 101, 103, 204, 205 and 304
      // see https://fetch.spec.whatwg.org/#null-body-status
      const body = [101, 103, 204, 205, 304].includes(status)
        ? null
        : new ReadableStream({
          pull: c =>
            this.readStream({ chunkBuffer: chunkBuffer, cleanup, totalBufferedBytes: { value: totalBufferedBytes }, responseRid, signal }, c),
          cancel: onAbort
        })

      const res = new Response(body, { status, statusText })

      // Set `Response` properties that are ignored by the
      // constructor, like url and some headers
      //
      // Since url and headers are read only properties
      // this is the only way to set them.
      Object.defineProperty(res, 'url', { value: url })
      Object.defineProperty(res, 'headers', { value: new Headers(responseHeaders) })

      return res
    } catch (err) {
      cleanup()
      throw err
    }
  }

  private async readStream(
    {
      signal,
      chunkBuffer,
      totalBufferedBytes,
      responseRid,
      cleanup
    }: {
      signal?: AbortSignal | null
      chunkBuffer: Uint8Array[]
      totalBufferedBytes: { value: number }
      responseRid: string | null
      cleanup: () => void
    },
    controller: ReadableStreamDefaultController
  ) {
    if (signal?.aborted) {
      controller.error(this.cancel_error)
      return
    }

    try {
      while (
        chunkBuffer.length < this._streamConfig.bufferSize &&
        totalBufferedBytes.value < this._streamConfig.maxBufferBytes
      ) {
        const data = await invoke<ArrayBuffer>('plugin:cors-fetch|fetch_read_body', {
          rid: responseRid
        })
        const dataUint8 = new Uint8Array(data)
        const lastByte = dataUint8[dataUint8.byteLength - 1]
        const actualData = dataUint8.slice(0, dataUint8.byteLength - 1)

        if (lastByte === 1) {
          if (chunkBuffer.length > 0) {
            const combined = this.combineChunks(chunkBuffer, totalBufferedBytes.value)
            controller.enqueue(combined)
          }
          controller.close()
          return
        }

        if (actualData.byteLength > 0) {
          chunkBuffer.push(actualData)
          totalBufferedBytes.value += actualData.byteLength
        }

        if (signal?.aborted) {
          controller.error(this.cancel_error)
          return
        }
      }

      // 推送缓冲的数据
      if (chunkBuffer.length > 0) {
        const combined = this.combineChunks(chunkBuffer, totalBufferedBytes.value)
        controller.enqueue(combined)

        // 清空缓冲区
        chunkBuffer.length = 0
        totalBufferedBytes.value = 0
      }
    } catch (e) {
      controller.error(e)
      cleanup()
    }
  }

  private cancel_error = 'User cancelled the request'

  private matchesPattern(url: string, patterns: (string | RegExp)[]) {
    return patterns.some(pattern => {
      if (isString(pattern)) return url.includes(pattern)
      if (pattern instanceof RegExp) return pattern.test(url)
      return false
    })
  }

  private shouldUseCORSProxy(url: string) {
    // Exclude Tauri internal protocols (ipc:// or asset://)
    // https://github.com/tauri-apps/tauri/blob/b5c549d1898ecdb712822c02dc665cc6771fbd07/crates/tauri/scripts/core.js#L16
    const isTauriProtocol =
      /^(ipc|asset):\/\/localhost\//i.test(url) || /^http:\/\/(ipc|asset)\.localhost\//i.test(url)
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