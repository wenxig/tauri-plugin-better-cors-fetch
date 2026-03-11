// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use crate::{
  Error, Http,
  headers::create_headers,
  request::{self, ContentConfig, get_requester}, spawner,
};
use http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Manager, ResourceId, ResourceTable, Runtime, State, Webview, command};
use tokio::sync::{Mutex, oneshot::Sender};
use tracing::Level;
#[warn(unused_imports)]
use tracing::warn;

struct FetchRequest {
  state: Mutex<FetchRequestState>,
}

struct FetchRequestState {
  response_rx: Option<spawner::ResponseReceiver>,
  abort_tx: Option<Sender<()>>,
  abort_rx: Option<spawner::AbortReceiver>,
}
impl tauri::Resource for FetchRequest {}

trait AddRequest {
  fn add_request(
    &mut self,
    response_rx: spawner::ResponseReceiver,
    abort_tx: Sender<()>,
    abort_rx: spawner::AbortReceiver,
  ) -> ResourceId;
}

impl AddRequest for ResourceTable {
  fn add_request(
    &mut self,
    response_rx: spawner::ResponseReceiver,
    abort_tx: Sender<()>,
    abort_rx: spawner::AbortReceiver,
  ) -> ResourceId {
    let req = FetchRequest {
      state: Mutex::new(FetchRequestState {
        response_rx: Some(response_rx),
        abort_tx: Some(abort_tx),
        abort_rx: Some(abort_rx),
      }),
    };

    self.add(req)
  }
}

#[derive(Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FetchResponse {
  status: u16,
  status_text: String,
  headers: Vec<(String, String)>,
  url: String,
  rid: ResourceId,
}

#[command]
pub fn prepare_requester<R: Runtime>(_: Webview<R>, state: State<'_, Http>, config: ContentConfig) {
  request::prepare_requester(&state, &config.client);
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

      let (response_rx, response_tx, abort_tx, abort_rx) = spawner::create_request_channels();
      spawner::spawn_request_sender(request, response_tx);

      let mut resources_table = webview.resources_table();
      let rid = resources_table.add_request(response_rx, abort_tx, abort_rx);

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

      let (response_rx, response_tx, abort_tx, abort_rx) = spawner::create_request_channels();
      spawner::spawn_static_response_sender(reqwest::Response::from(response), response_tx);
      let mut resources_table = webview.resources_table();
      let rid = resources_table.add_request(response_rx, abort_tx, abort_rx);
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

  let mut req = req.state.lock().await;

  if let Some(tx) = req.abort_tx.take() {
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

  let mut req = req.state.lock().await;

  let abort_rx = req.abort_rx.take().ok_or(Error::RequestCanceled)?;
  let response_rx = req.response_rx.take().ok_or(Error::RequestCanceled)?;

  let res = tokio::select! {
    res = response_rx => {
      match res {
        Ok(res) => res?,
        Err(_) => return Err(Error::RequestCanceled),
      }
    },
    _ = abort_rx => {
      let mut resources_table = webview.resources_table();
      resources_table.close(rid)?;
      return Err(Error::RequestCanceled);
    }
  };

  {
    let mut resources_table = webview.resources_table();
    resources_table.close(rid)?;
  }

  #[cfg(feature = "tracing")]
  tracing::trace!("{:?}", res);
  let status: StatusCode = res.status();
  let url: String = res.url().to_string();
  let headers_raw: &HeaderMap<HeaderValue> = res.headers();
  let mut headers: Vec<(String, String)> = Vec::with_capacity(headers_raw.len());

  // 预先估计总字符串大小，减少重新分配
  for (key, val) in headers_raw.into_iter() {
    let value_str = val.to_str().map_err(|_| Error::InvalidHeaderValue)?;

    // 只在必要时分配，可以考虑使用Cow<str>
    headers.push((key.as_str().into(), value_str.into()));
  }

  let mut resources_table = webview.resources_table();
  let rid = resources_table.add(spawner::spawn_body_streamer(res));

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
    resources_table.get::<spawner::StreamingResponse>(rid)?
  };

  let mut chunk_rx = res.chunk_rx.lock().await;

  let Some(chunk) = chunk_rx.recv().await else {
    let mut resources_table = webview.resources_table();
    resources_table.close(rid)?;

    return Ok(tauri::ipc::Response::new(vec![1]));
  };

  if chunk.len() == 1 && chunk[0] == 1 {
    let mut resources_table = webview.resources_table();
    resources_table.close(rid)?;
    return Ok(tauri::ipc::Response::new(chunk));
  }

  let mut chunk = chunk;
  // append a 0 byte to indicate that the body is not empty
  chunk.push(0);

  Ok(tauri::ipc::Response::new(chunk))
}

#[command]
pub async fn fetch_cancel_body<R: Runtime>(
  webview: Webview<R>,
  rid: ResourceId,
) -> crate::Result<()> {
  let response = {
    let resources_table = webview.resources_table();
    resources_table.get::<spawner::StreamingResponse>(rid)
  };

  if let Ok(response) = response {
    response.worker.abort();
  }

  let mut resources_table = webview.resources_table();
  resources_table.close(rid)?;
  Ok(())
}