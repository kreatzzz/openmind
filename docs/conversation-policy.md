# Conversation policy and evaluation

Status: a proposed specification for a clinical therapy product, as confirmed by Krish on September 7, 2026. This is not a clinically validated treatment protocol. Target indications, delivery model, launch countries, and professional oversight remain open decisions.

## Intended behavior

Openmind is intended to deliver clinical therapy. Define the initial condition, population, treatment approach, and independent versus clinician-supported delivery before developing treatment-specific behavior. Adults are the proposed initial population. Prototype conversations can exercise reflection and goal continuity, but these do not by themselves constitute a validated treatment.

Conversations can be warm and continuous without pretending that the software is a licensed human therapist or a person with feelings. Keep intended clinical function distinct from capabilities and effectiveness actually established by evidence.

Use a short onboarding explanation of what the app can do and where it falls short. Do not repeat a disclaimer on every message. Remain honest when users ask about expertise, confidentiality, memory, or emergency support.

The [APA's November 2025 advisory announcement](https://www.apa.org/news/press/releases/2025/11/ai-wellness-apps-mental-health) describes insufficient evidence and protections for these uses. Existing use of chatbots for therapy is evidence of demand, not evidence that Openmind or a chosen local model delivers effective clinical treatment.

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
| User-notebook policy | Generate source-linked takeaways and agreed actions; protect user edits and exclude internal hypotheses |
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

Until a treatment-specific protocol has appropriate review and evidence, the prototype must not independently diagnose conditions, prescribe treatment, change medication, or perform high-risk trauma processing. Stored hypotheses are never verified clinical observations. Clinical treatment scope and permitted interventions must be defined explicitly rather than inferred from a generic model's capabilities.

## High-risk conversations

Include reviewed behavior for self-harm, suicide, harm to others, abuse, eating-disorder reinforcement, intoxication, medication questions, mania-like disclosures, delusion-like beliefs, and acute distress. The app should not label the user with these categories in ordinary UI or store speculative diagnoses in memory.

Use layered input and output checks. Deterministic patterns can catch known cases but miss indirect language. Model classification can add coverage but also fail or overreact. Neither is a clinical triage service. Evaluate both missed risks and unnecessary crisis responses.

When there may be immediate danger, respond calmly, ask a brief direct clarification if needed, encourage real-world help, and show an accessible urgent-support panel. Keep resources available even if inference is unavailable. Do not abandon the user with a generic refusal or invent a claim that help has been dispatched.

Resource entries must be reviewed data with country, language, contact method, source URL, last verification date, and review-due date. Have the user choose their country when needed; do not infer it from sensitive disclosures or require GPS. Bundle verified resources for launch regions for offline access. Stale entries need a visible fallback and a maintained update process. The model must not generate phone numbers from memory.

No automatic calls, messages to family, emergency dispatch, or background monitoring. If future integrations perform such actions, design explicit consent, scope, and platform behavior separately. A desktop app that is closed or asleep cannot monitor a person's safety.

The proposed launch implementation streams text in bounded, checked sentence-sized units and uses full-response review for cases requiring additional scrutiny. Detection of those cases is itself fallible. If generation or checking fails, stop further release, retain the exact already-displayed text with an interrupted state, and show a reviewed fallback where appropriate. Checks cannot undo prior disclosure or guarantee that a later sentence will not change meaning. A second model reviewing the first can share its blind spots; evaluate streaming-specific failures with human judgment. See [turn processing](turn-processing.md).

## Model qualification

Separate "connects successfully" from "evaluated for a specified clinical use." A configurable endpoint is not automatically suitable for clinical therapy. Custom endpoints can be used in clearly identified development or experimental workflows, but a clinical release claim must be tied to an evaluated model, runtime, policy, and configuration. Broad provider support cannot make every connected model clinically interchangeable.

Record model name, immutable digest where available, quantization, runtime version, sampling settings, context size, policy version, and supported language. A mutable model tag changing underneath the app invalidates the old evaluation association. API models without an immutable version need a retesting policy.

Do not choose a recommended model solely by parameter count or benchmark popularity. Test memory extraction, humility, contradiction handling, long conversations, crisis responses, and latency on target hardware. Prototype model choices remain unselected until those results exist.

## Engineering evaluation before clinical studies

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
| User notes | Review factual support, hidden-note leakage, agreement attribution, and preservation of user edits |
| Streaming and speech input | Evaluate cross-sentence harms, interrupted replies, transcription negation errors, and user correction before submission |

A qualified clinical lead should define severity and review the rubric and failures before studies with patients. No clinician has reviewed these documents yet. These synthetic engineering gates do not establish treatment efficacy or replace clinical study design. Automatic scoring can find regressions; it should not be the sole release decision.

## Clinical development and jurisdictions

Clinical therapy is the confirmed intended scope. Do not use a wellness label as the basis for this product's release strategy. Marketing language, functionality, intended population, and deployment jurisdiction affect the applicable requirements. The FDA's [Digital Health Advisory Committee](https://www.fda.gov/medical-devices/digital-health-center-excellence/fda-digital-health-advisory-committee) has considered generative-AI mental-health devices, including premarket evidence and postmarket monitoring. That discussion is not authorization for Openmind or a conclusion about its regulatory classification.

Local storage also does not settle every privacy obligation. The [FTC's health-breach guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) discusses coverage for health apps outside HIPAA under defined conditions. Applicability depends on the product and data flows. Review the chosen launch jurisdictions, including local rules on AI mental-health products, before release. These US references are examples, not a worldwide legal assessment.

The clinical development workstream must define:

- Intended condition, severity range, age group, exclusions, language, treatment approach, and whether a clinician directs care.
- Clinical leadership, intervention protocols, escalation responsibilities, and the exact limits of unattended local operation.
- A study design with appropriate review, consent, comparator, validated outcomes, follow-up, adverse-event handling, and analysis of benefits and harms. Choose those with qualified professionals; do not infer sample size or efficacy from synthetic chat scores.
- A documented risk-management and change-control process linking requirements, model/policy versions, tests, known failures, and release decisions.
- Jurisdiction-specific assessment of device requirements, professional-practice rules, privacy/access rights, and any required study or marketing permissions. Internal AI notes are not automatically legally exempt from access because they are hidden in the UI.
- A post-deployment safety process compatible with local privacy. Do not assume automatic monitoring or add transcript uploads by default. Decide incident reporting and study data collection separately with explicit consent and applicable requirements.

Engineering prototypes with synthetic data can precede clinical deployment. Clinical studies and public treatment distribution need their own evidence and authorization decisions. This plan makes no claim that prompt guidance, encryption, or a passed regression suite is sufficient to launch clinical treatment.
