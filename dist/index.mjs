/**
* Sends a message to the backend.
* @example
* ```typescript
* import { invoke } from '@tauri-apps/api/core';
* await invoke('login', { user: 'tauri', password: 'poiwe3h4r5ip3yrhtew9ty' });
* ```
*
* @param cmd The command name.
* @param args The optional arguments to pass to the command.
* @param options The request options.
* @return A promise resolving or rejecting to the backend response.
*
* @since 1.0.0
*/
async function invoke(cmd, args = {}, options) {
	return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
//#endregion
//#region node_modules/es-toolkit/dist/predicate/isPlainObject.mjs
function isPlainObject(value) {
	if (!value || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	if (!(proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null)) return false;
	return Object.prototype.toString.call(value) === "[object Object]";
}
//#endregion
//#region node_modules/es-toolkit/dist/_internal/isUnsafeProperty.mjs
function isUnsafeProperty(key) {
	return key === "__proto__";
}
//#endregion
//#region node_modules/es-toolkit/dist/object/merge.mjs
function merge(target, source) {
	const sourceKeys = Object.keys(source);
	for (let i = 0; i < sourceKeys.length; i++) {
		const key = sourceKeys[i];
		if (isUnsafeProperty(key)) continue;
		const sourceValue = source[key];
		const targetValue = target[key];
		if (isMergeableValue(sourceValue) && isMergeableValue(targetValue)) target[key] = merge(targetValue, sourceValue);
		else if (Array.isArray(sourceValue)) target[key] = merge([], sourceValue);
		else if (isPlainObject(sourceValue)) target[key] = merge({}, sourceValue);
		else if (targetValue === void 0 || sourceValue !== void 0) target[key] = sourceValue;
	}
	return target;
}
function isMergeableValue(value) {
	return isPlainObject(value) || Array.isArray(value);
}
//#endregion
//#region node_modules/es-toolkit/dist/predicate/isString.mjs
function isString(value) {
	return typeof value === "string";
}
//#endregion
//#region src-web/index.ts
var CORSFetch = class CORSFetch {
	static init(config, inject = true) {
		if (inject) {
			if (!window.CORSFetch) window.CORSFetch = new CORSFetch(inject, config);
			return window.CORSFetch;
		}
		return new CORSFetch(false, config);
	}
	static setCookie(url, content) {
		return invoke("plugin:cors-fetch|set_cookie", { config: {
			url: String(url),
			content
		} });
	}
	static getCookie(url, name) {
		return invoke("plugin:cors-fetch|get_cookie", { config: {
			url: String(url),
			name
		} });
	}
	static getAllDomainCookies(url) {
		return invoke("plugin:cors-fetch|get_all_domain_cookies", { config: { url: String(url) } });
	}
	static getAllCookies() {
		return invoke("plugin:cors-fetch|get_all_cookies");
	}
	static deleteCookie(url, path = "/", name) {
		return invoke("plugin:cors-fetch|delete_cookie", { config: {
			url: url.toString(),
			name,
			path
		} });
	}
	static clearCookie() {
		return invoke("plugin:cors-fetch|clear_cookie");
	}
	static setCookieByParts(url, name, value, options = {}) {
		const segments = [`${name}=${value}`];
		if (options.domain) segments.push(`Domain=${options.domain}`);
		if (options.path) segments.push(`Path=${options.path}`);
		if (options.expires) {
			const expires = options.expires instanceof Date ? options.expires.toUTCString() : new Date(options.expires).toUTCString();
			segments.push(`Expires=${expires}`);
		}
		if (typeof options.maxAge === "number") segments.push(`Max-Age=${options.maxAge}`);
		if (options.secure) segments.push("Secure");
		if (options.httpOnly) segments.push("HttpOnly");
		if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
		return CORSFetch.setCookie(url, segments.join("; "));
	}
	constructor(inject = true, config) {
		if (inject) {
			window.fetchNative = window.fetch.bind(window);
			window.fetch = this.fetch.bind(this);
			window.fetchCORS = (input, init) => this.fetch(input, init, true);
		}
		this.config(config ?? {});
	}
	_streamConfig = {
		bufferSize: 5,
		maxBufferBytes: 256 * 1024
	};
	_config = {
		include: [],
		exclude: [],
		request: {
			proxy: null,
			connectTimeout: null,
			maxRedirections: null,
			userAgent: navigator.userAgent,
			danger: {
				acceptInvalidCerts: false,
				acceptInvalidHostnames: false
			}
		}
	};
	config(newConfig) {
		this._config = merge(this._config, newConfig);
		return invoke("plugin:cors-fetch|prepare_requester", { config: this._config }).catch(() => {});
	}
	combineChunks(chunks, totalSize) {
		const combined = new Uint8Array(totalSize);
		let offset = 0;
		for (const chunk of chunks) {
			combined.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return combined;
	}
	async fetch(input, init, force = false) {
		const urlStr = input instanceof Request ? input.url : String(input);
		if (!force && urlStr.startsWith("data:")) return window.fetchNative(input, init);
		if (!force && !this.shouldUseCORSProxy(urlStr)) return window.fetchNative(input, init);
		const signal = isString(input) ? init?.signal : input instanceof URL ? init?.signal : init?.signal ?? input.signal;
		if (signal?.aborted) throw this.cancel_error;
		let rid = null;
		let responseRid = null;
		const cleanup = () => {
			signal?.removeEventListener("abort", onAbort);
			if (responseRid !== null) {
				invoke("plugin:cors-fetch|fetch_cancel_body", { rid: responseRid }).catch(() => {});
				responseRid = null;
			}
			if (rid !== null) {
				invoke("plugin:cors-fetch|fetch_cancel", { rid }).catch(() => {});
				rid = null;
			}
		};
		const onAbort = () => cleanup();
		signal?.addEventListener("abort", onAbort);
		const req = input instanceof Request ? input : new Request(input, init);
		const buffer = await req.arrayBuffer();
		if (signal?.aborted) throw this.cancel_error;
		try {
			rid = await invoke("plugin:cors-fetch|fetch", { contentConfig: {
				method: req.method,
				url: urlStr,
				headers: Array.from(req.headers.entries()),
				data: buffer.byteLength ? Array.from(new Uint8Array(buffer)) : null,
				client: this._config.request
			} });
			if (signal?.aborted) throw this.cancel_error;
			const { status, statusText, url, headers: responseHeaders, rid: _rid } = await invoke("plugin:cors-fetch|fetch_send", { rid });
			responseRid = _rid;
			if (signal?.aborted) throw this.cancel_error;
			const chunkBuffer = [];
			const totalBufferedBytes = { value: 0 };
			const body = [
				101,
				103,
				204,
				205,
				304
			].includes(status) ? null : new ReadableStream({
				pull: (c) => this.readStream({
					chunkBuffer,
					cleanup,
					totalBufferedBytes,
					responseRid,
					signal
				}, c),
				cancel: onAbort
			});
			const res = new Response(body, {
				status,
				statusText
			});
			Object.defineProperty(res, "url", { value: url });
			Object.defineProperty(res, "headers", { value: new Headers(responseHeaders) });
			return res;
		} catch (err) {
			cleanup();
			throw err;
		}
	}
	async readStream({ totalBufferedBytes, signal, chunkBuffer, cleanup, responseRid }, controller) {
		if (signal?.aborted) {
			controller.error(this.cancel_error);
			return;
		}
		try {
			while (chunkBuffer.length < this._streamConfig.bufferSize && totalBufferedBytes.value < this._streamConfig.maxBufferBytes) {
				const data = await invoke("plugin:cors-fetch|fetch_read_body", { rid: responseRid });
				const dataUint8 = new Uint8Array(data);
				const lastByte = dataUint8[dataUint8.byteLength - 1];
				const actualData = dataUint8.slice(0, dataUint8.byteLength - 1);
				if (lastByte === 1) {
					if (chunkBuffer.length > 0) {
						const combined = this.combineChunks(chunkBuffer, totalBufferedBytes.value);
						controller.enqueue(combined);
					}
					cleanup();
					controller.close();
					return;
				}
				if (actualData.byteLength > 0) {
					chunkBuffer.push(actualData);
					totalBufferedBytes.value += actualData.byteLength;
				}
				if (signal?.aborted) {
					controller.error(this.cancel_error);
					return;
				}
			}
			if (chunkBuffer.length > 0) {
				const combined = this.combineChunks(chunkBuffer, totalBufferedBytes.value);
				controller.enqueue(combined);
				chunkBuffer.length = 0;
				totalBufferedBytes.value = 0;
			}
		} catch (e) {
			controller.error(e);
			cleanup();
		}
	}
	cancel_error = "User cancelled the request";
	matchesPattern(url, patterns) {
		return patterns.some((pattern) => {
			if (isString(pattern)) return url.includes(pattern);
			if (pattern instanceof RegExp) return pattern.test(url);
			return false;
		});
	}
	shouldUseCORSProxy(url) {
		if (/^(ipc|asset):\/\/localhost\//i.test(url) || /^http:\/\/(ipc|asset)\.localhost\//i.test(url)) return false;
		const { include, exclude } = this._config;
		if (exclude.length > 0 && this.matchesPattern(url, exclude)) return false;
		if (include.length > 0) return this.matchesPattern(url, include);
		return /^https?:\/\//i.test(url);
	}
};
//#endregion
export { CORSFetch };
