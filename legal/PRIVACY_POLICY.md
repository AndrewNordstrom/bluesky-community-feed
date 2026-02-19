# Privacy Policy

**Last Updated:** February 19, 2026

**Effective Date:** February 19, 2026

---

## Overview

feed.corgi.network ("the Service") is operated by Andrew Nordstrom ("Operator"). This Privacy Policy explains what data the Service collects, how it is used, and what choices you have.

This is a small, open-source research project — not a commercial product. The codebase is publicly auditable. The Service uses no advertising, no analytics services, and no tracking pixels.

---

## What Data We Collect

### If You Subscribe to the Feed (No Authentication Required)

When Bluesky requests the feed on your behalf, the Service records:

| Data | Purpose | Storage |
|------|---------|---------|
| Your Bluesky DID | Identify subscriber | PostgreSQL, indefinite |
| First seen / last seen timestamps | Track subscriber activity | PostgreSQL, indefinite |

Your DID is a public Bluesky identifier. No additional personal information is collected from feed subscribers.

### If You Authenticate to Vote

When you log in to participate in governance, the Service additionally collects:

| Data | Purpose | Storage |
|------|---------|---------|
| Bluesky handle | Display during session | Redis only, 24-hour expiry |
| App password | Verify identity via Bluesky API | **Never stored** — used once and discarded |
| Vote weights (5 numerical values) | Governance aggregation | PostgreSQL, indefinite |
| Keyword preferences (include/exclude) | Content rule voting | PostgreSQL, indefinite |
| Vote timestamp | Audit trail | PostgreSQL, indefinite |
| Bluesky DID (as voter) | Link votes to identity | PostgreSQL, indefinite |
| Governance actions | Append-only audit log | PostgreSQL, indefinite, immutable |

### Public Bluesky Data Ingested

The Service ingests public data from the Bluesky network via Jetstream to build the feed:

| Data | Source |
|------|--------|
| Public posts (text, metadata, timestamps) | app.bsky.feed.post |
| Public likes | app.bsky.feed.like |
| Public reposts | app.bsky.feed.repost |
| Public follows | app.bsky.graph.follow |

This is all publicly available data on the AT Protocol network. The Service does not access private messages, muted/blocked lists, or any non-public data.

### What We Do NOT Collect

- IP addresses are **not stored** in any database. They are used ephemerally for rate limiting and discarded.
- We do not use cookies for tracking. The only cookie is the governance session cookie (HttpOnly, 24-hour expiry).
- We do not use any analytics services (no Google Analytics, Mixpanel, Segment, Sentry, or similar).
- We do not collect device information, browser fingerprints, or location data.
- We do not collect or process your main Bluesky password.

---

## How We Use Your Data

Your data is used for:

1. **Feed ranking** — Public post and engagement data is scored and ranked according to community-voted weights.
2. **Governance** — Your votes are aggregated to determine ranking weights and content filtering rules.
3. **Audit and transparency** — Governance actions are logged. Public transparency endpoints expose aggregate data with voter identities redacted. The admin interface shows unredacted voter DIDs to authorized administrators only.
4. **Research** — With your separate consent, participation data may be used for academic research on algorithmic governance (see Research Use below).

---

## Third-Party Data Sharing

### Bluesky (bsky.social)

When you authenticate, your handle and app password are sent to Bluesky's servers for verification. This is the only time user credentials leave the Service. The Operator does not control Bluesky's handling of this data — refer to Bluesky's own Privacy Policy.

### No Other Third Parties

The Service does not share, sell, or transmit your data to any other third party. There are no advertising partners, data brokers, analytics providers, AI/ML services, CDNs, or error tracking services.

All scoring, ranking, aggregation, and data processing happens locally on the Operator's infrastructure.

---

## Data Retention

| Data | Retention Period | Deletion Method |
|------|-----------------|-----------------|
| Session cookies (Redis) | 24 hours | Automatic expiry |
| Feed ranking cache (Redis) | 5 minutes | Automatic expiry |
| Content filter cache (Redis) | 5 minutes | Automatic expiry |
| Subscriber records (PostgreSQL) | Indefinite | No automated purge |
| Vote records (PostgreSQL) | Indefinite | No automated purge |
| Audit log (PostgreSQL) | Indefinite | **Cannot be deleted** (append-only, database-enforced) |
| Ingested post/engagement data (PostgreSQL) | Indefinite | Soft delete only (marked as deleted, not erased) |

When content is deleted on Bluesky, the Service marks it as deleted (soft delete) but retains the record for referential integrity. Soft-deleted content is never surfaced in the feed or displayed on the transparency dashboard. This is consistent with how the AT Protocol handles deletions.

---

## Data Deletion and Your Rights

**There is currently no self-service mechanism to delete your voting history, subscriber record, or audit log entries.** The governance audit log is architecturally immutable — it is enforced at the database level and cannot be modified even by the Operator. To the extent that GDPR or similar privacy laws apply, the Operator relies on Article 17(3)(d) (archiving in the public interest and scientific research purposes, per Article 89(1)) as the legal basis for retaining audit log data that would otherwise be subject to erasure requests.

If you want to stop participating:

- Unsubscribe from the feed in your Bluesky client
- Stop authenticating with the Service
- Your session will expire within 24 hours

Your historical participation data will remain in the system. The Operator intends to implement a data export and deletion process for non-audit-log data in the future.

If you have questions or concerns about your data, contact the Operator at hello@corgi.network. The Operator will make best efforts to respond within 30 days.

---

## Research Use

This Service is part of a research project investigating community algorithmic governance. Research participation is **separate from Service use** and requires affirmative consent.

**If you consent to research:** Your participation data (including your Bluesky DID, vote weights, keyword preferences, vote timestamps, and governance outcomes) may be analyzed and included in research outputs. Research publications will use aggregated or de-identified data. Individual voting behavior will not be attributed to identifiable users without additional explicit consent.

**If you do not consent to research:** You may still use the Service. Your data will be used only for Service operation (governance aggregation, feed ranking, audit logging) and will be excluded from research analysis and publications.

**Research consent is collected separately** through a dedicated consent form presented during or after authentication. You may withdraw research consent at any time by contacting hello@corgi.network. Withdrawal applies to future research use — data already included in completed analyses or published findings prior to withdrawal cannot be retracted.

Your Bluesky DID is a public identifier. While the transparency dashboard redacts voter identities, the raw data stored internally includes DIDs associated with votes.

This research may be subject to Institutional Review Board (IRB) oversight. If applicable, the IRB protocol number and reviewing institution will be posted on the Service.

---

## Transparency and Public Data Exposure

The Service operates a public transparency dashboard. Data presented on the transparency dashboard is provided for informational purposes only and without guarantee of accuracy, completeness, or timeliness. Here is what is and is not publicly visible:

**Publicly visible (no authentication required):**

- Current governance weights and epoch history
- Aggregate vote counts (how many people voted, not who or how)
- Score breakdowns for individual posts
- Redacted audit log (voter identities removed, vote details summarized)

**Not publicly visible:**

- Individual voter identities
- Individual vote weights or keyword preferences
- Voter DIDs linked to specific governance actions

**Visible to administrators only:**

- Unredacted audit log entries including voter DIDs
- The Operator is currently the sole administrator. Administrative access is controlled by a DID allowlist and is not shared with any third parties. If additional administrators are added, this section will be updated.

---

## Cookies

The Service uses a single cookie:

| Cookie | Purpose | Type | Duration |
|--------|---------|------|----------|
| `governance_session` | Maintain authenticated session | HttpOnly, Secure, SameSite=lax | 24 hours |

This cookie is strictly functional. It is not used for tracking, analytics, or advertising. No third-party cookies are set.

---

## Security

The Service implements the following security measures:

- HTTPS encryption for all traffic (via reverse proxy)
- HttpOnly session cookies (not accessible to JavaScript)
- Security headers via Helmet.js (CSP, referrer policy, frame protection)
- Rate limiting on all endpoints
- Admin access restricted to a DID allowlist
- No storage of passwords or sensitive credentials
- Parameterized SQL queries (no SQL injection surface)
- Input validation via Zod on all routes

For the full security posture, see the project's SECURITY.md in the public repository.

---

## International Users

The Service is operated from the United States by an individual based in Colorado. It is not specifically directed at residents of the European Union, European Economic Area, United Kingdom, or any other jurisdiction outside the United States.

If you access the Service from outside the United States, your data will be transferred to and processed in the United States under US law.

To the extent that international privacy laws apply (including GDPR), the Operator relies on the following legal bases for processing:

- **Service operation** (governance aggregation, feed ranking, audit logging): Legitimate interest in operating the Service as described in these documents
- **Research use**: Consent, collected separately through the research consent form
- **Audit log retention**: Legitimate interest in governance integrity and, where applicable, the research exemption under GDPR Article 89

The append-only audit log cannot be modified or deleted due to its architectural design. This is disclosed to all users before participation.

---

## Children's Privacy

The Service is not directed at children under the age of 18. The Service does not knowingly collect data from minors. Use of the Service requires a Bluesky account, which has its own age requirements. By using the Service, you represent that you are at least 18 years old or the age of majority in your jurisdiction.

---

## Data Breach Notification

In the event of a security breach that may compromise your personal information, the Operator will:

- Conduct a prompt, good-faith investigation to determine the scope and impact of the breach
- Notify affected users within 30 days of determining a breach has occurred, consistent with Colorado's breach notification statute (C.R.S. § 6-1-716)
- Provide notification via the most practical available means (email, Bluesky, or conspicuous posting on the Service)
- Notify the Colorado Attorney General if 500 or more Colorado residents are affected

The Service does not store passwords, financial information, or government-issued identifiers (SSN, driver's license, etc.). The primary data at risk in a breach would be Bluesky DIDs (which are public identifiers) and governance voting records.

---

## Colorado Privacy Act

The Colorado Privacy Act (C.R.S. § 6-1-1303 et seq.) applies to entities that control or process personal data of 100,000 or more Colorado consumers annually, or that derive revenue from the sale of personal data and control data of 25,000 or more consumers. The Service does not meet either threshold and does not sell or derive revenue from personal data.

Regardless of CPA applicability, the Operator is committed to the data transparency and user-respect principles reflected throughout this Privacy Policy.

---

## Changes to This Policy

The Operator may update this Privacy Policy at any time. Material changes will be posted on the Service and announced via the bot account. Continued use of the Service after changes constitutes acceptance of the updated policy.

---

## Contact

For questions about this Privacy Policy or your data, contact: hello@corgi.network

For security vulnerabilities, follow the responsible disclosure process described in the project's SECURITY.md.
