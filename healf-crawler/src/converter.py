"""Convert HTML content fragments to clean Markdown."""

from __future__ import annotations

from bs4 import BeautifulSoup
from markdownify import markdownify

_CLUTTER_TAGS: list[str] = [
    "button",
    "form",
    "input",
    "svg",
    "script",
    "style",
    "iframe",
]


def html_to_markdown(html: str) -> str:
    """Convert an HTML fragment string to clean Markdown."""
    if not html or not html.strip():
        return ""
    soup = BeautifulSoup(f"<div>{html}</div>", "lxml")
    md = markdownify(
        str(soup),
        heading_style="ATX",
        bullets="-",
        strip=_CLUTTER_TAGS,
    )
    return _collapse_blank_lines(md).strip()


def _collapse_blank_lines(text: str, max_blanks: int = 2) -> str:
    """Reduce runs of blank lines to at most *max_blanks* consecutive."""
    pattern = "\n" * (max_blanks + 1)
    replacement = "\n" * max_blanks
    while pattern in text:
        text = text.replace(pattern, replacement)
    return text
