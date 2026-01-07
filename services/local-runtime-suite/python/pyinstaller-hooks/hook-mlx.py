from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

# Collect MLX native extensions and associated share assets exactly once so nanobind
# types are initialized from a single binary payload.
binaries = collect_dynamic_libs("mlx")
datas = collect_data_files("mlx", includes=["share/*"])
