"""HTTP capture server for receiving photos from ESP32.

ESP32's camera.Explain() POSTs multipart/form-data with:
- field 'question' (text)
- field 'file' (camera.jpg, JPEG image)

This server saves the JPEG and returns the file path so MCP client
can view the image via the Read tool.
"""

from __future__ import annotations

from importlib import resources
import json
import logging
import os
import time

from aiohttp import web

logger = logging.getLogger(__name__)

CAPTURE_DIR = os.path.expanduser("~/.stackchan/captures")
CAPTURE_TOKEN_KEY = web.AppKey("capture_token", str)
EDITOR_ASSET_TYPES = {
    "index.html": "text/html",
    "styles.css": "text/css",
    "app.js": "application/javascript",
}


def _is_authorized(auth_header: str, expected_token: str) -> bool:
    """Return whether the bearer auth header matches the expected token."""
    return auth_header == f"Bearer {expected_token}"


async def handle_capture(request: web.Request) -> web.Response:
    """Handle photo upload from ESP32."""
    expected_token = request.app[CAPTURE_TOKEN_KEY]
    if expected_token and not _is_authorized(
        request.headers.get("Authorization", ""), expected_token
    ):
        logger.warning("Capture upload auth rejected")
        return web.Response(
            text='{"error": "Unauthorized"}',
            status=401,
            content_type="application/json",
        )

    os.makedirs(CAPTURE_DIR, exist_ok=True)

    reader = await request.multipart()
    question = ""
    image_path = ""

    async for part in reader:
        if part.name == "question":
            question = (await part.read()).decode("utf-8")
        elif part.name == "file":
            timestamp = int(time.time() * 1000)
            filename = f"capture_{timestamp}.jpg"
            image_path = os.path.join(CAPTURE_DIR, filename)
            with open(image_path, "wb") as f:
                while True:
                    chunk = await part.read_chunk(8192)
                    if not chunk:
                        break
                    f.write(chunk)

    if image_path and os.path.exists(image_path):
        file_size = os.path.getsize(image_path)
        logger.info(
            "Captured photo: %s (%d bytes), question: %s",
            image_path,
            file_size,
            question,
        )
        result = json.dumps({
            "image_path": image_path,
            "size_bytes": file_size,
            "question": question,
        })
        return web.Response(text=result, content_type="application/json")

    return web.Response(
        text='{"error": "No image received"}',
        status=400,
        content_type="application/json",
    )


def _read_editor_asset(filename: str) -> tuple[bytes, str]:
    """Read a bundled motion editor asset and return bytes + content type."""
    content_type = EDITOR_ASSET_TYPES.get(filename)
    if content_type is None:
        raise web.HTTPNotFound(text="Editor asset not found")

    try:
        data = (
            resources.files("stackchan_mcp")
            .joinpath("editor", filename)
            .read_bytes()
        )
    except FileNotFoundError as exc:
        raise web.HTTPNotFound(text="Editor asset not found") from exc

    return data, content_type


async def handle_editor_index(request: web.Request) -> web.Response:
    """Serve the motion template timeline editor."""
    data, content_type = _read_editor_asset("index.html")
    return web.Response(body=data, content_type=content_type)


async def handle_editor_asset(request: web.Request) -> web.Response:
    """Serve a whitelisted motion editor asset."""
    filename = request.match_info["filename"]
    data, content_type = _read_editor_asset(filename)
    return web.Response(body=data, content_type=content_type)


def create_capture_app(capture_token: str = "") -> web.Application:
    """Create the HTTP capture and local tooling application."""
    app = web.Application()
    app[CAPTURE_TOKEN_KEY] = capture_token
    app.router.add_post("/capture", handle_capture)
    app.router.add_get("/editor", handle_editor_index)
    app.router.add_get("/editor/", handle_editor_index)
    app.router.add_get("/editor/{filename}", handle_editor_asset)
    return app
