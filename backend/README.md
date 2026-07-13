# StagePilot backend

The StagePilot backend is an independently runnable FastAPI application. Demo
mode requires no external services or credentials. The initial Planning Center
client is typed and tested but is not yet registered as a production plugin.

```bash
cd backend
uv sync --extra dev
uv run uvicorn stagepilot.main:app --reload
```

Open `http://127.0.0.1:8765/api/v1/health`. The live state stream is available at
`ws://127.0.0.1:8765/ws`.

Quality checks:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest
```
