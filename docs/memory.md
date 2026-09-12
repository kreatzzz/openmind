# Memory model

Status: full-product proposal. The [engineering preview](prototype.md#remembered-context-controls) implements source-backed records, corrections, and source-message-scoped forgetting; relationships, semantic retrieval, and topic-wide forgetting remain proposed. The graph provides continuity across conversations. It is not a psychological diagnosis, a simulation of a human mind, or a store of model chain-of-thought.

## What the graph represents

Store people, life events, recurring topics, goals, preferences, and coping approaches as nodes with typed relationships. Keep exact facts and tentative interpretations separate. For example, a synthetic user saying "I moved in March and have barely seen my friends since" supports a move event and a report of reduced contact. It does not establish that the move caused depression.

Use short, explicit records with provenance. The model proposes additions; the application decides which operations are valid. The graph is internal by default, while a separate remembered-facts view supports user correction and forgetting. This access policy is a proposal pending the owner's decision.

## Logical schema

Internal memory and user-facing notes are separate records in the same encrypted vault. The user notebook contains source-linked takeaways and agreed next steps, with editing and deletion controls. It is not a dump of the graph. One structured follow-up call proposes both patches; see [turn processing](turn-processing.md).

All personal fields, search indexes, and embeddings live in the encrypted vault. Random identifiers are scoped to the profile. Timestamps distinguish when something happened from when Openmind learned it.

| Table | Main fields and constraints |
| --- | --- |
| `profiles` | ID, creation time, locale, memory preferences, schema version |
| `sessions` | ID, profile ID, state, start/end times, optional planned-session ID |
| `messages` | ID, session ID, logical turn ID, role, content, timestamp, revision, response status; unique accepted assistant message per turn |
| `turn_attempts` | Attempt ID, logical turn ID, provider/config version, model fingerprint, policy version, state, redacted failure code |
| `memory_nodes` | ID, profile ID, kind, short statement, evidence status, salience, created/updated times, validity dates, revision, active/superseded state |
| `memory_edges` | ID, source/target node IDs, relationship type, evidence status, validity dates; endpoints must share profile |
| `evidence` | Memory record ID, source message ID and revision, optional character span, extraction job ID; source must exist |
| `session_summaries` | Session ID, summary, source revision set, model/policy versions; invalidatable derived data |
| `user_notes` | ID, profile/session ID, kind, text, proposed/agreed state, generated/user/edited authorship, revision, source coverage; user edits protected from automatic overwrite |
| `user_note_evidence` | Note ID/revision, visible source message ID/revision, evidence role; distinguish user disclosure, accepted agreement, and assistant proposal |
| `embeddings` | Memory ID/revision, embedding model fingerprint, dimensions, vector; delete or rebuild on source changes |
| `memory_jobs` | Job ID, contiguous source range/revisions, graph/notebook revisions, privacy epoch, provider consent/config version, model/schema version, status, retry count; covers both note sets |
| `memory_changes` | Operation ID, affected record IDs, reason code, revision, originating job; avoid duplicate sensitive text |
| `forget_rules` | ID, minimal user-approved topic/person selector, scope, timestamp; explain that a minimal exclusion is retained |
| `planned_sessions` | ID, recurrence, timezone, DST behavior, next occurrence, reminder preference |
| `settings` | Profile preferences and non-secret provider metadata; credential references only |

Store node and edge evidence in a representation with enforceable foreign keys, such as separate evidence join tables. The table above is conceptual, not migration SQL. Every derived record needs traceable source dependencies so deletion is reliable.

Node kinds begin with `person`, `event`, `topic`, `goal`, `preference`, and `coping_strategy`. Relationships begin with `involves`, `related_to`, `precedes`, `supports_goal`, and `user_reports_trigger`. Do not introduce `causes`, diagnosis labels, personality scores, or relationship judgments as default types.

Evidence states are `user_reported`, `user_confirmed`, and `inferred`. User-reported information is attributed to the user's account, not independently verified. A numerical model confidence score is not a probability of truth. Use qualitative confidence and source count, and never promote an inference just because the model repeats it.

## Example graph

This example is invented and should remain synthetic in public fixtures.

```mermaid
graph LR
    E[Moved to a new city in March]
    T[User reports less contact with friends]
    G[Wants to reconnect with friends]
    P[Prefers practical suggestions after being heard]
    E ---|related to, tentative| T
    T ---|related to| G
    P ---|supports goal| G
```

The tentative edge is an interpretation. On a later visit, the assistant might ask whether reconnecting still matters. It should not announce a diagnosis or assume the original context has stayed unchanged.

## Write pipeline

1. Extract from a small, identified set of committed user messages and explicitly accepted user corrections. Assistant suggestions alone are not evidence about the user's life.
2. Give the extractor a schema, bounded existing node candidates, evidence IDs, and a maximum operation count. Start with at most 12 operations per job and 400 characters per statement; measure whether those limits preserve meaning.
3. Accept only `create_node`, `update_node`, `link_nodes`, and `supersede_record` proposals. User-initiated deletion uses a separate deterministic application path. The extractor cannot erase history or change policy.
4. Validate JSON shape, allowed types, source existence, matching message revisions, profile ownership, length limits, and graph revision. Reject unsupported IDs and dangling edges.
5. Require evidence for every accepted record. Quoted spans can be checked mechanically. Whether a paraphrase follows from evidence still needs model evaluation and sampled human review; schema validity does not prove truth.
6. Resolve duplicates conservatively. Match stable IDs or user-confirmed aliases. Similar names do not justify merging two people. Keep conflicting reports with dates and provenance.
7. Validate the paired user-notebook patch, including source support and user-edit revisions. Apply both accepted patches in one transaction, with an idempotency key from source revisions, extractor version, and model fingerprint. Either patch failing rejects the combined commit. A conflict requires re-evaluation against current sources, not overwriting newer records.
8. Update the encrypted search index. Embedding work is optional and uses the same revision checks. Emit only a coarse user-facing status, not the raw patch.

A bounded retry may repair formatting errors. Repeated failures mark both note updates unavailable for that configuration until retested; the UI must not imply they succeeded. Chat-only operation may remain available in development, but does not meet the clinical three-result workflow. A model's request for more access never changes its permissions. Evaluate every submitted turn for updates, allowing empty patches and respecting memory-off preferences.

No speculative overnight "analysis" pass. Consolidation may shorten redundant supported facts when the app is unlocked and idle. It must retain provenance and not invent a stronger conclusion.

## Retrieval

Start with SQL full-text search over short memory statements and indexed people/topics. Search only the active profile. Retrieve a bounded seed set, then expand at most two graph hops with a hard node cap. Start testing with 20 seeds and 40 total candidates.

Rank by query relevance, evidence quality, recency where relevant, and user-designated importance. Stable preferences should not expire merely because they were mentioned long ago. User-confirmed corrections outrank older conflicting statements. Include ambiguity when it matters.

Optionally combine semantic retrieval later. Store embeddings inside SQLCipher and use an in-process similarity scan over a bounded personal-memory set first. A separate vector server is unnecessary. Profile actual vault sizes before adding an extension or approximate index.

Embeddings are sensitive derived data. Keep model fingerprints and vector dimensions with each record, never compare vectors from different model spaces, and rebuild when changing the embedding model. Prefer local embeddings even when chat is remote. Ollama offers an [embedding endpoint](https://docs.ollama.com/api/embed); selecting a model and its quality thresholds requires evaluation.

Fit the final memory bundle to the model's token budget. Each selected statement includes its evidence state, relevant date, and a compact source reference. The model receives a selection, never the full database or direct database credentials.

## Corrections and forgetting

Users can view concise remembered facts, correct an assumption, forget a person or topic, delete a session, disable memory for a conversation, or reset the entire vault. Raw speculative records are not shown in the ordinary UI, but the product must explain that internal records exist and what they do.

For a correction, preserve dated conflicting evidence only where needed for meaning, mark the older interpretation superseded, and invalidate derived summaries and embeddings. When the user says "that was a coworker, not my brother," the application must repair relationships as well as labels.

For forgetting, calculate the dependency set from evidence before committing the deletion. Remove affected nodes, edges, summaries, generated notebook entries, search entries, embeddings, pending jobs, and duplicated content in change records. Show affected user-written or edited notes and include them in the user's selected deletion scope; do not silently overwrite them. Derived records with mixed sources must be dropped and rebuilt from permitted sources before reuse. Cancel active work and reject late outputs whose source revision, graph/notebook revision, or privacy epoch is stale. Topic exclusions also cover retained notebook text so it cannot reintroduce a forgotten fact.

Forgetting a topic has two distinct choices. "Remove this from memory" can retain the transcript but must exclude affected source spans or messages from future retrieval and extraction. "Delete this history too" removes the affected source content. The UI explains the difference before applying the operation. A minimal forget rule may be needed to prevent relearning from retained history; the user can inspect and remove that rule.

A session with memory disabled contributes no persistent graph records. User-notebook saving is a separate visible preference. A private session avoids durable transcript and generated-notebook storage and uses only explicitly permitted existing context; its work queue is transient. Private mode cannot control provider logs, system crash dumps, or screenshots; its wording must be precise.

Deletion applies to the active vault. Old backups and remote provider copies need separate treatment; see [privacy](privacy.md). Do not promise secure physical overwrite on an SSD. Rebuilding a live database can remove obsolete accessible records without proving deletion from every disk snapshot.

## Evaluation targets

These are proposed acceptance gates, not measured results.

- Zero cross-profile reads, dangling evidence references, or stale writes after deletion in deterministic tests.
- Zero reintroduction of forgotten synthetic facts through retained summaries, jobs, search, or embeddings in regression tests.
- At least 98% of accepted factual records supported by cited sources in a held-out set of 200 human-reviewed candidates. Report the sample and uncertainty, not just the percentage.
- At least 90% retrieval recall on 100 annotated continuity questions within the chosen context budget, with no more than 10% irrelevant selected records by human judgment.
- Every inference is labeled internally, every correction survives restart, and invalid extraction output leaves the previous graph unchanged.
- Every generated user note cites visible source evidence; suggestions are not recorded as commitments without agreement, and a concurrent user edit survives generation.
- An invalid patch in either branch leaves both note sets unchanged; retries and coalesced jobs cover each submitted source turn exactly once per revision.
- Include ambiguous names, changes over time, sarcasm, hypothetical stories, quotes about other people, malicious instructions inside memories, and indirect references.

Failure on factual support should reduce what is written or disable extraction for that model. It should not be addressed by making the graph more elaborate.
