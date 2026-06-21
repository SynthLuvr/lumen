"""Shared utility helpers."""

from __future__ import annotations

from datetime import UTC, datetime


def now_iso() -> str:
    """Return the current UTC timestamp as an ISO 8601 string."""
    return datetime.now(UTC).isoformat()


def product_slug_from_handle(handle: str) -> str:
    """Use the Shopify product handle directly as the slug.

    Handles are already URL-safe and unique (e.g. ``terranova-magnesium-complex-50s``).
    """
    return handle.strip("/").split("/")[-1]
