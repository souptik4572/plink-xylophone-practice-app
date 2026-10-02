"""Plink local API. Binds to 127.0.0.1 only; receives bar indices and timings, never audio."""

import importlib.util

import httpx
from fastapi import FastAPI

from app import config

app = FastAPI(title="Plink")


@app.get("/api/health")
def health() -> dict:
    try:
        r = httpx.get(f"{config.OLLAMA_URL}/api/tags", timeout=2)
        names = {m["name"] for m in r.json().get("models", [])}
        ollama = config.GEMMA_MODEL in names
    except httpx.HTTPError:
        ollama = False
    tabpfn = importlib.util.find_spec("tabpfn") is not None
    return {"ok": True, "ollama": ollama, "gemma_model": config.GEMMA_MODEL, "tabpfn": tabpfn}
