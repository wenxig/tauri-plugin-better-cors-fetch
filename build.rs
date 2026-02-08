const COMMANDS: &[&str] = &[
  "fetch",
  "fetch_cancel",
  "fetch_send",
  "fetch_read_body",
  "fetch_cancel_body",
  "prepare_requester"
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).build();
}
