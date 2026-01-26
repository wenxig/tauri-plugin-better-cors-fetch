//#region src-web/index.ts
var CORSFetch = class CORSFetch {
	static init() {
		if (typeof window !== "undefined" && !window.CORSFetch) window.CORSFetch = new CORSFetch();
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
		this._config = this.deepMerge(this._config, newConfig);
	}
	async fetchCORS(input, init, force = false) {
		const urlStr = input instanceof Request ? input.url : String(input);
		if (!force && !this.shouldUseCORSProxy(urlStr)) return window.fetchNative(input, init);
		const signal = init?.signal;
		if (signal?.aborted) throw this.cancel_error;
		let rid = null;
		let responseRid = null;
		let isFinished = false;
		const cleanup = () => {
			if (isFinished) return;
			isFinished = true;
			signal?.removeEventListener("abort", onAbort);
			if (responseRid !== null) this.invoke("plugin:cors-fetch|fetch_cancel_body", { rid: responseRid }).catch(() => {});
			if (rid !== null) this.invoke("plugin:cors-fetch|fetch_cancel", { rid }).catch(() => {});
		};
		const onAbort = () => cleanup();
		signal?.addEventListener("abort", onAbort);
		const { maxRedirections = this._config.request.maxRedirections, connectTimeout = this._config.request.connectTimeout, proxy = this._config.request.proxy, danger = this._config.request.danger, userAgent = this._config.request.userAgent, ...nativeInit } = init || {};
		const req = new Request(input, nativeInit);
		const buffer = await req.arrayBuffer();
		if (signal?.aborted) throw this.cancel_error;
		try {
			rid = await this.invoke("plugin:cors-fetch|fetch", { clientConfig: {
				method: req.method,
				url: urlStr,
				headers: Object.entries(req.headers),
				data: buffer.byteLength ? Array.from(new Uint8Array(buffer)) : null,
				maxRedirections,
				connectTimeout,
				proxy,
				danger,
				userAgent
			} });
			if (signal?.aborted) throw this.cancel_error;
			const { status, statusText, url, headers: responseHeaders, rid: _rid } = await this.invoke("plugin:cors-fetch|fetch_send", { rid });
			responseRid = _rid;
			if (signal?.aborted) throw this.cancel_error;
			const readChunk = async (controller) => {
				if (signal?.aborted) {
					controller.error(this.cancel_error);
					return;
				}
				try {
					const data = await this.invoke("plugin:cors-fetch|fetch_read_body", { rid: responseRid });
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
	invoke(method, args) {
		return window.__TAURI_INTERNALS__.invoke(method, args);
	}
	matchesPattern(url, patterns) {
		if (!patterns || patterns.length === 0) return false;
		return patterns.some((pattern) => {
			if (typeof pattern === "string") return url.includes(pattern);
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
	deepMerge(target, source) {
		const isObject = (item) => {
			return !!item && typeof item === "object" && !Array.isArray(item);
		};
		const output = { ...target };
		if (isObject(target) && isObject(source)) Object.keys(source).forEach((key) => {
			if (isObject(source[key])) if (!(key in target)) Object.assign(output, { [key]: source[key] });
			else output[key] = this.deepMerge(target[key], source[key]);
			else Object.assign(output, { [key]: source[key] });
		});
		return output;
	}
};

//#endregion
export { CORSFetch };