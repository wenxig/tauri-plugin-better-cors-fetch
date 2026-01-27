//#region node_modules/.pnpm/@tauri-apps+api@2.9.1/node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
function __classPrivateFieldGet(receiver, state, kind, f) {
	if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
	if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
	return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
	if (kind === "m") throw new TypeError("Private method is not writable");
	if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
	if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
	return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

//#endregion
//#region node_modules/.pnpm/@tauri-apps+api@2.9.1/node_modules/@tauri-apps/api/core.js
var _Channel_onmessage, _Channel_nextMessageIndex, _Channel_pendingMessages, _Channel_messageEndIndex, _Resource_rid;
/**
* Invoke your custom commands.
*
* This package is also accessible with `window.__TAURI__.core` when [`app.withGlobalTauri`](https://v2.tauri.app/reference/config/#withglobaltauri) in `tauri.conf.json` is set to `true`.
* @module
*/
/**
* A key to be used to implement a special function
* on your types that define how your type should be serialized
* when passing across the IPC.
* @example
* Given a type in Rust that looks like this
* ```rs
* #[derive(serde::Serialize, serde::Deserialize)
* enum UserId {
*   String(String),
*   Number(u32),
* }
* ```
* `UserId::String("id")` would be serialized into `{ String: "id" }`
* and so we need to pass the same structure back to Rust
* ```ts
* import { SERIALIZE_TO_IPC_FN } from "@tauri-apps/api/core"
*
* class UserIdString {
*   id
*   constructor(id) {
*     this.id = id
*   }
*
*   [SERIALIZE_TO_IPC_FN]() {
*     return { String: this.id }
*   }
* }
*
* class UserIdNumber {
*   id
*   constructor(id) {
*     this.id = id
*   }
*
*   [SERIALIZE_TO_IPC_FN]() {
*     return { Number: this.id }
*   }
* }
*
* type UserId = UserIdString | UserIdNumber
* ```
*
*/
const SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
/**
* Stores the callback in a known location, and returns an identifier that can be passed to the backend.
* The backend uses the identifier to `eval()` the callback.
*
* @return An unique identifier associated with the callback function.
*
* @since 1.0.0
*/
function transformCallback(callback, once = false) {
	return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}
var Channel = class {
	constructor(onmessage) {
		_Channel_onmessage.set(this, void 0);
		_Channel_nextMessageIndex.set(this, 0);
		_Channel_pendingMessages.set(this, []);
		_Channel_messageEndIndex.set(this, void 0);
		__classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {}), "f");
		this.id = transformCallback((rawMessage) => {
			const index = rawMessage.index;
			if ("end" in rawMessage) {
				if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) this.cleanupCallback();
				else __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
				return;
			}
			const message = rawMessage.message;
			if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
				__classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
				__classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
				while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
					const message = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
					__classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
					delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
					__classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
				}
				if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) this.cleanupCallback();
			} else __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
		});
	}
	cleanupCallback() {
		window.__TAURI_INTERNALS__.unregisterCallback(this.id);
	}
	set onmessage(handler) {
		__classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
	}
	get onmessage() {
		return __classPrivateFieldGet(this, _Channel_onmessage, "f");
	}
	[(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
		return `__CHANNEL__:${this.id}`;
	}
	toJSON() {
		return this[SERIALIZE_TO_IPC_FN]();
	}
};
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
_Resource_rid = /* @__PURE__ */ new WeakMap();

//#endregion
//#region node_modules/.pnpm/es-toolkit@1.44.0/node_modules/es-toolkit/dist/predicate/isPlainObject.mjs
function isPlainObject(value) {
	if (!value || typeof value !== "object") return false;
	const proto = Object.getPrototypeOf(value);
	if (!(proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null)) return false;
	return Object.prototype.toString.call(value) === "[object Object]";
}

//#endregion
//#region node_modules/.pnpm/es-toolkit@1.44.0/node_modules/es-toolkit/dist/_internal/isUnsafeProperty.mjs
function isUnsafeProperty(key) {
	return key === "__proto__";
}

//#endregion
//#region node_modules/.pnpm/es-toolkit@1.44.0/node_modules/es-toolkit/dist/object/merge.mjs
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
//#region node_modules/.pnpm/es-toolkit@1.44.0/node_modules/es-toolkit/dist/predicate/isString.mjs
function isString(value) {
	return typeof value === "string";
}

//#endregion
//#region src-web/index.ts
var CORSFetch = class CORSFetch {
	static init() {
		if (!window.CORSFetch) window.CORSFetch = new CORSFetch();
		return window.CORSFetch;
	}
	constructor() {
		window.fetchNative = window.fetch.bind(window);
		window.fetch = this.fetchCORS.bind(this);
		window.fetchCORS = (input, init) => this.fetchCORS(input, init, true);
	}
	_config = {
		include: [],
		exclude: [],
		request: {
			proxy: void 0,
			connectTimeout: void 0,
			maxRedirections: void 0,
			userAgent: navigator.userAgent,
			danger: {
				acceptInvalidCerts: false,
				acceptInvalidHostnames: false
			}
		}
	};
	config(newConfig) {
		this._config = merge(this._config, newConfig);
	}
	async fetchCORS(input, init, force = false) {
		const urlStr = input instanceof Request ? input.url : String(input);
		console.debug(`[fetchCORS] begin -> ${urlStr}`, input, init);
		if (!force && !this.shouldUseCORSProxy(urlStr)) {
			console.debug(`[fetchCORS] ${urlStr} browser`);
			return window.fetchNative(input, init);
		}
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
			console.debug(`[fetchCORS] ${urlStr} cleanup`);
		};
		const onAbort = () => cleanup();
		signal?.addEventListener("abort", onAbort);
		const { maxRedirections = this._config.request.maxRedirections, connectTimeout = this._config.request.connectTimeout, proxy = this._config.request.proxy, danger = this._config.request.danger, userAgent = this._config.request.userAgent, ...nativeInit } = init || {};
		const req = input instanceof Request ? input : new Request(input, nativeInit);
		const buffer = await req.arrayBuffer();
		if (signal?.aborted) throw this.cancel_error;
		if (!req.headers.has("Content-Type")) req.headers.set("Content-Type", "application/json");
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
				userAgent
			};
			rid = await invoke("plugin:cors-fetch|fetch", { clientConfig });
			console.debug(`[fetchCORS] ${urlStr}`, clientConfig);
			if (signal?.aborted) throw this.cancel_error;
			const { status, statusText, url, headers: responseHeaders, rid: _rid } = await invoke("plugin:cors-fetch|fetch_send", { rid });
			responseRid = _rid;
			if (signal?.aborted) throw this.cancel_error;
			const readChunk = async (controller) => {
				if (signal?.aborted) {
					controller.error(this.cancel_error);
					return;
				}
				try {
					const data = await invoke("plugin:cors-fetch|fetch_read_body", { rid: responseRid });
					const dataUint8 = new Uint8Array(data);
					const lastByte = dataUint8[dataUint8.byteLength - 1];
					const actualData = dataUint8.slice(0, dataUint8.byteLength - 1);
					if (lastByte === 1) {
						controller.close();
						return;
					}
					controller.enqueue(actualData);
				} catch (e) {
					controller.error(e);
					cleanup();
				}
			};
			const body = [
				101,
				103,
				204,
				205,
				304
			].includes(status) ? null : new ReadableStream({
				pull: readChunk,
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