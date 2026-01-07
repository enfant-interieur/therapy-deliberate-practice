use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

fn candidates(exe_dir: &Path) -> Vec<PathBuf> {
    let dev = exe_dir
        .parent()
        .map(|p| p.join("resources").join("local-runtime-python"));
    let mac = exe_dir
        .parent()
        .map(|p| p.join("Resources").join("local-runtime-python"));
    let winlin1 = Some(exe_dir.join("resources").join("local-runtime-python"));
    let winlin2 = exe_dir
        .parent()
        .map(|p| p.join("resources").join("local-runtime-python"));
    let mac2 = exe_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("Resources").join("local-runtime-python"));

    vec![dev, mac, winlin1, winlin2, mac2]
        .into_iter()
        .flatten()
        .collect()
}

fn find_runtime_root(exe_dir: &Path) -> Option<PathBuf> {
    for c in candidates(exe_dir) {
        if c.exists() {
            return Some(c);
        }
    }
    None
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

    let runtime_root = match find_runtime_root(exe_dir) {
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
        eprintln!("local-runtime-gateway: pylibs not found: {}", pylibs.display());
        return ExitCode::from(4);
    }

    let mut cmd = Command::new(python);
    cmd.arg("-m").arg("local_runtime.main");

    for a in env::args().skip(1) {
        cmd.arg(a);
    }

    cmd.env("PYTHONNOUSERSITE", "1");
    cmd.env("PYTHONPATH", &pylibs);
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
