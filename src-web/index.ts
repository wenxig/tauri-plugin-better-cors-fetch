import { invoke } from '@tauri-apps/api/core'
import { AbortError, isDate, isNumber, isString, merge } from 'es-toolkit'

import type { ClearCookiesConfig } from './types/ClearCookiesConfig'
import { ClientConfig } from './types/ClientConfig'
import type { ContentConfig } from './types/ContentConfig'
import type { CookieEntry } from './types/CookieEntry'
import type { DeleteCookieConfig } from './types/DeleteCookieConfig'
import type { FetchResponse } from './types/FetchResponse'
import type { GetAllCookiesConfig } from './types/GetAllCookiesConfig'
import type { GetAllDomainCookiesConfig } from './types/GetAllDomainCookiesConfig'
import type { GetCookieConfig } from './types/GetCookieConfig'
import type { SetCookieConfig } from './types/SetCookieConfig'

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

export interface CookieOptions {
  domain?: string
  path?: string
  expires?: Date | string
  maxAge?: number
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}
export type CORSFetchInit = RequestInit & Partial<CORSFetchConfig['request']>

export const GLOBAL_INSTANCE_KEY = ''

export class CORSFetch {
  /**
   * @param config 如果`config.request.instanceKey`是`""`或`undefined`，则默认注入全局，并使用全局instance
   */
  public static async init(config?: DeepPartial<CORSFetchConfig>) {
    const cors = new CORSFetch(config)
    const instanceKey = cors.config.request.instanceKey

    const prepareConfig: ClientConfig = cors.config.request
    await invoke<void>('plugin:cors-fetch|prepare_requester', prepareConfig)

    if (instanceKey == GLOBAL_INSTANCE_KEY && !window.CORSFetch) {
      window.CORSFetch = cors
      window.fetchNative = window.fetch.bind(window)
      window.fetch = cors.fetch.bind(cors)
      window.fetchCORS = (input, init) => cors.fetch(input, init, true)
    }
    return cors
  }
  public setCookie(url: string | URL, content: string) {
    const config: SetCookieConfig = {
      url: String(url),
      content,
      instanceKey: this.config.request.instanceKey
    }
    return invoke<void>('plugin:cors-fetch|set_cookie', { config })
  }

  public getCookie(url: string | URL, name: string) {
    const config: GetCookieConfig = {
      url: String(url),
      name,
      instanceKey: this.config.request.instanceKey
    }
    return invoke<string | null>('plugin:cors-fetch|get_cookie', { config })
  }

  public getAllDomainCookies(url: string | URL) {
    const config: GetAllDomainCookiesConfig = {
      url: String(url),
      instanceKey: this.config.request.instanceKey
    }
    return invoke<CookieEntry[]>('plugin:cors-fetch|get_all_domain_cookies', { config })
  }

  public getAllCookies() {
    const config: GetAllCookiesConfig = { instanceKey: this.config.request.instanceKey }
    return invoke<CookieEntry[]>('plugin:cors-fetch|get_all_cookies', config)
  }

  public deleteCookie(url: string | URL, path = '/', name: string) {
    const config: DeleteCookieConfig = {
      url: url.toString(),
      name,
      path,
      instanceKey: this.config.request.instanceKey
    }
    return invoke<boolean>('plugin:cors-fetch|delete_cookie', { config })
  }

  public clearCookie() {
    const config: ClearCookiesConfig = { instanceKey: this.config.request.instanceKey }
    return invoke<void>('plugin:cors-fetch|clear_cookie', config)
  }

  public setCookieByParts(
    url: string | URL,
    name: string,
    value: string,
    options: CookieOptions = {}
  ) {
    const segments = [`${name}=${value}`]

    if (options.domain) segments.push(`Domain=${options.domain}`)
    if (options.path) segments.push(`Path=${options.path}`)
    if (options.expires) {
      const expires = isDate(options.expires)
        ? options.expires.toUTCString()
        : new Date(options.expires).toUTCString()
      segments.push(`Expires=${expires}`)
    }
    if (isNumber(options.maxAge)) segments.push(`Max-Age=${options.maxAge}`)
    if (options.secure) segments.push('Secure')
    if (options.httpOnly) segments.push('HttpOnly')
    if (options.sameSite) segments.push(`SameSite=${options.sameSite}`)

    return this.setCookie(url, segments.join('; '))
  }
  protected constructor(config?: DeepPartial<CORSFetchConfig>) {
    void this.setConfig(config ?? {})
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
      danger: { acceptInvalidCerts: false, acceptInvalidHostnames: false },
      instanceKey: GLOBAL_INSTANCE_KEY
    }
  }

  public get config() {
    return this._config
  }

  public setConfig(newConfig: DeepPartial<CORSFetchConfig>) {
    this._config = merge(this._config, newConfig)
    return invoke<void>('plugin:cors-fetch|prepare_requester', { config: this._config }).catch(
      () => {}
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

    let rid: number | null = null
    let responseRid: number | null = null

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)

      if (responseRid !== null) {
        invoke('plugin:cors-fetch|fetch_cancel_body', { rid: responseRid }).catch(() => {})
        responseRid = null
      }

      if (rid !== null) {
        invoke('plugin:cors-fetch|fetch_cancel', { rid }).catch(() => {})
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
      } = await invoke<FetchResponse>('plugin:cors-fetch|fetch_send', { rid })
      responseRid = _rid

      if (signal?.aborted) throw this.cancel_error

      const chunkBuffer: Uint8Array[] = []
      const totalBufferedBytes = { value: 0 }

      // no body for 101, 103, 204, 205 and 304
      // see https://fetch.spec.whatwg.org/#null-body-status
      const body = [101, 103, 204, 205, 304].includes(status)
        ? null
        : new ReadableStream({
            pull: c =>
              this.readStream(
                { chunkBuffer: chunkBuffer, cleanup, totalBufferedBytes, responseRid, signal },
                c
              ),
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
      totalBufferedBytes,
      signal,
      chunkBuffer,
      cleanup,
      responseRid
    }: {
      signal?: AbortSignal | null
      chunkBuffer: Uint8Array[]
      totalBufferedBytes: { value: number }
      responseRid: number | null
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
          cleanup()
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

  private cancel_error = new AbortError('User cancelled the request')

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