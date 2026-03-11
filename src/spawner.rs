use futures_util::StreamExt;
use tokio::{
  sync::{
    Mutex, mpsc,
    oneshot::{self, Sender},
  },
  task::JoinHandle,
};

use crate::Result;

const DEFAULT_BODY_CHUNK_CHANNEL_CAPACITY: usize = 32;
const LARGE_BODY_CHUNK_CHANNEL_CAPACITY: usize = 64;

pub type ResponseResult = Result<reqwest::Response>;
pub type ResponseReceiver = oneshot::Receiver<ResponseResult>;
pub type AbortReceiver = oneshot::Receiver<()>;

pub struct StreamingResponse {
  pub chunk_rx: Mutex<mpsc::Receiver<Vec<u8>>>,
  pub worker: JoinHandle<()>,
}
impl tauri::Resource for StreamingResponse {}

#[inline]
pub fn create_request_channels() -> (
  ResponseReceiver,
  Sender<ResponseResult>,
  Sender<()>,
  AbortReceiver,
) {
  let (response_tx, response_rx) = oneshot::channel();
  let (abort_tx, abort_rx) = oneshot::channel();
  (response_rx, response_tx, abort_tx, abort_rx)
}

#[inline]
pub fn spawn_request_sender(request: reqwest::RequestBuilder, response_tx: Sender<ResponseResult>) {
  tauri::async_runtime::spawn(async move {
    let _ = response_tx.send(request.send().await.map_err(Into::into));
  });
}

#[inline]
pub fn spawn_static_response_sender(
  response: reqwest::Response,
  response_tx: Sender<ResponseResult>,
) {
  tauri::async_runtime::spawn(async move {
    let _ = response_tx.send(Ok(response));
  });
}

#[inline]
pub fn spawn_body_streamer(response: reqwest::Response) -> StreamingResponse {
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
