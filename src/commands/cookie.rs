use crate::Http;
#[cfg(feature = "cookies")]
use reqwest::cookie::CookieStore;
use serde::{Deserialize, Serialize};
use tauri::{Runtime, State, Webview, command};
#[warn(unused_imports)]
use tracing::warn;

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetCookieConfig {
  #[ts(type = "string")]
  url: url::Url,
  content: String,
}

#[command]
pub async fn set_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, Http>,
  config: SetCookieConfig,
) -> crate::Result<()> {
  #[cfg(feature = "cookies")]
  {
    let mut header_value = reqwest::header::HeaderValue::from_str(&config.content)?;
    header_value.set_sensitive(true);
    let mut header_values = std::iter::once(&header_value);
    state
      .cookies_jar
      .set_cookies(&mut header_values, &config.url);
  }

  #[cfg(not(feature = "cookies"))]
  {
    let _ = (&state, &config);
  }
  Ok(())
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GetCookieConfig {
  #[ts(type = "string")]
  url: url::Url,
  name: String,
}

#[command]
pub async fn get_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, Http>,
  config: GetCookieConfig,
) -> crate::Result<Option<String>> {
  #[cfg(feature = "cookies")]
  {
    return Ok(
      state
        .cookies_jar
        .get_cookie_value(&config.url, &config.name),
    );
  }

  #[cfg(not(feature = "cookies"))]
  {
    use tracing::warn;

    warn!("fail to get cookies because feature not enabled");
    Ok(())
  }
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GetAllDomainCookiesConfig {
  #[ts(type = "string")]
  url: url::Url,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CookieEntry {
  domain: String,
  name: String,
  value: String,
}

#[command]
pub async fn get_all_domain_cookies<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, Http>,
  config: GetAllDomainCookiesConfig,
) -> crate::Result<Vec<CookieEntry>> {
  #[cfg(feature = "cookies")]
  {
    let cookies = state.cookies_jar.get_all_domain_cookie_values(&config.url);
    return Ok(
      cookies
        .into_iter()
        .map(|(domain, name, value)| CookieEntry {
          domain,
          name,
          value,
        })
        .collect(),
    );
  }

  #[cfg(not(feature = "cookies"))]
  {
    use tracing::warn;

    warn!("fail to get all domain cookies because feature not enabled");
    Ok(Vec::new())
  }
}

#[command]
pub async fn get_all_cookies<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, Http>,
) -> crate::Result<Vec<CookieEntry>> {
  #[cfg(feature = "cookies")]
  {
    let cookies = state.cookies_jar.get_all_cookie_values();
    return Ok(
      cookies
        .into_iter()
        .map(|(domain, name, value)| CookieEntry {
          domain,
          name,
          value,
        })
        .collect(),
    );
  }

  #[cfg(not(feature = "cookies"))]
  {
    use tracing::warn;

    warn!("fail to get all domain cookies because feature not enabled");
    Ok(Vec::new())
  }
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteCookieConfig {
  #[ts(type = "string")]
  url: url::Url,
  path: Option<String>,
  name: String,
}

#[command]
pub async fn delete_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, Http>,
  config: DeleteCookieConfig,
) -> crate::Result<bool> {
  #[cfg(feature = "cookies")]
  {
    return Ok(state.cookies_jar.delete_cookie(
      &config.url,
      &config.path.unwrap_or("/".to_string()),
      &config.name,
    )?);
  }

  #[cfg(not(feature = "cookies"))]
  {
    use tracing::warn;

    warn!("fail to delete cookies because feature not enabled");
    Ok(true)
  }
}

#[command]
pub async fn clear_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, Http>,
) -> crate::Result<()> {
  #[cfg(feature = "cookies")]
  {
    return Ok(state.cookies_jar.clear_cookie()?);
  }

  #[cfg(not(feature = "cookies"))]
  {
    use tracing::warn;

    warn!("fail to clear cookies because feature not enabled");
    Ok(())
  }
}
