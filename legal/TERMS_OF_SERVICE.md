# Terms of Service

**Last Updated:** February 19, 2026

**Effective Date:** February 19, 2026

---

## 1. What This Service Is

feed.corgi.network ("the Service") is an experimental, community-governed Bluesky custom feed operated by Andrew Nordstrom ("Operator," "I," "me"). It is part of an open-source research project exploring whether communities can meaningfully govern their own algorithms.

The Service consists of:

- A **custom Bluesky feed** that ranks public posts using community-voted weights
- A **governance interface** where authenticated subscribers vote on ranking behavior and content rules
- A **transparency dashboard** showing current algorithm weights, score breakdowns, and redacted audit history
- A **bot account** (@corgi-network.bsky.social) that posts governance announcements to Bluesky

The source code is publicly available under the MIT License at the project's GitHub repository. The MIT License covers the software. These Terms cover your use of the hosted Service.

## 2. Acceptance of Terms

By authenticating with the Service to vote, or by subscribing to the feed through Bluesky, you agree to these Terms. If you do not agree, do not authenticate or subscribe.

By using the Service, you represent that you are at least 18 years old or the age of majority in your jurisdiction, whichever is greater.

You must have a valid Bluesky account to use governance features. You are responsible for compliance with Bluesky's own Terms of Service.

## 3. Authentication and Credentials

To vote on governance, you authenticate using your **Bluesky handle and an app password**.

Here is exactly what happens with your credentials:

- Your handle and app password are transmitted over HTTPS to the Service
- The Service forwards them to Bluesky's servers (`bsky.social`) to verify your identity
- **Your app password is never stored.** It is used only for the verification call and immediately discarded
- On successful verification, a session cookie is created (valid for 24 hours) so you do not need to re-authenticate for each action
- The session cookie is HttpOnly (not accessible to JavaScript), Secure (HTTPS only in production), and SameSite=lax

**You should use a Bluesky app password, not your main account password.** App passwords can be created and revoked independently in your Bluesky account settings. The Service cannot enforce this, but strongly recommends it.

## 4. What You Can Do

As an authenticated subscriber, you can:

- **Vote on ranking weights** for five scoring components: recency, engagement, bridging, source diversity, and relevance
- **Vote on content rules** by proposing include or exclude keywords that filter what posts appear in the feed
- **View transparency data** including current weights, score decompositions for individual posts, and redacted audit history

Your votes are aggregated with other subscribers' votes using a trimmed mean (top and bottom 10% removed). Keywords require at least 30% voter support to become active. A maximum of 20 keywords per category are allowed, each up to 50 characters.

## 5. How Governance Affects the Feed

This is important to understand: **your collective votes directly determine what content appears in the feed and what is hidden.**

- Adjusting weights changes how posts are ranked (e.g., prioritizing recency over engagement)
- Exclude keywords cause posts containing those terms to be completely hidden from the feed
- Include keywords, if any are active, restrict the feed to only posts containing at least one of those keywords

This means coordinated voting can meaningfully alter what content is surfaced or suppressed. The trimmed mean aggregation mitigates individual outlier manipulation, but does not prevent coordinated group action.

The Operator reserves the right to intervene in governance outcomes if they result in clear abuse — such as coordinated Sybil attacks, automated vote manipulation, or votes that produce illegal content filtering outcomes — but makes no guarantee of doing so.

## 6. Bot Account

The Service operates a bot account (@corgi-network.bsky.social) on Bluesky that posts public announcements about governance events, including when voting opens and closes, aggregate vote outcomes, weight changes, and keyword changes.

The bot is broadcast-only. It does not reply to posts, follow users, send direct messages, or interact with any user content. The bot does not post any personally identifiable information about individual voters. Bot announcements reflect aggregate community governance outcomes and do not constitute endorsement, approval, or adoption of those outcomes by the Operator.

## 7. Research Use

This Service is part of a research project investigating community algorithmic governance. The research and the Service are related but separate:

- **Using the Service** (voting, subscribing) is governed by these Terms.
- **Participating in research** requires separate, affirmative consent provided through a dedicated research consent form presented during or after account authentication.

You may use the Service without consenting to research participation. If you decline research consent, you can still vote and subscribe to the feed. Your data will be used only for Service operation (governance aggregation, feed ranking, audit logging) and will be excluded from any research analysis or publication.

If you provide research consent, your participation data (including your Bluesky DID, vote weights, keyword preferences, vote timestamps, and governance outcomes) may be analyzed and included in research outputs. Research publications will use aggregated or de-identified data. Individual voting behavior will not be attributed to identifiable users without additional explicit consent obtained directly from you.

You may withdraw research consent at any time by contacting hello@corgi.network. Withdrawal applies to future research use only — data already included in completed analyses or published findings prior to withdrawal cannot be retracted. The append-only audit log means your vote records will remain in the system for Service operation purposes regardless of research consent status (see Section 9).

This research may be subject to Institutional Review Board (IRB) oversight. If applicable, the IRB protocol number and reviewing institution will be posted on the Service.

## 8. Service Availability and Warranty

**The Service is provided "as is" with no warranties of any kind**, express or implied, including but not limited to merchantability, fitness for a particular purpose, or non-infringement.

The Service depends on external infrastructure (Bluesky's API, Jetstream, the Operator's hosting) and may be unavailable, slow, or discontinued at any time without notice. There is no service level agreement.

The Operator is not responsible for:

- Feed downtime or ranking inaccuracies
- Content surfaced or hidden as a result of community governance votes
- Actions taken by Bluesky or any third party
- Loss of data, votes, or session state
- Any decisions you make based on content ranked by this feed

The Operator may discontinue or permanently shut down the Service at any time. In the event of a planned shutdown, the Operator will make reasonable efforts to provide at least 30 days' notice via the bot account and the Service itself. Upon shutdown, the Operator will delete stored personal data (subscriber records, vote records, session data) within 90 days, except for data required to fulfill ongoing research obligations for which consent was previously obtained, and except for the append-only audit log, which may be retained in anonymized or de-identified form for research archival purposes.

## 9. Data Retention and Deletion

All governance data (votes, epochs, audit log entries, subscriber records) is stored indefinitely in PostgreSQL. The governance audit log is append-only and architecturally immutable — it cannot be modified or deleted, even by the Operator. To the extent that GDPR or similar privacy laws apply, the Operator relies on Article 17(3)(d) (archiving in the public interest and scientific research purposes, per Article 89(1)) as the legal basis for retaining audit log data that would otherwise be subject to erasure requests.

Sessions are stored in Redis and automatically expire after 24 hours.

**There is currently no mechanism to delete your voting history or subscriber record.** If you want to stop participating, you can unsubscribe from the feed in Bluesky and stop authenticating. Your historical vote data will remain in the system.

When content is deleted on Bluesky, the Service marks it as deleted (soft delete) but retains the underlying record for referential integrity. Soft-deleted content is never surfaced in the feed or displayed on the transparency dashboard.

The Operator is working toward providing a data deletion process. Until one exists, by using the governance features you accept that your participation data will be retained.

## 10. Acceptable Use

You agree not to:

- Attempt to manipulate governance outcomes through automated voting, fake accounts, or Sybil attacks
- Abuse rate limits or attempt to circumvent access controls
- Use the Service to intentionally suppress legitimate speech or surface harmful content through governance votes
- Reverse engineer or attack the Service infrastructure
- Misrepresent your identity or impersonate others

The Operator reserves the right to suspend or terminate access to the Service for violations of these Terms.

## 11. Rate Limits

The Service enforces rate limits to prevent abuse. If you exceed them, you will receive HTTP 429 responses with a retry-after value. Limits include:

- Login: 10 requests per minute
- Voting: 20 requests per minute
- General API: 200 requests per minute

These limits may change without notice.

## 12. Limitation of Liability

**To the maximum extent permitted by applicable law, the Operator shall not be liable for any indirect, incidental, special, consequential, or punitive damages**, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from:

- Your use of or inability to use the Service
- Content ranked, surfaced, or hidden by the feed
- Any governance outcome or algorithm change
- Unauthorized access to or alteration of your data
- Any third-party conduct on the Service

**The Operator's total liability for any claim arising from these Terms or the Service is limited to zero dollars ($0.00).** This is a free, experimental, open-source research project.

## 13. Indemnification

You agree to indemnify and hold harmless the Operator from any claims, damages, losses, liabilities, and expenses (including reasonable attorneys' fees) arising from your use of the Service, your violation of these Terms, or your violation of any rights of another party.

## 14. Content and Copyright

The Service re-ranks and displays public content from the Bluesky / AT Protocol network. The Operator does not host, create, or control this content.

If you believe content surfaced by the feed infringes your copyright or other rights, you may submit a takedown request to hello@corgi.network. Include: identification of the copyrighted work, the specific post URI, your contact information, and a statement that you have a good faith belief the use is not authorized. The Operator will make reasonable efforts to respond within 30 days.

Note: The Service does not currently have a DMCA designated agent registered with the U.S. Copyright Office. The Operator intends to complete this registration. In the meantime, all copyright-related inquiries should be directed to hello@corgi.network.

The Operator is not liable for content created by third parties on the Bluesky network.

## 15. International Users and Jurisdiction

The Service is operated from the United States by an individual based in Colorado. It is not specifically directed at residents of the European Union, European Economic Area, United Kingdom, or any other jurisdiction.

The Operator processes data under US law. To the extent that international privacy laws (including GDPR) apply, the Operator relies on legitimate interest as the legal basis for processing governance participation data necessary to operate the Service, and on consent for research use (see Section 7). The append-only audit log is maintained under the research exemption provisions where applicable.

If you are located outside the United States, you acknowledge that your data will be transferred to and processed in the United States.

## 16. Administrator Access

The Operator is currently the sole administrator of the Service. Administrator access is controlled by a DID allowlist (`BOT_ADMIN_DIDS`) and is not shared with any third parties.

Administrators have access to unredacted governance data, including voter DIDs associated with specific votes. This access is used only for Service operation, abuse prevention, and authorized research (with appropriate consent). If additional administrators are added, this section will be updated.

## 17. Changes to These Terms

The Operator may modify these Terms at any time. Material changes will be posted on the Service and announced via the bot account. Continued use of the Service after changes constitutes acceptance of the modified Terms.

## 18. Governing Law and Dispute Resolution

These Terms are governed by and construed in accordance with the laws of the State of Colorado, United States, without regard to conflict of law principles.

Any dispute arising from these Terms or your use of the Service shall be resolved exclusively in the state or federal courts located in Colorado. You consent to the personal jurisdiction of such courts.

The Operator and you each waive the right to participate in a class action lawsuit or class-wide arbitration related to the Service.

## 19. Colorado Privacy Act

The Colorado Privacy Act (C.R.S. § 6-1-1303 et seq.) applies to entities that control or process personal data of 100,000 or more Colorado consumers annually, or that derive revenue from the sale of personal data and control data of 25,000 or more consumers. The Service does not meet either threshold, does not sell personal data, and does not derive revenue from personal data. The Operator will reassess applicability if the Service's scope materially changes.

## 20. Data Breach Notification

In the event of a security breach affecting your personal information, the Operator will notify affected users in accordance with Colorado's breach notification statute (C.R.S. § 6-1-716), which requires notification within 30 days of determining a breach has occurred. Notification will be provided via the email or contact method available, or via conspicuous posting on the Service if no direct contact method is available. If 500 or more Colorado residents are affected, the Operator will also notify the Colorado Attorney General.

## 21. Entire Agreement

These Terms, together with the Privacy Policy and (if applicable) the Research Consent Form, constitute the entire agreement between you and the Operator regarding the Service. No other representations, statements, or agreements — whether made on GitHub, Bluesky, or elsewhere — create additional binding obligations unless incorporated by reference into these Terms.

## 22. Severability

If any provision of these Terms is found unenforceable, the remaining provisions will continue in full force and effect.

## 23. Contact

For questions about these Terms, contact: hello@corgi.network

For security vulnerabilities, follow the responsible disclosure process described in the project's SECURITY.md.
