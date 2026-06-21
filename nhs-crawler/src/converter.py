"""Convert NHS HTML content elements to clean Markdown.

Pre-processes the BeautifulSoup tree to transform NHS design-system
components (care cards, do/don't lists, inset text) into plain HTML that
``markdownify`` handles natively.
"""

from __future__ import annotations

from bs4 import BeautifulSoup, Tag
from markdownify import markdownify

_CARE_CARD_PREFIXES: dict[str, str] = {
    "nhsuk-card--care--emergency": "🚨 Immediate action required:",
    "nhsuk-card--care--urgent": "⚠️ Urgent advice:",
    "nhsuk-card--care--non-urgent": "📋 Non-urgent advice:",
    "nhsuk-card--care": "📋 Advice:",
}

_CLUTTER_TAGS = ["button", "form", "input", "svg"]


def html_to_markdown(element: Tag) -> str:
    """Convert a BeautifulSoup Tag to clean Markdown."""
    clone = BeautifulSoup(str(element), "lxml")

    _transform_care_cards(clone)
    _transform_inset_text(clone)
    _transform_do_dont_lists(clone)

    md = markdownify(
        str(clone),
        heading_style="ATX",
        bullets="-",
        strip=_CLUTTER_TAGS,
    )
    return _collapse_blank_lines(md).strip()


def _transform_care_cards(soup: BeautifulSoup) -> None:
    """Convert NHS care cards into ``<blockquote>`` elements."""
    for css_class, prefix in _CARE_CARD_PREFIXES.items():
        for card in soup.find_all("div", class_=css_class):
            content_div = card.find("div", class_="nhsuk-card__content")
            inner_html = str(content_div) if content_div else ""
            new_tag = BeautifulSoup(
                f"<blockquote><p><strong>{prefix}</strong></p>{inner_html}</blockquote>",
                "lxml",
            )
            card.replace_with(new_tag)


def _transform_inset_text(soup: BeautifulSoup) -> None:
    """Convert NHS inset-text boxes into ``<blockquote>`` elements."""
    for inset in soup.find_all("div", class_="nhsuk-inset-text"):
        text = inset.get_text(separator=" ", strip=True)
        new_tag = BeautifulSoup(
            f"<blockquote><p><strong>💡 Information:</strong> {text}</p></blockquote>",
            "lxml",
        )
        inset.replace_with(new_tag)


def _transform_do_dont_lists(soup: BeautifulSoup) -> None:
    """Convert NHS do/don't lists into clean HTML ``<ul>`` elements."""
    for container in soup.find_all("div", class_="nhsuk-do-dont-list"):
        parts: list[str] = []

        label_tag = container.find(class_="nhsuk-do-dont-list__label")
        label_text = label_tag.get_text(strip=True) if label_tag else ""

        tick_list = container.find("ul", class_="nhsuk-list--tick")
        cross_list = container.find("ul", class_="nhsuk-list--cross")

        if tick_list:
            parts.append(f"<p><strong>{label_text or 'Do'}:</strong></p><ul>")
            for li in tick_list.find_all("li", recursive=False):
                _strip_svgs(li)
                parts.append(f"<li>✅ {li.get_text(strip=True)}</li>")
            parts.append("</ul>")

        if cross_list:
            parts.append("<p><strong>Don't:</strong></p><ul>")
            for li in cross_list.find_all("li", recursive=False):
                _strip_svgs(li)
                parts.append(f"<li>❌ {li.get_text(strip=True)}</li>")
            parts.append("</ul>")

        container.replace_with(BeautifulSoup("".join(parts), "lxml"))


def _strip_svgs(element: Tag) -> None:
    """Remove all ``<svg>`` children from an element."""
    for svg in element.find_all("svg"):
        svg.decompose()


def _collapse_blank_lines(text: str, max_blanks: int = 2) -> str:
    """Reduce runs of more than *max_blanks* consecutive blank lines."""
    pattern = "\n" * (max_blanks + 1)
    replacement = "\n" * max_blanks
    while pattern in text:
        text = text.replace(pattern, replacement)
    return text
