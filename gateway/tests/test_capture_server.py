"""Tests for HTTP capture upload helpers."""

import pytest
from aiohttp import web

from stackchan_mcp.capture_server import (
    CAPTURE_TOKEN_KEY,
    EDITOR_ASSET_TYPES,
    _read_editor_asset,
    _is_authorized,
    create_capture_app,
)


def test_capture_app_stores_capture_token():
    """Capture app keeps the expected bearer token in app state."""
    app = create_capture_app(capture_token="capture-token")

    assert app[CAPTURE_TOKEN_KEY] == "capture-token"


def test_capture_app_registers_editor_routes():
    """Capture app also serves the bundled motion editor."""
    app = create_capture_app()
    route_paths = {route.resource.canonical for route in app.router.routes()}

    assert "/editor" in route_paths
    assert "/editor/" in route_paths
    assert "/editor/{filename}" in route_paths


def test_editor_assets_are_bundled_and_whitelisted():
    """Editor assets are served only from the explicit allow-list."""
    assert set(EDITOR_ASSET_TYPES) == {"index.html", "styles.css", "app.js"}

    index_bytes, content_type = _read_editor_asset("index.html")

    assert content_type == "text/html"
    assert b"Motion Timeline Editor" in index_bytes


def test_editor_asset_reader_rejects_unknown_files():
    """Editor assets cannot escape the explicit allow-list."""
    with pytest.raises(web.HTTPNotFound):
        _read_editor_asset("not-allowed.txt")


def test_is_authorized_accepts_matching_bearer():
    """Bearer auth must match exactly."""
    assert _is_authorized("Bearer capture-token", "capture-token") is True


def test_is_authorized_rejects_missing_or_wrong_bearer():
    """Missing or mismatched bearer auth is rejected."""
    assert _is_authorized("", "capture-token") is False
    assert _is_authorized("Bearer wrong-token", "capture-token") is False
