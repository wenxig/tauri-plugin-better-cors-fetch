// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use crate::{
  headers::create_headers,
  request::{get_requester, ContentConfig},
  Error, Http, Result,
};
use http::{header, Method, StatusCode};
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
  abort_tx: Mutex<Option<Sender<()>>>,
  abort_rx: Mutex<Option<Receiver<()>>>,
}
impl tauri::Resource for FetchRequest {}

trait AddRequest {
  fn add_request(&mut self, fut: CancelableResponseFuture) -> ResourceId;
}

impl AddRequest for ResourceTable {
  fn add_request(&mut self, fut: CancelableResponseFuture) -> ResourceId {
    let (tx, rx) = channel::<()>();

    let req = FetchRequest {
      fut: Mutex::new(fut),
      abort_tx: Mutex::new(Some(tx)), // ✅ 直接存储
      abort_rx: Mutex::new(Some(rx)), // ✅ 直接存储
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
  if tracing::enabled!(Level::DEBUG) {
    tracing::debug!(
      "Fetch config\n{}",
      serde_json::to_string_pretty(&content_config).unwrap()
    );
  }

  let scheme = content_config.url.scheme();
  match scheme {
    "http" | "https" => {
      let requester = get_requester(&state, &content_config.client);

      let data = content_config.data;

      let method = Method::from_bytes(content_config.method.as_bytes())?;
      let mut request = requester.request(method.clone(), content_config.url);

      if let Some(tmo) = content_config.client.connect_timeout {
        request = request.timeout(Duration::from_millis(tmo));
      }

      let headers = create_headers(
        &content_config.headers,
        method,
        content_config.client.user_agent,
        &data,
      )?;

      if let Some(data) = data {
        request = request.body(data.clone());
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
      let data_url =
        data_url::DataUrl::process(content_config.url.as_str()).map_err(|_| Error::DataUrlError)?;
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
pub async fn fetch_cancel<R: Runtime>(webview: Webview<R>, rid: ResourceId) -> crate::Result<()> {
  let req = {
    let resources_table = webview.resources_table();
    resources_table.get::<FetchRequest>(rid)?
  };

  let mut abort_tx_guard = req.abort_tx.lock().await;
  if let Some(tx) = abort_tx_guard.take() {
    let _ = tx.send(());
  }

  Ok(())
}

#[command]
pub async fn fetch_send<R: Runtime>(
  webview: Webview<R>,
  rid: ResourceId,
) -> crate::Result<FetchResponse> {
  let req = {
    let resources_table = webview.resources_table();
    resources_table.get::<FetchRequest>(rid)?
  };

  let abort_rx = {
    let mut rx_guard = req.abort_rx.lock().await;
    rx_guard.take().ok_or(Error::RequestCanceled)?
  };

  let mut fut = req.fut.lock().await;

  let res = tokio::select! {
    res = fut.as_mut() => res?,
    _ = abort_rx => {
      let mut resources_table = webview.resources_table();
      resources_table.close(rid)?;
      return Err(Error::RequestCanceled);
    }
  };

  #[cfg(feature = "tracing")]
  tracing::trace!("{:?}", res);

  let status = res.status();
  let url = res.url().to_string();
  // 预分配容量,避免 Vec 在增长时重新分配内存
  let mut headers = Vec::with_capacity(res.headers().len());
  for (key, val) in res.headers().iter() {
    // 使用 to_str() 直接转换,避免创建中间的 Vec<u8>
    let value_str = val
      .to_str()
      .map_err(|_| Error::InvalidHeaderValue)?
      .to_string();

    headers.push((key.as_str().to_string(), value_str));
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
