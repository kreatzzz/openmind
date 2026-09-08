fn main() {
    #[cfg(feature = "desktop")]
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_vault_status",
            "open_demo",
            "list_notes",
            "edit_note",
            "delete_note",
            "retry_notes",
            "create_vault",
            "unlock_vault",
            "lock_vault",
            "list_sessions",
            "create_session",
            "delete_session",
            "list_messages",
            "list_models",
            "send_message",
            "cancel_turn",
        ]),
    ))
    .expect("Could not build desktop permissions");
}
