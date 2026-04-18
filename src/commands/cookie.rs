use crate::{GlobalState, InstanceKey};
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
  #[ts(type = "string")]
  instance_key: InstanceKey,
}

#[command]
pub async fn set_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, GlobalState>,
  config: SetCookieConfig,
) -> crate::Result<()> {
  let mut header_value = reqwest::header::HeaderValue::from_str(&config.content)?;
  header_value.set_sensitive(true);
  let mut header_values = std::iter::once(&header_value);
  state
    .cookies_jar
    .get(&config.instance_key)
    .expect("failed to get cookies jar for instance key")
    .set_cookies(&mut header_values, &config.url);
  Ok(())
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GetCookieConfig {
  #[ts(type = "string")]
  url: url::Url,
  name: String,
  #[ts(type = "string")]
  instance_key: InstanceKey,
}

#[command]
pub async fn get_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, GlobalState>,
  config: GetCookieConfig,
) -> crate::Result<Option<String>> {
  Ok(
    state
      .cookies_jar
      .get(&config.instance_key)
      .expect("failed to get cookies jar for instance key")
      .get_cookie_value(&config.url, &config.name),
  )
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GetAllDomainCookiesConfig {
  #[ts(type = "string")]
  url: url::Url,
  #[ts(type = "string")]
  instance_key: InstanceKey,
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
  state: State<'_, GlobalState>,
  config: GetAllDomainCookiesConfig,
) -> crate::Result<Vec<CookieEntry>> {
  let cookies = state
    .cookies_jar
    .get(&config.instance_key)
    .expect("failed to get cookies jar for instance key")
    .get_all_domain_cookie_values(&config.url);
  Ok(
    cookies
      .into_iter()
      .map(|(domain, name, value)| CookieEntry {
        domain,
        name,
        value,
      })
      .collect(),
  )
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GetAllCookiesConfig {
  #[ts(type = "string")]
  instance_key: String,
}

#[command]
pub async fn get_all_cookies<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, GlobalState>,
  config: GetAllCookiesConfig,
) -> crate::Result<Vec<CookieEntry>> {
  let cookies = state
    .cookies_jar
    .get(&config.instance_key)
    .expect("failed to get cookies jar for instance key")
    .get_all_cookie_values();
  Ok(
    cookies
      .into_iter()
      .map(|(domain, name, value)| CookieEntry {
        domain,
        name,
        value,
      })
      .collect(),
  )
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteCookieConfig {
  #[ts(type = "string")]
  url: url::Url,
  path: Option<String>,
  name: String,
  #[ts(type = "string")]
  instance_key: String,
}

#[command]
pub async fn delete_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, GlobalState>,
  config: DeleteCookieConfig,
) -> crate::Result<bool> {
  Ok(
    state
      .cookies_jar
      .get(&config.instance_key)
      .expect("failed to get cookies jar for instance key")
      .delete_cookie(
        &config.url,
        &config.path.unwrap_or("/".to_string()),
        &config.name,
      )?,
  )
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClearCookiesConfig {
  #[ts(type = "string")]
  instance_key: String,
}

#[command]
pub async fn clear_cookie<R: Runtime>(
  _webview: Webview<R>,
  state: State<'_, GlobalState>,
  config: ClearCookiesConfig,
) -> crate::Result<()> {
  Ok(
    state
      .cookies_jar
      .get(&config.instance_key)
      .expect("failed to get cookies jar for instance key")
      .clear_cookie()?,
  )
}
