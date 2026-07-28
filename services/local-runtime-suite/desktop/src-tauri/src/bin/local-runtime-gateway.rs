use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

const PRODUCT_NAME: &str = "Local Runtime Suite";
const PACKAGED_RUNTIME_ENV: &str = "LOCAL_RUNTIME_PACKAGED_ROOT";

fn candidates(exe_dir: &Path, app_dir: Option<&Path>) -> Vec<PathBuf> {
    let dev = exe_dir
        .parent()
        .map(|p| p.join("resources").join("local-runtime-python"));
    let mac = exe_dir
        .parent()
        .map(|p| p.join("Resources").join("local-runtime-python"));
    let windows = Some(exe_dir.join("local-runtime-python"));
    let legacy_flat = Some(exe_dir.join("resources").join("local-runtime-python"));
    let linux_system = exe_dir.parent().map(|p| {
        p.join("lib")
            .join(PRODUCT_NAME)
            .join("local-runtime-python")
    });
    let linux_appimage = app_dir.map(|p| {
        p.join("usr")
            .join("lib")
            .join(PRODUCT_NAME)
            .join("local-runtime-python")
    });
    let linux_appimage_share =
        app_dir.map(|p| p.join("usr").join("share").join("local-runtime-python"));
    let mac2 = exe_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("Resources").join("local-runtime-python"));

    vec![
        dev,
        mac,
        windows,
        legacy_flat,
        linux_system,
        linux_appimage,
        linux_appimage_share,
        mac2,
    ]
    .into_iter()
    .flatten()
    .collect()
}

fn find_runtime_root(
    exe_dir: &Path,
    explicit_root: Option<&Path>,
    app_dir: Option<&Path>,
) -> Option<PathBuf> {
    if let Some(root) = explicit_root.filter(|root| root.exists()) {
        return Some(root.to_path_buf());
    }
    candidates(exe_dir, app_dir)
        .into_iter()
        .find(|candidate| candidate.exists())
}

fn find_python(runtime_root: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let p = runtime_root.join("python").join("python.exe");
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let p3 = runtime_root.join("python").join("bin").join("python3");
        if p3.exists() {
            return Some(p3);
        }
        let p = runtime_root.join("python").join("bin").join("python");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn main() -> ExitCode {
    let exe = match env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("local-runtime-gateway: cannot resolve current_exe: {e}");
            return ExitCode::from(1);
        }
    };
    let exe_dir = match exe.parent() {
        Some(p) => p,
        None => {
            eprintln!("local-runtime-gateway: cannot resolve exe directory");
            return ExitCode::from(1);
        }
    };

    let explicit_runtime = env::var_os(PACKAGED_RUNTIME_ENV).map(PathBuf::from);
    let app_dir = env::var_os("APPDIR").map(PathBuf::from);
    let runtime_root = match find_runtime_root(
        exe_dir,
        explicit_runtime.as_deref(),
        app_dir.as_deref(),
    ) {
        Some(p) => p,
        None => {
            eprintln!(
                "local-runtime-gateway: runtime not found. Looked for resources/local-runtime-python near: {}",
                exe_dir.display()
            );
            return ExitCode::from(2);
        }
    };

    let python = match find_python(&runtime_root) {
        Some(p) => p,
        None => {
            eprintln!(
                "local-runtime-gateway: embedded python not found under: {}",
                runtime_root.display()
            );
            return ExitCode::from(3);
        }
    };

    let pylibs = runtime_root.join("pylibs");
    if !pylibs.exists() {
        eprintln!(
            "local-runtime-gateway: pylibs not found: {}",
            pylibs.display()
        );
        return ExitCode::from(4);
    }

    let mut cmd = Command::new(python);
    cmd.arg("-m").arg("local_runtime.main");

    for a in env::args().skip(1) {
        cmd.arg(a);
    }

    cmd.env("PYTHONNOUSERSITE", "1");
    cmd.env("PYTHONPATH", &pylibs);

    let runtime_bin = runtime_root.join("bin");
    if runtime_bin.exists() {
        let mut combined = runtime_bin.into_os_string();
        if let Some(existing) = env::var_os("PATH") {
            if cfg!(target_os = "windows") {
                combined.push(";");
            } else {
                combined.push(":");
            }
            combined.push(existing);
        }
        cmd.env("PATH", combined);
    }

    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::inherit());
    cmd.stderr(Stdio::inherit());

    let status = match cmd.status() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("local-runtime-gateway: failed to start python: {e}");
            return ExitCode::from(5);
        }
    };

    match status.code() {
        Some(code) if code >= 0 => ExitCode::from(code as u8),
        _ => ExitCode::from(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_paths_cover_native_bundle_resource_layouts() {
        let macos_executable_dir =
            Path::new("/Applications/Local Runtime Suite.app/Contents/MacOS");
        let macos_candidates = candidates(macos_executable_dir, None);
        assert!(macos_candidates.contains(&PathBuf::from(
            "/Applications/Local Runtime Suite.app/Contents/Resources/local-runtime-python"
        )));

        let windows_executable_dir = Path::new(r"C:\Program Files\Local Runtime Suite");
        let windows_candidates = candidates(windows_executable_dir, None);
        assert!(windows_candidates.contains(&PathBuf::from(
            r"C:\Program Files\Local Runtime Suite/local-runtime-python"
        )));

        let appimage_executable_dir = Path::new("/tmp/appimage/usr/bin");
        let appimage_candidates =
            candidates(appimage_executable_dir, Some(Path::new("/tmp/appimage")));
        assert!(appimage_candidates.contains(&PathBuf::from(
            "/tmp/appimage/usr/lib/Local Runtime Suite/local-runtime-python"
        )));
        assert!(appimage_candidates.contains(&PathBuf::from(
            "/tmp/appimage/usr/share/local-runtime-python"
        )));
    }

    #[test]
    fn runtime_discovery_prefers_an_existing_explicit_resource_root() {
        let directory = tempfile::tempdir().expect("temporary bundle");
        let executable_dir = directory.path().join("bin");
        let fallback_runtime = directory
            .path()
            .join("resources")
            .join("local-runtime-python");
        let explicit_runtime = directory.path().join("tauri-resource-root");
        std::fs::create_dir_all(&executable_dir).expect("executable directory");
        std::fs::create_dir_all(&fallback_runtime).expect("fallback runtime directory");
        std::fs::create_dir_all(&explicit_runtime).expect("explicit runtime directory");

        assert_eq!(
            find_runtime_root(&executable_dir, Some(&explicit_runtime), None),
            Some(explicit_runtime)
        );
    }

    #[test]
    fn runtime_discovery_ignores_a_missing_explicit_root() {
        let directory = tempfile::tempdir().expect("temporary bundle");
        let executable_dir = directory.path().join("bin");
        let runtime = directory
            .path()
            .join("resources")
            .join("local-runtime-python");
        std::fs::create_dir_all(&executable_dir).expect("executable directory");
        std::fs::create_dir_all(&runtime).expect("runtime directory");

        assert_eq!(
            find_runtime_root(
                &executable_dir,
                Some(&directory.path().join("missing")),
                None
            ),
            Some(runtime)
        );
    }

    #[test]
    fn runtime_discovery_falls_back_to_appimage_share_layout() {
        let directory = tempfile::tempdir().expect("temporary AppImage");
        let executable_dir = directory.path().join("usr").join("bin");
        let runtime = directory
            .path()
            .join("usr")
            .join("share")
            .join("local-runtime-python");
        std::fs::create_dir_all(&executable_dir).expect("executable directory");
        std::fs::create_dir_all(&runtime).expect("AppImage runtime directory");

        assert_eq!(
            find_runtime_root(
                &executable_dir,
                Some(&directory.path().join("missing-resource-dir")),
                Some(directory.path()),
            ),
            Some(runtime)
        );
    }
}
