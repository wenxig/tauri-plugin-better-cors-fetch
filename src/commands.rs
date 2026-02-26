// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use crate::{
  headers::create_headers,
  request::{self, get_requester, ContentConfig},
  Error, Http, Result,
};
use futures_util::StreamExt;
use http::{header, Method, StatusCode};
#[cfg(feature = "cookies")]
use reqwest::cookie::CookieStore;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{command, Manager, ResourceId, ResourceTable, Runtime, State, Webview};
use tokio::{
  sync::{
    mpsc,
    oneshot::{self, Sender},
    Mutex,
  },
  task::JoinHandle,
};
use tracing::Level;

const DEFAULT_BODY_CHUNK_CHANNEL_CAPACITY: usize = 32;
const LARGE_BODY_CHUNK_CHANNEL_CAPACITY: usize = 64;

type ResponseResult = Result<reqwest::Response>;
type ResponseReceiver = oneshot::Receiver<ResponseResult>;
type AbortReceiver = oneshot::Receiver<()>;

struct StreamingResponse {
  chunk_rx: Mutex<mpsc::Receiver<Vec<u8>>>,
  worker: JoinHandle<()>,
}
impl tauri::Resource for StreamingResponse {}

struct FetchRequest {
  state: Mutex<FetchRequestState>,
}

struct FetchRequestState {
  response_rx: Option<ResponseReceiver>,
  abort_tx: Option<Sender<()>>,
  abort_rx: Option<AbortReceiver>,
}
impl tauri::Resource for FetchRequest {}

trait AddRequest {
  fn add_request(
    &mut self,
    response_rx: ResponseReceiver,
    abort_tx: Sender<()>,
    abort_rx: AbortReceiver,
  ) -> ResourceId;
}

impl AddRequest for ResourceTable {
  fn add_request(
    &mut self,
    response_rx: ResponseReceiver,
    abort_tx: Sender<()>,
    abort_rx: AbortReceiver,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
  status: u16,
  status_text: String,
  headers: Vec<(String, String)>,
  url: String,
  rid: ResourceId,
}

#[derive(Debug, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetCookieConfig {
  #[ts(type = "string")]
  url: url::Url,
  content: String,
}

fn create_request_channels() -> (
  ResponseReceiver,
  Sender<ResponseResult>,
  Sender<()>,
  AbortReceiver,
) {
  let (response_tx, response_rx) = oneshot::channel();
  let (abort_tx, abort_rx) = oneshot::channel();
  (response_rx, response_tx, abort_tx, abort_rx)
}

fn spawn_request_sender(request: reqwest::RequestBuilder, response_tx: Sender<ResponseResult>) {
  tauri::async_runtime::spawn(async move {
    let _ = response_tx.send(request.send().await.map_err(Into::into));
  });
}

fn spawn_static_response_sender(response: reqwest::Response, response_tx: Sender<ResponseResult>) {
  tauri::async_runtime::spawn(async move {
    let _ = response_tx.send(Ok(response));
  });
}

fn spawn_body_streamer(response: reqwest::Response) -> StreamingResponse {
  let capacity = response
    .content_length()
    .map(|len| {
      if len > 10 * 1024 * 1024 {
        // > 10MB
        LARGE_BODY_CHUNK_CHANNEL_CAPACITY
      } else {
        DEFAULT_BODY_CHUNK_CHANNEL_CAPACITY
      }
    })
    .unwrap_or(DEFAULT_BODY_CHUNK_CHANNEL_CAPACITY);

  let (chunk_tx, chunk_rx) = mpsc::channel::<Vec<u8>>(capacity);

  let worker = tokio::spawn(async move {
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
      let chunk = match item {
        Ok(chunk) => chunk.to_vec(),
        Err(_) => {
          let _ = chunk_tx.send(vec![1]).await;
          return;
        }
      };

      if chunk_tx.send(chunk).await.is_err() {
        return;
      }
    }

    let _ = chunk_tx.send(vec![1]).await;
  });

  StreamingResponse {
    chunk_rx: Mutex::new(chunk_rx),
    worker,
  }
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

      let (response_rx, response_tx, abort_tx, abort_rx) = create_request_channels();
      spawn_request_sender(request, response_tx);

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

      let (response_rx, response_tx, abort_tx, abort_rx) = create_request_channels();
      spawn_static_response_sender(reqwest::Response::from(response), response_tx);
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

  let status = res.status();
  let url = res.url().to_string();
  let headers_len = res.headers().len();
  let mut headers = Vec::with_capacity(headers_len);

  // 预先估计总字符串大小，减少重新分配
  for (key, val) in res.headers().iter() {
    let value_str = val.to_str().map_err(|_| Error::InvalidHeaderValue)?;

    // 只在必要时分配，可以考虑使用Cow<str>
    headers.push((key.as_str().into(), value_str.into()));
  }

  let mut resources_table = webview.resources_table();
  let rid = resources_table.add(spawn_body_streamer(res));

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
    resources_table.get::<StreamingResponse>(rid)?
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
    resources_table.get::<StreamingResponse>(rid)
  };

  if let Ok(response) = response {
    response.worker.abort();
  }

  let mut resources_table = webview.resources_table();
  resources_table.close(rid)?;
  Ok(())
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
