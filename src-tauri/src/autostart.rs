#[cfg(target_os = "windows")]
pub mod windows_impl {
    use std::path::Path;
    use std::ptr;
    use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ,
    };

    pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    pub fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn get_autostart_value(name: &str) -> Result<Option<String>, String> {
        let wide_sub_key = to_wide(RUN_KEY);
        let wide_name = to_wide(name);
        let mut hkey: HKEY = ptr::null_mut();

        unsafe {
            let status = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide_sub_key.as_ptr(),
                0,
                KEY_QUERY_VALUE,
                &mut hkey,
            );
            if status == ERROR_FILE_NOT_FOUND {
                return Ok(None);
            }
            if status != ERROR_SUCCESS {
                return Err(format!(
                    "failed to open registry run key: error code {status}"
                ));
            }

            let mut data_type = 0u32;
            let mut data_len = 0u32;
            let status = RegQueryValueExW(
                hkey,
                wide_name.as_ptr(),
                ptr::null(),
                &mut data_type,
                ptr::null_mut(),
                &mut data_len,
            );

            if status == ERROR_FILE_NOT_FOUND {
                RegCloseKey(hkey);
                return Ok(None);
            }
            if status != ERROR_SUCCESS {
                RegCloseKey(hkey);
                return Err(format!(
                    "failed to query registry value: error code {status}"
                ));
            }

            let u16_len = (data_len as usize) / std::mem::size_of::<u16>();
            let mut buffer = vec![0u16; u16_len];
            let status = RegQueryValueExW(
                hkey,
                wide_name.as_ptr(),
                ptr::null(),
                &mut data_type,
                buffer.as_mut_ptr() as *mut u8,
                &mut data_len,
            );
            RegCloseKey(hkey);

            if status != ERROR_SUCCESS {
                return Err(format!(
                    "failed to read registry value: error code {status}"
                ));
            }

            while let Some(&0) = buffer.last() {
                buffer.pop();
            }

            String::from_utf16(&buffer)
                .map(Some)
                .map_err(|e| format!("invalid UTF-16 in registry value: {e}"))
        }
    }

    pub fn is_autostart_enabled(name: &str) -> Result<bool, String> {
        Ok(get_autostart_value(name)?.is_some())
    }

    pub fn set_autostart_target(name: &str, exe_path: &Path, enabled: bool) -> Result<(), String> {
        let wide_sub_key = to_wide(RUN_KEY);
        let wide_name = to_wide(name);

        if enabled {
            let formatted_path = format!("\"{}\"", exe_path.display());
            let wide_val = to_wide(&formatted_path);
            let byte_len = (wide_val.len() * std::mem::size_of::<u16>()) as u32;

            let mut hkey: HKEY = ptr::null_mut();
            unsafe {
                let status = RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    wide_sub_key.as_ptr(),
                    0,
                    KEY_SET_VALUE,
                    &mut hkey,
                );
                if status != ERROR_SUCCESS {
                    return Err(format!(
                        "failed to open registry run key for writing: error code {status}"
                    ));
                }

                let status = RegSetValueExW(
                    hkey,
                    wide_name.as_ptr(),
                    0,
                    REG_SZ,
                    wide_val.as_ptr() as *const u8,
                    byte_len,
                );
                RegCloseKey(hkey);

                if status != ERROR_SUCCESS {
                    return Err(format!("failed to set registry value: error code {status}"));
                }
            }
            Ok(())
        } else {
            let mut hkey: HKEY = ptr::null_mut();
            unsafe {
                let status = RegOpenKeyExW(
                    HKEY_CURRENT_USER,
                    wide_sub_key.as_ptr(),
                    0,
                    KEY_SET_VALUE,
                    &mut hkey,
                );
                if status == ERROR_FILE_NOT_FOUND {
                    return Ok(());
                }
                if status != ERROR_SUCCESS {
                    return Err(format!(
                        "failed to open registry run key: error code {status}"
                    ));
                }

                let status = RegDeleteValueW(hkey, wide_name.as_ptr());
                RegCloseKey(hkey);

                if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
                    Ok(())
                } else {
                    Err(format!(
                        "failed to delete registry value: error code {status}"
                    ))
                }
            }
        }
    }

    pub fn set_autostart(name: &str, enabled: bool) -> Result<(), String> {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("failed to determine executable path: {e}"))?;
        set_autostart_target(name, &exe_path, enabled)
    }
}

#[cfg(target_os = "linux")]
pub mod linux_impl {
    use std::fs;
    use std::path::{Path, PathBuf};

    pub fn get_desktop_entry_path() -> Result<PathBuf, String> {
        let config_dir = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .ok_or_else(|| "could not determine XDG_CONFIG_HOME or HOME directory".to_string())?;
        Ok(config_dir.join("autostart").join("portpal.desktop"))
    }

    pub fn is_autostart_enabled() -> Result<bool, String> {
        let path = get_desktop_entry_path()?;
        Ok(path.is_file())
    }

    pub fn set_autostart_target(exe_path: &Path, enabled: bool) -> Result<(), String> {
        let path = get_desktop_entry_path()?;
        if enabled {
            let parent = path
                .parent()
                .ok_or_else(|| "invalid autostart path".to_string())?;
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create autostart directory: {e}"))?;
            let content = format!(
                "[Desktop Entry]\nType=Application\nName=PortPal\nExec=\"{}\"\nTerminal=false\n",
                exe_path.display()
            );
            fs::write(&path, content)
                .map_err(|e| format!("failed to write autostart desktop file: {e}"))?;
        } else if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("failed to remove autostart desktop file: {e}"))?;
        }
        Ok(())
    }

    pub fn set_autostart(enabled: bool) -> Result<(), String> {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("failed to determine executable path: {e}"))?;
        set_autostart_target(&exe_path, enabled)
    }
}

#[cfg(target_os = "macos")]
pub mod macos_impl {
    use std::fs;
    use std::path::{Path, PathBuf};

    pub fn get_plist_path() -> Result<PathBuf, String> {
        let home = std::env::var_os("HOME")
            .ok_or_else(|| "could not determine HOME directory".to_string())?;
        Ok(PathBuf::from(home)
            .join("Library")
            .join("LaunchAgents")
            .join("com.portpal.app.plist"))
    }

    pub fn is_autostart_enabled() -> Result<bool, String> {
        let path = get_plist_path()?;
        Ok(path.is_file())
    }

    pub fn set_autostart_target(exe_path: &Path, enabled: bool) -> Result<(), String> {
        let path = get_plist_path()?;
        if enabled {
            let parent = path
                .parent()
                .ok_or_else(|| "invalid LaunchAgents path".to_string())?;
            fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create LaunchAgents directory: {e}"))?;
            let plist = format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.portpal.app</string>
    <key>ProgramArguments</key>
    <array>
        <string>{}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"#,
                exe_path.display()
            );
            fs::write(&path, plist)
                .map_err(|e| format!("failed to write launch agent plist: {e}"))?;
        } else if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("failed to remove launch agent plist: {e}"))?;
        }
        Ok(())
    }

    pub fn set_autostart(enabled: bool) -> Result<(), String> {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("failed to determine executable path: {e}"))?;
        set_autostart_target(&exe_path, enabled)
    }
}

pub const APP_NAME: &str = "PortPal";

pub fn is_autostart_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::is_autostart_enabled(APP_NAME)
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::is_autostart_enabled()
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::is_autostart_enabled()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        Ok(false)
    }
}

pub fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::set_autostart(APP_NAME, enabled)
    }
    #[cfg(target_os = "linux")]
    {
        linux_impl::set_autostart(enabled)
    }
    #[cfg(target_os = "macos")]
    {
        macos_impl::set_autostart(enabled)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    {
        let _ = enabled;
        Err("Autostart is not supported on this operating system".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn test_windows_autostart_lifecycle() {
        let test_name = "PortPal_Test_Autostart_Lifecycle";
        // Ensure starting clean
        let _ = windows_impl::set_autostart_target(
            test_name,
            std::path::Path::new(r"C:\dummy\portpal.exe"),
            false,
        );
        assert_eq!(windows_impl::is_autostart_enabled(test_name), Ok(false));
        assert_eq!(windows_impl::get_autostart_value(test_name), Ok(None));

        // Enable
        let test_exe = std::path::Path::new(r"C:\Program Files\PortPal\portpal.exe");
        assert!(windows_impl::set_autostart_target(test_name, test_exe, true).is_ok());
        assert_eq!(windows_impl::is_autostart_enabled(test_name), Ok(true));
        assert_eq!(
            windows_impl::get_autostart_value(test_name),
            Ok(Some(
                r#""C:\Program Files\PortPal\portpal.exe""#.to_string()
            ))
        );

        // Disable
        assert!(windows_impl::set_autostart_target(test_name, test_exe, false).is_ok());
        assert_eq!(windows_impl::is_autostart_enabled(test_name), Ok(false));
        assert_eq!(windows_impl::get_autostart_value(test_name), Ok(None));
    }
}
