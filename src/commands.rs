// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use crate::{
  request::{get_requester, ClientConfig, ContentConfig},
  Error, Http, Result,
};
use http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use serde::Serialize;
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tauri::{
  async_runtime::Mutex, command, Manager, ResourceId, ResourceTable, Runtime, State, Webview,
};
use tokio::sync::oneshot::{channel, Receiver, Sender};
use tracing::Level;

struct ReqwestResponse(reqwest::Response);
impl tauri::Resource for ReqwestResponse {}

type CancelableResponseResult = Result<reqwest::Response>;
type CancelableResponseFuture =
  Pin<Box<dyn Future<Output = CancelableResponseResult> + Send + Sync>>;

struct FetchRequest {
  fut: Mutex<CancelableResponseFuture>,
  abort_tx_rid: ResourceId,
  abort_rx_rid: ResourceId,
}
impl tauri::Resource for FetchRequest {}

struct AbortSender(Sender<()>);
impl tauri::Resource for AbortRecveiver {}

impl AbortSender {
  fn abort(self) {
    let _ = self.0.send(());
  }
}

struct AbortRecveiver(Receiver<()>);
impl tauri::Resource for AbortSender {}

trait AddRequest {
  fn add_request(&mut self, fut: CancelableResponseFuture) -> ResourceId;
}

impl AddRequest for ResourceTable {
  fn add_request(&mut self, fut: CancelableResponseFuture) -> ResourceId {
    let (tx, rx) = channel::<()>();
    let (tx, rx) = (AbortSender(tx), AbortRecveiver(rx));
    let req = FetchRequest {
      fut: Mutex::new(fut),
      abort_tx_rid: self.add(tx),
      abort_rx_rid: self.add(rx),
    };
    self.add(req)
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
  status: u16,
  status_text: String,
  headers: Vec<(String, String)>,
  url: String,
  rid: ResourceId,
}

#[command]
pub async fn fetch<R: Runtime>(
  webview: Webview<R>,
  state: State<'_, Http>,
  content_config: ContentConfig,
) -> crate::Result<ResourceId> {
  tracing::debug!(
    "Fetch config\n{}",
    serde_json::to_string_pretty(&content_config).unwrap()
  );

  let ContentConfig {
    client:
      ClientConfig {
        connect_timeout,
        user_agent,
        max_redirections: _,
        proxy: _,
        danger: _,
      },
    method,
    url,
    headers: headers_raw,
    data,
  } = &content_config;

  let scheme = url.scheme();
  let method = Method::from_bytes(method.as_bytes())?;

  let mut headers = HeaderMap::with_capacity(headers_raw.len());

  for (h, v) in headers_raw {
    let name = HeaderName::from_bytes(h.as_bytes()).map_err(|e| {
      tracing::warn!("Invalid header name from frontend: {}", h);
      e
    })?;
    let value = HeaderValue::from_bytes(v.as_bytes()).map_err(|e| {
      tracing::warn!("Invalid header value from frontend: {} = {}", h, v);
      e
    })?;

    headers.append(name, value);
  }

  match scheme {
    "http" | "https" => {
      let requester = get_requester(&state, &content_config.client);

      let mut request = requester.request(method.clone(), url.clone());

      if let Some(tmo) = connect_timeout {
        request = request.timeout(Duration::from_millis(tmo.clone()));
      }

      // POST and PUT requests should always have a 0 length content-length,
      // if there is no body. https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
      if data.is_none() && matches!(method, Method::POST | Method::PUT) {
        headers.append(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
      }

      if headers.contains_key(header::RANGE) {
        // https://fetch.spec.whatwg.org/#http-network-or-cache-fetch step 18
        // If httpRequest's header list contains `Range`, then append (`Accept-Encoding`, `identity`)
        headers.append(
          header::ACCEPT_ENCODING,
          HeaderValue::from_static("identity"),
        );
      }

      // Set User Agent
      if !headers.contains_key(header::USER_AGENT) {
        if let Some(ua) = user_agent {
          if let Ok(value) = HeaderValue::from_str(ua.as_str()) {
            headers.append(header::USER_AGENT, value);
          } else {
            tracing::warn!("Invalid User-Agent: {}", ua);
          }
        }
      }

      if let Some(data) = data {
        request = request.body(data.clone());
      }
      if tracing::enabled!(Level::DEBUG) {
        tracing::debug!(
        url = %url,
        send_headers = ?headers,
        ipc_headers = ?headers_raw,
        "Fetching URL"
        );
      }

      request = request.headers(headers);

      #[cfg(feature = "tracing")]
      tracing::trace!("{:?}", request);

      let fut = async move { request.send().await.map_err(Into::into) };

      let mut resources_table = webview.resources_table();
      let rid = resources_table.add_request(Box::pin(fut));

      Ok(rid)
    }
    "data" => {
      let data_url = data_url::DataUrl::process(url.as_str()).map_err(|_| Error::DataUrlError)?;
      let (body, _) = data_url
        .decode_to_vec()
        .map_err(|_| Error::DataUrlDecodeError)?;

      let response = http::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, data_url.mime_type().to_string())
        .body(reqwest::Body::from(body))?;

      #[cfg(feature = "tracing")]
      tracing::trace!("{:?}", response);

      let fut = async move { Ok(reqwest::Response::from(response)) };
      let mut resources_table = webview.resources_table();
      let rid = resources_table.add_request(Box::pin(fut));
      Ok(rid)
    }
    _ => Err(Error::SchemeNotSupport(scheme.to_string())),
  }
}

#[command]
pub fn fetch_cancel<R: Runtime>(webview: Webview<R>, rid: ResourceId) -> crate::Result<()> {
  let mut resources_table = webview.resources_table();
  let req = resources_table.get::<FetchRequest>(rid)?;
  let abort_tx = resources_table.take::<AbortSender>(req.abort_tx_rid)?;
  if let Some(abort_tx) = Arc::into_inner(abort_tx) {
    abort_tx.abort();
  }
  Ok(())
}

#[command]
pub async fn fetch_send<R: Runtime>(
  webview: Webview<R>,
  rid: ResourceId,
) -> crate::Result<FetchResponse> {
  let (req, abort_rx) = {
    let mut resources_table = webview.resources_table();
    let req = resources_table.get::<FetchRequest>(rid)?;
    let abort_rx = resources_table.take::<AbortRecveiver>(req.abort_rx_rid)?;
    (req, abort_rx)
  };

  let Some(abort_rx) = Arc::into_inner(abort_rx) else {
    return Err(Error::RequestCanceled);
  };

  let mut fut = req.fut.lock().await;

  let res = tokio::select! {
      res = fut.as_mut() => res?,
      _ = abort_rx.0 => {
          let mut resources_table = webview.resources_table();
          resources_table.close(rid)?;
          return Err(Error::RequestCanceled);
      }
  };

  #[cfg(feature = "tracing")]
  tracing::trace!("{:?}", res);

  let status = res.status();
  let url = res.url().to_string();
  let mut headers = Vec::new();
  for (key, val) in res.headers().iter() {
    headers.push((
      key.as_str().into(),
      String::from_utf8(val.as_bytes().to_vec())?,
    ));
  }

  let mut resources_table = webview.resources_table();
  let rid = resources_table.add(ReqwestResponse(res));

  Ok(FetchResponse {
    status: status.as_u16(),
    status_text: status.canonical_reason().unwrap_or_default().to_string(),
    headers,
    url,
    rid,
  })
}

#[command]
pub async fn fetch_read_body<R: Runtime>(
  webview: Webview<R>,
  rid: ResourceId,
) -> crate::Result<tauri::ipc::Response> {
  let res = {
    let resources_table = webview.resources_table();
    resources_table.get::<ReqwestResponse>(rid)?
  };

  // SAFETY: we can access the inner value mutably
  // because we are the only ones with a reference to it
  // and we don't want to use `Arc::into_inner` because we want to keep the value in the table
  // for potential future calls to `fetch_cancel_body`
  let res_ptr = Arc::as_ptr(&res) as *mut ReqwestResponse;
  let res = unsafe { &mut *res_ptr };
  let res = &mut res.0;

  let Some(chunk) = res.chunk().await? else {
    let mut resources_table = webview.resources_table();
    resources_table.close(rid)?;

    // return a response with a single byte to indicate that the body is empty
    return Ok(tauri::ipc::Response::new(vec![1]));
  };

  let mut chunk = chunk.to_vec();
  // append a 0 byte to indicate that the body is not empty
  chunk.push(0);

  Ok(tauri::ipc::Response::new(chunk))
}

#[command]
pub async fn fetch_cancel_body<R: Runtime>(
  webview: Webview<R>,
  rid: ResourceId,
) -> crate::Result<()> {
  let mut resources_table = webview.resources_table();
  resources_table.close(rid)?;
  Ok(())
}
