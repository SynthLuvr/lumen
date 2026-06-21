# REASONING

### Language: Python for scraping, TypeScript for the CLI

Python for the scrapers. BeautifulSoup is quick to build with and the
looser typing suits ad-hoc scraping where page structures shift.
TypeScript for the CLI because I have more day-to-day familiarity with
it, and the stricter typing, lint rules, and automated tooling catch
errors earlier.

## 1. Knowledge Structure

The first decision was what data to use. I considered a PubMed MCP
server, but that introduces too much data and open questions about which
studies to include or exclude. The NHS publishes detailed, structured
condition information, so I scraped that into Markdown. For Healf, I
selected a couple hundred supplement products from the Shopify store.

This design makes adding sources easy but makes cross-source reasoning
harder. There’s no graph linking a marker to a condition to a product.
The LLM and vector similarity bridge that at query time.

## 2. Context Assembly

I use a simple RAG setup with Chroma, which is simpler than LanceDB.
Rather than a fixed retrieval pipeline, I let the LLM decide what it
needs via three tools: Healf products, NHS data, and customer data. For
example, if the user asks about iron, the LLM passes that keyword to the
tool, which pulls relevant documents from the vector database into the
prompt.

The customer’s basic profile is always included as system context. Blood
tests and wearable data are fetched on demand only when the LLM judges
them relevant.

## 3. Safety Model

Three layers, in order. First, an intent router classifies every prompt
and refuses if it detects anything malicious. Raw input never reaches
the response model. Instead it’s rewritten into a safer version and only
the sanitized prompt is passed on. Second, the system prompt says don’t
diagnose. Third, NHS results get a safety header treating them as
general reference, not a diagnosis.

**Catches:** prompt injection, off-topic requests, attempts to diagnose
or prescribe.

**Misses:** adversarial inputs that evade the classifier’s rewrite, and
harmful output the response model produces despite instructions because
there’s no post-hoc output filter.

## 4. What I Left Out

I left out extensive data sources and didn’t do much cleaning. The
customer profile is basic and not dynamic. I kept it simple for demo
purposes. More data sources and richer profiles could be easily
integrated when available. With more time: improve the UX, add
conversation history for follow-up questions and recommendations, and do
more thorough testing.

## 5. One Decision I’m Uncertain About

The data sources. More data could help answer questions better with
broader product coverage, additional health databases, and structured
nutrient information. But more data also means more noise in retrieval
and harder decisions about what to trust. I could see a richer dataset
being clearly better, or introducing quality issues that the current
small, hand-selected corpus avoids.
