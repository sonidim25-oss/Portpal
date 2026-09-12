use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

pub struct PendingUpdate(pub Mutex<Option<Update>>);

impl PendingUpdate {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

impl Default for PendingUpdate {
    fn default() -> Self {
        Self::new()
    }
}

/// Checks if an update is available for PortPal.
/// Stores the update in `PendingUpdate` state if found.
pub async fn check_update(app: &AppHandle) -> Result<Option<UpdateMetadata>, String> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return Err(format!("failed to initialize updater: {e}")),
    };

    let update = match updater.check().await {
        Ok(u) => u,
        Err(e) => return Err(format!("failed to check for updates: {e}")),
    };

    if let Some(ref u) = update {
        let metadata = UpdateMetadata {
            version: u.version.clone(),
            current_version: u.current_version.clone(),
            body: u.body.clone(),
            date: u.date.map(|d| d.to_string()),
        };

        if let Some(pending) = app.try_state::<PendingUpdate>() {
            let mut lock = pending
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *lock = update;
        }

        Ok(Some(metadata))
    } else {
        if let Some(pending) = app.try_state::<PendingUpdate>() {
            let mut lock = pending
                .0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *lock = None;
        }
        Ok(None)
    }
}

/// Downloads and installs the pending update.
///
/// The pending update is cloned rather than taken, and cleared only once the
/// install succeeds. Taking it up front meant a failed download — a dropped
/// connection, a GitHub hiccup — consumed the only copy, so the retry the user
/// immediately reaches for reported "no pending update found" and stayed broken
/// until they ran another check by hand. The sidebar's update dot makes that
/// state worse, since it keeps advertising an update the Install button can no
/// longer act on.
pub async fn install_update(app: &AppHandle) -> Result<(), String> {
    let pending_opt = {
        let Some(pending) = app.try_state::<PendingUpdate>() else {
            return Err("updater state is unavailable".into());
        };
        let lock = pending
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        lock.clone()
    };

    let Some(update) = pending_opt else {
        return Err("no pending update found to install".into());
    };

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| format!("failed to download and install update: {e}"))?;

    // Success only. On Windows the installer usually replaces the running
    // process before this line is reached; clearing here keeps the state
    // honest on platforms where control returns.
    if let Some(pending) = app.try_state::<PendingUpdate>() {
        let mut lock = pending
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *lock = None;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_metadata_serialization() {
        let meta = UpdateMetadata {
            version: "0.5.1".into(),
            current_version: "0.5.0".into(),
            body: Some("Bug fixes and improvements".into()),
            date: Some("2026-09-12T00:00:00Z".into()),
        };

        let json = serde_json::to_string(&meta).expect("serialization failed");
        assert!(json.contains(r#""version":"0.5.1""#));
        assert!(json.contains(r#""currentVersion":"0.5.0""#));
        assert!(json.contains(r#""body":"Bug fixes and improvements""#));
        assert!(json.contains(r#""date":"2026-09-12T00:00:00Z""#));
    }

    #[test]
    fn test_pending_update_initial_state() {
        let pending = PendingUpdate::new();
        let lock = pending.0.lock().unwrap();
        assert!(lock.is_none());
    }
}
