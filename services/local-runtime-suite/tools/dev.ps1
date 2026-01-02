$root = Resolve-Path "$PSScriptRoot/../.."
$pythonRoot = Join-Path $root "services/local-runtime-suite/python"
Set-Location $pythonRoot
python -m local_runtime.main
