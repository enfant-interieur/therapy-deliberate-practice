import uvicorn

from local_runtime.api.models import create_app


def run() -> None:
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


if __name__ == "__main__":
    run()
