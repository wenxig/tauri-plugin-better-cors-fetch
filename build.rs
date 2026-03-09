const COMMANDS: &[&str] = &[
  "fetch",
  "fetch_cancel",
  "fetch_send",
  "fetch_read_body",
  "fetch_cancel_body",
  "prepare_requester",
  "set_cookie",
  "get_cookie",
  "get_all_cookies",
  "delete_cookie"
];

fn main() {
  tauri_plugin::Builder::new(COMMANDS).build();
}
