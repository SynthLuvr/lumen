"""Crawling and parsing of Healf product pages.

Healf is a Shopify-backed storefront rendered with Next.js (App Router).
Two data sources are combined:

1. **Shopify Storefront API** — discovers products in the ``all-products-1``
   collection and fetches structured fields (title, vendor, price,
   ``descriptionHtml``).

2. **Next.js RSC page stream** — the product detail page embeds private
   metafields (``ingredients``, ``suggested_use``) inside
   ``self.__next_f.push(...)`` chunks. These are not exposed via the
   Storefront API, so they are extracted from the rendered page's React
   Server Components payload.
"""

from __future__ import annotations

import re
import time
from typing import Any

from src.constants import (
    ALL_PRODUCTS_COLLECTION_HANDLE,
    PAGE_SIZE,
    PRODUCT_URL_TEMPLATE,
    SHOPIFY_STOREFRONT_TOKEN,
    SHOPIFY_STOREFRONT_URL,
    TARGET_VENDORS,
)
from src.converter import html_to_markdown
from src.http_client import make_session
from src.logging_config import get_logger

logger = get_logger()

_SESSION = make_session()

_GQL_HEADERS: dict[str, str] = {
    "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_TOKEN,
    "Content-Type": "application/json",
}

_DISCOVER_QUERY = """
query($handle: String!, $cursor: String, $first: Int!) {
  collection: collectionByHandle(handle: $handle) {
    id handle title
    products(first: $first, after: $cursor) {
      edges {
        node {
          id handle title vendor productType
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}
"""

_DETAIL_QUERY = """
query($handle: String!) {
  product: productByHandle(handle: $handle) {
    id handle title vendor productType
    descriptionHtml
    onlineStoreUrl
    priceRange {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }
    compareAtPriceRange {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }
    variants(first: 20) {
      edges {
        node {
          title
          price { amount currencyCode }
          compareAtPrice { amount currencyCode }
          availableForSale
          selectedOptions { name value }
        }
      }
    }
  }
}
"""


def _gql(query: str, variables: dict[str, Any]) -> dict[str, Any] | None:
    """Execute a Storefront GraphQL request, returning the ``data`` dict or None."""
    try:
        time.sleep(0.2)
        resp = _SESSION.post(
            SHOPIFY_STOREFRONT_URL,
            json={"query": query, "variables": variables},
            headers=_GQL_HEADERS,
            timeout=30,
        )
        if resp.status_code != 200:
            logger.error(f"Storefront API HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        payload = resp.json()
        if "errors" in payload:
            logger.error(f"GraphQL errors: {payload['errors']}")
            return None
        return payload.get("data")
    except Exception as exc:
        logger.error(f"Storefront API request failed: {exc}")
        return None


def discover_product_handles() -> list[dict[str, str]]:
    """Page through the collection and return products from target vendors."""
    logger.info(f"Discovering products from collection '{ALL_PRODUCTS_COLLECTION_HANDLE}'")
    cursor: str | None = None
    all_products: list[dict[str, str]] = []
    page = 0

    while True:
        data = _gql(
            _DISCOVER_QUERY,
            {
                "handle": ALL_PRODUCTS_COLLECTION_HANDLE,
                "cursor": cursor,
                "first": PAGE_SIZE,
            },
        )
        if data is None or data.get("collection") is None:
            logger.error("Failed to fetch collection — aborting discovery.")
            break

        collection = data["collection"]
        edges = collection["products"]["edges"]
        page += 1
        for edge in edges:
            node = edge["node"]
            all_products.append(
                {
                    "handle": node["handle"],
                    "title": node["title"],
                    "vendor": node["vendor"],
                    "product_type": node.get("productType", ""),
                }
            )

        page_info = collection["products"]["pageInfo"]
        logger.info(
            f"  Page {page}: fetched {len(edges)} products (running total {len(all_products)})"
        )
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]

    # A product can appear in multiple manual sortings within the collection.
    seen: set[str] = set()
    unique: list[dict[str, str]] = []
    for p in all_products:
        if p["handle"] not in seen:
            seen.add(p["handle"])
            unique.append(p)

    targets = [p for p in unique if p["vendor"] in TARGET_VENDORS]
    logger.info(
        f"Discovered {len(unique)} unique products; "
        f"{len(targets)} match target vendors ({', '.join(sorted(TARGET_VENDORS))})"
    )
    return targets


def _extract_rsc_stream(html: str) -> str:
    """Decode and concatenate all ``self.__next_f.push`` chunks from a page."""
    pushes = re.findall(r'self\.__next_f\.push\(\[1,\s*"(.*?)"\]\)', html, re.S)
    stream = ""
    for chunk in pushes:
        try:
            stream += chunk.encode().decode("unicode_escape")
        except Exception:
            stream += chunk
    return stream


def _resolve_t_references(stream: str) -> dict[str, str]:
    """Build a ``{ref_id: text}`` map from RSC ``N:T<len>,text`` definitions.

    ``<len>`` is a hexadecimal byte length, per the React Flight wire protocol.
    """
    refs: dict[str, str] = {}
    for match in re.finditer(r"(\w+):T(\w+),", stream):
        ref_id = match.group(1)
        length = int(match.group(2), 16)
        start = match.end()
        refs[ref_id] = stream[start : start + length]
    return refs


def _extract_metafields(stream: str, refs: dict[str, str]) -> dict[str, str]:
    """Pull the product-level metafields array out of the RSC stream.

    The array lives next to the ``"key":"ingredients"`` entry. Values may
    be inline strings or ``$N`` references that resolve via *refs*.
    """
    idx = stream.find('"key":"ingredients"')
    if idx < 0:
        return {}

    arr_start = stream.rfind('metafields":[', max(0, idx - 3000), idx)
    if arr_start < 0:
        return {}
    arr_end = stream.find("]}", idx)
    if arr_end < 0:
        return {}
    array_text = stream[arr_start : arr_end + 2]

    meta: dict[str, str] = {}
    for match in re.finditer(r'"key":"([^"]+)","value":"([^"]*)"', array_text):
        key = match.group(1)
        value = match.group(2)
        if re.fullmatch(r"\$\w+", value):
            ref_id = value.lstrip("$")
            value = refs.get(ref_id, value)
        meta[key] = value
    return meta


def _fetch_page_rsc(url: str) -> str:
    """Fetch a product page and return its decoded RSC stream (empty on failure)."""
    try:
        time.sleep(0.2)
        resp = _SESSION.get(url, timeout=30)
        if resp.status_code != 200 or len(resp.text) < 500:
            logger.warning(f"  Page fetch failed for {url} (status={resp.status_code})")
            return ""
        if "Redirecting" in resp.text:
            logger.warning(f"  Page redirected for {url}")
            return ""
        return _extract_rsc_stream(resp.text)
    except Exception as exc:
        logger.warning(f"  Page fetch error for {url}: {exc}")
        return ""


def _format_price_range(price_range: dict[str, Any]) -> str:
    """Format a Shopify price range into a human-readable string."""
    min_p = price_range.get("minVariantPrice", {})
    max_p = price_range.get("maxVariantPrice", {})
    amount_min = min_p.get("amount")
    amount_max = max_p.get("amount")
    currency = min_p.get("currencyCode", "GBP")

    symbol = _currency_symbol(currency)
    if amount_min is None:
        return ""
    if amount_min == amount_max:
        return f"{symbol}{_fmt_amount(amount_min)}"
    return f"{symbol}{_fmt_amount(amount_min)} – {symbol}{_fmt_amount(amount_max)}"


def _currency_symbol(code: str) -> str:
    return {"GBP": "£", "USD": "$", "EUR": "€"}.get(code, code + " ")


def _fmt_amount(amount: str) -> str:
    """Strip trailing ``.0`` but keep two decimals otherwise."""
    try:
        val = float(amount)
        if val == int(val):
            return f"{val:.0f}.00"
        return f"{val:.2f}"
    except (TypeError, ValueError):
        return str(amount)


def parse_product(handle: str) -> dict[str, Any]:
    """Fetch a single product (API + page metafields) and return a result dict."""
    url = PRODUCT_URL_TEMPLATE.format(handle=handle)
    result: dict[str, Any] = {
        "url": url,
        "handle": handle,
        "title": "",
        "vendor": "",
        "price": "",
        "description": "",
        "ingredients": "",
        "suggested_use": "",
        "markdown": "",
        "status": None,
        "errors": [],
    }

    data = _gql(_DETAIL_QUERY, {"handle": handle})
    if data is None or data.get("product") is None:
        result["errors"].append("Storefront API returned no product")
        return result

    product = data["product"]
    result["title"] = product.get("title", "")
    result["vendor"] = product.get("vendor", "")
    result["status"] = 200
    result["price"] = _format_price_range(product.get("priceRange", {}))
    result["description"] = html_to_markdown(product.get("descriptionHtml") or "")

    stream = _fetch_page_rsc(url)
    if stream:
        refs = _resolve_t_references(stream)
        meta = _extract_metafields(stream, refs)

        raw_ingredients = meta.get("ingredients", "")
        result["ingredients"] = html_to_markdown(raw_ingredients) if raw_ingredients else ""

        raw_use = meta.get("suggested_use", "")
        result["suggested_use"] = html_to_markdown(raw_use) if raw_use else ""
    else:
        logger.warning(f"  No RSC stream for {handle} — metafields will be empty")

    return result


def render_markdown(result: dict[str, Any]) -> str:
    """Render a parsed product result into the final Markdown document."""
    title = result.get("title") or result.get("handle", "Unknown Product")
    vendor = result.get("vendor", "")
    url = result.get("url", "")
    price = result.get("price", "")

    lines: list[str] = [f"# {title}", "", f"> Source: {url}", ""]

    meta_lines: list[str] = []
    if vendor:
        meta_lines.append(f"**Brand:** {vendor}")
    if price:
        meta_lines.append(f"**Price:** {price}")
    if meta_lines:
        lines.append(" | ".join(meta_lines))
        lines.append("")

    def _section(heading: str, body: str) -> None:
        if body and body.strip():
            lines.append(f"## {heading}")
            lines.append("")
            lines.append(body.strip())
            lines.append("")

    _section("Description", result.get("description", ""))
    _section("Ingredients", result.get("ingredients", ""))
    _section("Suggested Use", result.get("suggested_use", ""))

    return "\n".join(lines).rstrip() + "\n"
