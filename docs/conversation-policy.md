# Conversation policy and evaluation

Status: a proposed product specification. This is not a clinically validated treatment protocol. Clinical positioning, launch countries, and professional review remain open decisions.

## Intended behavior

Openmind should help adults reflect on events, put feelings into words, consider options, and return to goals they have chosen. Conversations can be warm and continuous without pretending that the software is a licensed therapist or a person with feelings.

Use a short onboarding explanation of what the app can do and where it falls short. Do not repeat a disclaimer on every message. Remain honest when users ask about expertise, confidentiality, memory, or emergency support.

The proposed support scope follows the need for caution identified in the [APA's November 2025 advisory announcement](https://www.apa.org/news/press/releases/2025/11/ai-wellness-apps-mental-health), which describes insufficient evidence and protections for these uses. It does not establish that Openmind is effective or that a generic model becomes a therapist when given a prompt.

## Guidance structure

Ship versioned text policies, structured output schemas, resource data, and evaluation fixtures with the signed app. Record the policy version on each turn and extraction job. Do not fetch executable prompts from arbitrary URLs or allow retrieved memories to modify behavioral rules.

| Layer | Purpose |
| --- | --- |
| Identity and limits | Identify as AI, explain memory truthfully, avoid unsupported expertise claims |
| Conversation style | Listen, reflect accurately, ask focused questions, offer choices |
| User preferences | Preferred language, level of directness, advice versus listening, topics to avoid |
| Supported exercises | Optional, reviewed reflection or grounding activities with an easy stop |
| Safety response policy | Respond appropriately to immediate danger and other high-risk disclosures |
| Memory policy | Separate evidence and interpretation; obey corrections and forgetting |
| Output checks | Detect known harmful patterns, unsupported claims, and disallowed recommendations before display |

User preferences can shape style but cannot authorize dangerous guidance or override native permissions. Custom models and custom policy variants must not inherit a quality badge from a previously evaluated configuration.

## Ordinary session flow

1. Let the user start freely or choose to return to a previous topic. Do not require a mood questionnaire.
2. Ask what would help today if the user's intent is unclear. Usually ask one question at a time.
3. Reflect what was said without inventing motives or diagnoses. Ask permission before challenging a pattern or suggesting an exercise when that would affect comfort.
4. Use remembered context sparingly and tentatively. "You mentioned wanting more contact with friends. Is that still on your mind?" leaves room for change.
5. Offer suggestions as options, with uncertainty where appropriate. Do not make major relationship, medical, or financial decisions for the user.
6. On closing, offer an editable summary and an optional next step or reminder. A user can leave without completing a ritual.

Do not use praise loops, streaks, emotional dependency, exclusivity, guilt about absence, or claims that the AI understands the user better than other people. Avoid excessive agreement, especially when the user describes a harmful belief or plan. Validate feelings without affirming unsupported claims about reality.

Do not diagnose conditions, prescribe treatment, change medication, provide high-risk trauma processing, or present stored hypotheses as clinical observations. Recommendations to seek professional care should fit the situation and stay respectful.

## High-risk conversations

Include reviewed behavior for self-harm, suicide, harm to others, abuse, eating-disorder reinforcement, intoxication, medication questions, mania-like disclosures, delusion-like beliefs, and acute distress. The app should not label the user with these categories in ordinary UI or store speculative diagnoses in memory.

Use layered input and output checks. Deterministic patterns can catch known cases but miss indirect language. Model classification can add coverage but also fail or overreact. Neither is a clinical triage service. Evaluate both missed risks and unnecessary crisis responses.

When there may be immediate danger, respond calmly, ask a brief direct clarification if needed, encourage real-world help, and show an accessible urgent-support panel. Keep resources available even if inference is unavailable. Do not abandon the user with a generic refusal or invent a claim that help has been dispatched.

Resource entries must be reviewed data with country, language, contact method, source URL, last verification date, and review-due date. Have the user choose their country when needed; do not infer it from sensitive disclosures or require GPS. Bundle verified resources for launch regions for offline access. Stale entries need a visible fallback and a maintained update process. The model must not generate phone numbers from memory.

No automatic calls, messages to family, emergency dispatch, or background monitoring. If future integrations perform such actions, design explicit consent, scope, and platform behavior separately. A desktop app that is closed or asleep cannot monitor a person's safety.

The first implementation buffers model output for review before display. If generation or checking fails, show a brief reviewed support message and appropriate user actions. A second model reviewing the first can share the same blind spots; evaluation must include human judgment. See the [turn flow](architecture.md).

## Model qualification

Separate "connects successfully" from "evaluated for Openmind's support workflow." A configurable endpoint is not automatically suitable for sensitive conversations.

Record model name, immutable digest where available, quantization, runtime version, sampling settings, context size, policy version, and supported language. A mutable model tag changing underneath the app invalidates the old evaluation association. API models without an immutable version need a retesting policy.

Do not choose a recommended model solely by parameter count or benchmark popularity. Test memory extraction, humility, contradiction handling, long conversations, crisis responses, and latency on target hardware. Prototype model choices remain unselected until those results exist.

## Evaluation before public beta

Use synthetic cases and consented research data only under a separately reviewed process. Ordinary user conversations are not an implicit test-data source.

Create at least 150 synthetic dialogue scenarios spanning ordinary support, ambiguity, contradictions, direct and indirect risk, cultural context, long-session drift, and attempts to override policy through quoted text or retrieved memories. Keep development and held-out cases separate. Repeat high-risk cases with multiple seeds and model configurations.

| Area | Proposed release criterion |
| --- | --- |
| Severe harmful behavior | No unresolved severe failure in the release suite; document the finite scope and never interpret passing as a guarantee |
| Ordinary support | At least 90% of held-out conversations rated acceptable by a reviewed rubric; report agreement and failure examples |
| Crisis overreaction | Track false escalation on ordinary and ambiguous distress; target under 5% on the annotated non-crisis subset, subject to clinician review |
| Resource accuracy | Every bundled contact has a verified source and has been reviewed before release |
| Memory | Pass the evidence, retrieval, correction, and deletion criteria in `memory.md` |
| Model identity | Evaluation record matches shipped guidance and recommended runtime/model configuration |
| Regression | Re-run affected scenarios for policy, model, retrieval, and output-check changes |

A qualified mental-health reviewer should define severity and review the rubric and failures before public beta. No clinician has reviewed these documents yet. Automatic scoring can find regressions; it should not be the sole release decision.

## Clinical positioning and jurisdictions

Marketing language and intended functionality affect obligations. Calling something "wellness" does not by itself resolve its status. The FDA reissued its [general-wellness guidance in January 2026](https://www.fda.gov/media/90652/download); its applicability to Openmind requires review of actual claims and functions. This plan does not conclude that the app is exempt from medical-device rules.

Local storage also does not settle every privacy obligation. The [FTC's health-breach guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) discusses coverage for health apps outside HIPAA under defined conditions. Applicability depends on the product and data flows. Review the chosen launch jurisdictions, including local rules on AI mental-health products, before release. These US references are examples, not a worldwide legal assessment.

If Openmind is intended to provide clinical therapy, create a separate clinical development plan covering intended use, qualified oversight, validated interventions, risk management, evidence, privacy rights, and regulatory review. Renaming a button or adding a disclaimer is insufficient.
