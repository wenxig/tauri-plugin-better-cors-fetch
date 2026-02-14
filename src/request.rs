use std::sync::Arc;

use reqwest::{redirect::Policy, Client, NoProxy};
use serde::{Deserialize, Serialize};

use crate::{Http, Result};

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DangerousSettings {
  pub(crate) accept_invalid_certs: bool,
  pub(crate) accept_invalid_hostnames: bool,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ContentConfig {
  pub(crate) method: String,
  #[ts(type = "string")]
  pub(crate) url: url::Url,
  pub(crate) headers: Vec<(String, String)>,
  pub(crate) data: Option<Vec<u8>>,
  pub(crate) client: ClientConfig,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClientConfig {
  pub(crate) connect_timeout: Option<u64>,
  pub(crate) max_redirections: Option<usize>,
  pub(crate) proxy: Option<Proxy>,
  pub(crate) danger: Option<DangerousSettings>,
  pub(crate) user_agent: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Proxy {
  pub(crate) all: Option<UrlOrConfig>,
  pub(crate) http: Option<UrlOrConfig>,
  pub(crate) https: Option<UrlOrConfig>,
}

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
struct ProxyHashKey {
  all: Option<String>,
  http: Option<String>,
  https: Option<String>,
}

impl ProxyHashKey {
  fn from_proxy(proxy: &Proxy) -> Self {
    let url_or_config_to_string = |uoc: &UrlOrConfig| -> String {
      match uoc {
        UrlOrConfig::Url(url) => url.clone(),
        UrlOrConfig::Config(cfg) => {
          format!("{}|{:?}|{:?}", cfg.url, cfg.basic_auth, cfg.no_proxy)
        }
      }
    };

    ProxyHashKey {
      all: proxy.all.as_ref().map(url_or_config_to_string),
      http: proxy.http.as_ref().map(url_or_config_to_string),
      https: proxy.https.as_ref().map(url_or_config_to_string),
    }
  }
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[serde(untagged)]
#[ts(export)]
pub enum UrlOrConfig {
  Url(String),
  Config(ProxyConfig),
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProxyConfig {
  pub(crate) url: String,
  pub(crate) basic_auth: Option<BasicAuth>,
  pub(crate) no_proxy: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct BasicAuth {
  pub(crate) username: String,
  pub(crate) password: String,
}

#[derive(Hash, Eq, PartialEq, Clone, Debug)]
pub(crate) struct ClientCacheKey {
  accept_invalid_certs: bool,
  accept_invalid_hostnames: bool,
  proxy_key: Option<ProxyHashKey>,
  max_redirections: Option<usize>,
}

impl ClientCacheKey {
  fn from_config(config: &ClientConfig) -> Self {
    let (accept_invalid_certs, accept_invalid_hostnames) = if let Some(danger) = &config.danger {
      (danger.accept_invalid_certs, danger.accept_invalid_hostnames)
    } else {
      (false, false)
    };

    let proxy_key = config.proxy.as_ref().map(ProxyHashKey::from_proxy);

    ClientCacheKey {
      accept_invalid_certs,
      accept_invalid_hostnames,
      proxy_key,
      max_redirections: config.max_redirections,
    }
  }
}

fn build_requester(state: &Http, config: &ClientConfig) -> Result<Client> {
  let mut builder = reqwest::ClientBuilder::new();

  if let Some(danger_config) = &config.danger {
    builder = builder
      .danger_accept_invalid_certs(danger_config.accept_invalid_certs)
      .danger_accept_invalid_hostnames(danger_config.accept_invalid_hostnames)
  }

  if let Some(max_redirections) = config.max_redirections {
    builder = builder.redirect(if max_redirections == 0 {
      Policy::none()
    } else {
      Policy::limited(max_redirections)
    });
  }

  if let Some(proxy_config) = &config.proxy {
    builder = attach_proxy(proxy_config, builder)?;
  }

  #[cfg(feature = "cookies")]
  {
    builder = builder.cookie_provider(state.cookies_jar.clone());
  }
  Ok(builder.build()?)
}

#[inline]
pub fn get_requester(state: &Http, config: &ClientConfig) -> Arc<Client> {
  let cache_key = ClientCacheKey::from_config(config);

  state
    .pool
    .entry(cache_key)
    .or_insert_with(|| {
      Arc::new(build_requester(state, config).expect("Failed to build HTTP client"))
    })
    .clone()
}

#[inline]
pub fn prepare_requester(state: &Http, config: &ClientConfig) -> () {
  let cache_key = ClientCacheKey::from_config(config);
  if !state.pool.contains_key(&cache_key)  {
    let requester = build_requester(state, config);
    match requester {
      Ok(requester) => {
        state.pool.insert(cache_key, Arc::new(requester));
      }
      Err(_) => (),
    }
  }
}

#[inline]
fn proxy_creator(
  url_or_config: &UrlOrConfig,
  proxy_fn: fn(String) -> reqwest::Result<reqwest::Proxy>,
) -> reqwest::Result<reqwest::Proxy> {
  match url_or_config {
    UrlOrConfig::Url(url) => Ok(proxy_fn(url.clone())?),
    UrlOrConfig::Config(ProxyConfig {
      url,
      basic_auth,
      no_proxy,
    }) => {
      let mut proxy = proxy_fn(url.clone())?;
      if let Some(basic_auth) = basic_auth {
        proxy = proxy.basic_auth(&basic_auth.username, &basic_auth.password);
      }
      if let Some(no_proxy) = no_proxy {
        tracing::warn!("request to {url} with no proxy!");
        proxy = proxy.no_proxy(NoProxy::from_string(&no_proxy));
      }
      Ok(proxy)
    }
  }
}

#[inline]
fn attach_proxy(
  proxy: &Proxy,
  mut builder: reqwest::ClientBuilder,
) -> crate::Result<reqwest::ClientBuilder> {
  let Proxy { all, http, https } = proxy;

  if let Some(all) = all {
    let proxy = proxy_creator(all, reqwest::Proxy::all)?;
    builder = builder.proxy(proxy);
  }

  if let Some(http) = http {
    let proxy = proxy_creator(http, reqwest::Proxy::http)?;
    builder = builder.proxy(proxy);
  }

  if let Some(https) = https {
    let proxy = proxy_creator(https, reqwest::Proxy::https)?;
    builder = builder.proxy(proxy);
  }

  Ok(builder)
}
