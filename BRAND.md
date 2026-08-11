# Corgi Brand and Naming

Status: canonical

Last updated: 2026-08-10

This document defines how the project names its product, live feed, publisher,
and research artifact. It is the source of truth for product copy, repository
metadata, documentation, conference materials, and developer packages.

## Brand architecture

| Role | Canonical name | Use |
|---|---|---|
| Product and system | **Corgi** | UI wordmark, navigation, product prose, CLI, and normal conversation |
| Live flagship feed | **Corgi Commons** | The public Bluesky feed and the concrete RecSys demonstration surface |
| Organization and publisher | **Corgi Network** | Footer, About and publisher language, email identity, domains, and developer namespaces |
| Research artifact | **CORGI** | Paper titles, citations, posters, and other academic references |
| Current descriptor | **Community-governed feeds for Bluesky** | First-touch discovery surfaces such as page titles, repository descriptions, social previews, and conference boilerplate |

The internal rule is:

> Corgi is the product. Corgi Commons is the feed. Corgi Network is the
> organization. CORGI is the research name.

## Surface rules

- Keep the visible product header and wordmark as **Corgi**.
- Preserve the homepage hero language. A first-touch surface may establish the
  descriptor above the fold or in metadata; the H1 does not need to repeat it.
- Use **Corgi** after the first descriptive mention on a page.
- Use **Corgi Commons** only for the live shared feed, its frozen demo corpus,
  or direct discussion of that feed.
- Use **Corgi Network** for publisher and namespace contexts. Do not randomly
  substitute it for the product name inside the UI.
- Use **CORGI** only for the research name, including the accepted title
  *CORGI: Communal Feed Governance for Bluesky*.
- Do not describe Corgi as an open self-serve network or a mature multi-tenant
  platform while production remains a limited governance pilot for one public
  feed.

Preferred first-touch copy:

> **Corgi** — Community-governed feeds for Bluesky.

Preferred concrete description:

> Corgi Commons is Corgi's live community-governed Bluesky feed. Corgi is an
> open-source project from Corgi Network.

## Canonical identifiers

| Surface | Identifier |
|---|---|
| Product home | `https://feed.corgi.network` |
| Brand domain | `https://corgi.network` |
| Documentation | `https://docs.corgi.network` |
| Source permalink | `https://corgi.network/code` |
| GitHub repository | `andrewnordstrom-eng/corgi` |
| Target developer namespace (gated) | `@corgi-network` |
| Target feed SDK package (gated) | `@corgi-network/feed-sdk` |
| Bluesky identity | `corgi-network.bsky.social` |
| Flagship feed | `Corgi Commons` |

The GitHub organization and npm namespace are availability-setting gates, not
facts to claim before successful registration. The GitHub repository remains in
`andrewnordstrom-eng` through the RecSys release window; a future organization
transfer requires a separate integration plan. Until npm registration and an
atomic lockfile migration are complete, the repository continues to use the
existing local `@corgi/feed-sdk` package name.

## Voice and visual character

Corgi should feel warm, direct, and technically credible. Personality lives in
small, deliberate doses: the mark, the name, the warm palette, and occasional
restrained microcopy. Everywhere else, speak plainly about weights, votes,
policy, rankings, and receipts.

- Prefer concrete explanations over slogans.
- Name boundaries between production, demo, simulation, and planned work.
- Avoid exaggerated claims about adoption, fairness, decentralization, or
  strategic robustness.
- Avoid excessive dog jokes, mascot decoration, or childish language.
- Do not flatten the existing product into a generic research-dashboard style.

## Acronym and capitalization

Do not present a marketing backronym for Corgi. In particular, do not describe
the product as “short for Community-Oriented Recommendation: Governance and
Infrastructure.” The accepted paper title already supplies the authoritative
research context without asking product users to decode the name.

- `Corgi`: product and normal prose
- `Corgi Commons`: live feed
- `Corgi Network`: organization and publisher
- `CORGI`: research artifact
- `corgi`: repository slug and other lowercase technical identifiers

## Collision registry

Known adjacent uses include Corgi Insurance, Party Corgi Network, UK CORGI and
CORGI Trade, and numerous dog, AI, developer-tool, and crypto projects. These
uses do not require abandoning the accepted research name. They do require:

- descriptive first-touch copy instead of relying on the bare name for search;
- consistent links between the website, source, paper, Bluesky identity, and
  package namespace; and
- professional trademark clearance before incorporation, fundraising, or
  material commercial investment under Corgi or Corgi Network.

Search position is not a brand fact. Do not record a one-engine or personalized
ranking as durable evidence that a query is owned.

## Change control

Changes to this architecture require an explicit product decision. Routine copy
work should apply these rules rather than inventing new variants. Historical
receipts, dated lab records, and old commit references retain the identifiers
that were true when they were created.
