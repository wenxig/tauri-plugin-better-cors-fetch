//#region src-web/index.d.ts
declare global {
  interface Window {
    CORSFetch?: CORSFetch;
    fetchNative: typeof fetch;
    fetchCORS: (input: Parameters<typeof fetch>[0], init: CORSFetchInit) => ReturnType<CORSFetch['fetchCORS']>;
    fetch: CORSFetch['fetchCORS'];
  }
}
interface CORSFetchConfig {
  include: (string | RegExp)[];
  exclude: (string | RegExp)[];
  request: {
    proxy?: Record<string, string>;
    connectTimeout?: number;
    maxRedirections?: number;
    userAgent?: string;
    danger?: {
      acceptInvalidCerts: boolean;
      acceptInvalidHostnames: boolean;
    };
  };
}
type CORSFetchInit = RequestInit & Partial<CORSFetchConfig['request']>;
declare class CORSFetch {
  static init(): CORSFetch;
  protected constructor();
  private _config;
  config(newConfig: Partial<CORSFetchConfig>): void;
  fetchCORS(input: Parameters<typeof fetch>[0], init?: CORSFetchInit, force?: boolean): Promise<Response>;
  private cancel_error;
  private matchesPattern;
  private shouldUseCORSProxy;
}
//#endregion
export { CORSFetch, CORSFetchConfig, CORSFetchInit };