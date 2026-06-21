"""Shared logger for the NHS Conditions scraper."""

from __future__ import annotations

import logging

from src.constants import LOG_FILE

_logger: logging.Logger | None = None


def get_logger() -> logging.Logger:
    """Return the shared package logger, initialising it on first call."""
    global _logger
    if _logger is not None:
        return _logger

    logger = logging.getLogger("nhs-crawler")
    logger.setLevel(logging.DEBUG)

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")

    file_handler = logging.FileHandler(LOG_FILE, mode="a", encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(formatter)

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.INFO)
    stream_handler.setFormatter(formatter)

    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)

    _logger = logger
    return logger
