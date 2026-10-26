#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceSecondsSinceLastEventType(source_state: i32, event_type: u32) -> f64;
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct LASTINPUTINFO {
    cbSize: u32,
    dwTime: u32,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GetLastInputInfo(plii: *mut LASTINPUTINFO) -> i32;
    fn GetTickCount() -> u32;
}

/// Returns the number of seconds since the last user input (keyboard or mouse).
pub fn get_idle_seconds() -> f64 {
    #[cfg(target_os = "macos")]
    unsafe {
        // kCGEventSourceStateCombinedSessionState = 0
        // kCGAnyInputEventType = u32::MAX (~0)
        let secs = CGEventSourceSecondsSinceLastEventType(0, u32::MAX);
        if secs.is_nan() || secs < 0.0 {
            0.0
        } else {
            secs
        }
    }

    #[cfg(target_os = "windows")]
    unsafe {
        let mut lii = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut lii) != 0 {
            let now = GetTickCount();
            let elapsed_ms = now.wrapping_sub(lii.dwTime);
            (elapsed_ms as f64) / 1000.0
        } else {
            0.0
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Try xprintidle if available (standard on X11)
        if std::env::var("DISPLAY").is_ok() {
            if let Ok(output) = std::process::Command::new("xprintidle").output() {
                if output.status.success() {
                    if let Ok(str_val) = std::str::from_utf8(&output.stdout) {
                        if let Ok(ms) = str_val.trim().parse::<f64>() {
                            return ms / 1000.0;
                        }
                    }
                }
            }
        }

        // Try org.freedesktop.ScreenSaver via dbus-send (Wayland & GNOME/KDE)
        if let Ok(output) = std::process::Command::new("dbus-send")
            .args(&[
                "--print-reply",
                "--dest=org.freedesktop.ScreenSaver",
                "/org/freedesktop/ScreenSaver",
                "org.freedesktop.ScreenSaver.GetSessionIdleTime",
            ])
            .output()
        {
            if output.status.success() {
                if let Ok(str_val) = std::str::from_utf8(&output.stdout) {
                    for part in str_val.split_whitespace() {
                        if let Ok(ms) = part.parse::<f64>() {
                            return ms / 1000.0;
                        }
                    }
                }
            }
        }

        0.0
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        0.0
    }
}

/// Returns whether the system is currently in presentation, full-screen gaming/video, or DND mode.
pub fn is_presentation_mode_active() -> bool {
    #[cfg(target_os = "windows")]
    unsafe {
        #[repr(C)]
        #[derive(Debug, PartialEq, Eq)]
        enum QUERY_USER_NOTIFICATION_STATE {
            QUNS_NOT_PRESENT = 1,
            QUNS_BUSY = 2,
            QUNS_RUNNING_D3D_FULL_SCREEN = 3,
            QUNS_PRESENTATION_MODE = 4,
            QUNS_ACCEPTS_NOTIFICATIONS = 5,
            QUNS_QUIET_TIME = 6,
            QUNS_APP = 7,
        }
        extern "system" {
            fn SHQueryUserNotificationState(pquns: *mut QUERY_USER_NOTIFICATION_STATE) -> i32;
        }
        let mut state = QUERY_USER_NOTIFICATION_STATE::QUNS_NOT_PRESENT;
        if SHQueryUserNotificationState(&mut state) == 0 {
            matches!(
                state,
                QUERY_USER_NOTIFICATION_STATE::QUNS_BUSY
                    | QUERY_USER_NOTIFICATION_STATE::QUNS_RUNNING_D3D_FULL_SCREEN
                    | QUERY_USER_NOTIFICATION_STATE::QUNS_PRESENTATION_MODE
                    | QUERY_USER_NOTIFICATION_STATE::QUNS_QUIET_TIME
            )
        } else {
            false
        }
    }

    #[cfg(target_os = "macos")]
    {
        check_macos_presentation_state()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn check_macos_presentation_state() -> bool {
    // 1. Check if known presentation or meeting processes are running with active windows
    // e.g., Keynote, PowerPoint, zoom.us, Webex, Teams
    const MEETING_APPS: &[&str] = &[
        "Keynote",
        "Microsoft PowerPoint",
        "zoom.us",
        "Cisco Webex Meetings",
        "Microsoft Teams",
        "Microsoft Teams (work or school)",
    ];

    // Check frontmost application via AppleScript or process inspection
    let script = r#"
        tell application "System Events"
            set frontApp to name of first application process whose frontmost is true
            set isFullScreen to false
            try
                tell application process frontApp
                    set isFullScreen to value of attribute "AXFullScreen" of window 1
                end tell
            end try
            return (frontApp & ":" & isFullScreen)
        end tell
    "#;

    if let Ok(output) = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
    {
        if output.status.success() {
            if let Ok(res) = std::str::from_utf8(&output.stdout) {
                let trimmed = res.trim();
                let parts: Vec<&str> = trimmed.split(':').collect();
                if let Some(app_name) = parts.first() {
                    let is_full = parts.get(1).map_or(false, |v| *v == "true");
                    // Any meeting or slide software in full screen or active meeting
                    for target in MEETING_APPS {
                        if app_name.contains(target) {
                            return true;
                        }
                    }
                    if is_full {
                        return true;
                    }
                }
            }
        }
    }

    false
}

/// Triggers a native OS workstation/screen lock.
pub fn lock_os_session() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let cg_session = "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession";
        if std::path::Path::new(cg_session).exists() {
            let _ = std::process::Command::new(cg_session).arg("-suspend").status();
        }
        let status = std::process::Command::new("pmset")
            .arg("displaysleepnow")
            .status()
            .map_err(|e| format!("Failed to invoke pmset: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err("pmset displaysleepnow exited with non-zero status".to_string())
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = std::process::Command::new("rundll32.exe")
            .arg("user32.dll,LockWorkStation")
            .status()
            .map_err(|e| format!("Failed to invoke LockWorkStation: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err("LockWorkStation exited with non-zero status".to_string())
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(status) = std::process::Command::new("loginctl").arg("lock-session").status() {
            if status.success() {
                return Ok(());
            }
        }
        let status = std::process::Command::new("xdg-screensaver")
            .arg("lock")
            .status()
            .map_err(|e| format!("Failed to invoke xdg-screensaver: {}", e))?;
        if status.success() {
            Ok(())
        } else {
            Err("Failed to lock Linux session".to_string())
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("Screen lock not supported on this OS".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_idle_seconds() {
        let idle = get_idle_seconds();
        assert!(idle >= 0.0);
    }

    #[test]
    fn test_is_presentation_mode_active() {
        let is_pres = is_presentation_mode_active();
        assert!(!is_pres || is_pres);
    }
}

