import platform


def current_platform() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "darwin" and machine in {"arm64", "aarch64"}:
        return "darwin-arm64"
    if system == "darwin":
        return "darwin-x64"
    if system == "windows":
        return "windows-x64"
    return "linux-x64"
