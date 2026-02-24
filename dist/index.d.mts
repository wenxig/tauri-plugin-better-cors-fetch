//#region src-web/types/DangerousSettings.d.ts
type DangerousSettings = {
  acceptInvalidCerts: boolean;
  acceptInvalidHostnames: boolean;
};
//#endregion
//#region src-web/types/BasicAuth.d.ts
type BasicAuth = {
  username: string;
  password: string;
};
//#endregion
//#region src-web/types/ProxyConfig.d.ts
type ProxyConfig = {
  url: string;
  basicAuth: BasicAuth | null;
  noProxy: string | null;
};
//#endregion
//#region src-web/types/UrlOrConfig.d.ts
type UrlOrConfig = string | ProxyConfig;
//#endregion
//#region src-web/types/Proxy.d.ts
type Proxy = {
  all: UrlOrConfig | null;
  http: UrlOrConfig | null;
  https: UrlOrConfig | null;
};
//#endregion
//#region src-web/types/ClientConfig.d.ts
type ClientConfig = {
  connectTimeout: number | null;
  maxRedirections: number | null;
  proxy: Proxy | null;
  danger: DangerousSettings | null;
  userAgent: string | null;
};
//#endregion
//#region src-web/index.d.ts
declare global {
  interface Window {
    CORSFetch?: CORSFetch;
    fetchNative: typeof fetch;
    fetchCORS: (input: Parameters<typeof fetch>[0], init: CORSFetchInit) => ReturnType<CORSFetch["fetch"]>;
    fetch: CORSFetch["fetch"];
  }
}
interface CORSFetchConfig {
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
  request: ClientConfig;
}
type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };
type CORSFetchInit = RequestInit & Partial<CORSFetchConfig["request"]>;
declare class CORSFetch {
  static init(config?: DeepPartial<CORSFetchConfig>, inject?: boolean): CORSFetch;
  static setCookie(url: string | URL, content: string): Promise<void>;
  protected constructor(inject?: boolean, config?: DeepPartial<CORSFetchConfig>);
  private _streamConfig;
  private _config;
  config(newConfig: DeepPartial<CORSFetchConfig>): Promise<void>;
  private combineChunks;
  fetch(input: Parameters<typeof fetch>[0], init?: CORSFetchInit, force?: boolean): Promise<Response>;
  private readStream;
  private cancel_error;
  private matchesPattern;
  private shouldUseCORSProxy;
}
//#endregion
export { CORSFetch, CORSFetchConfig, CORSFetchInit };