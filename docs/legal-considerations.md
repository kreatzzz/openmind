# Open-source distribution and clinical intent

Research note, September 7, 2026. This is issue identification for product planning, not a legal opinion or a decision that Openmind falls into a particular regulatory class. Initial distribution countries are still unselected.

Open-source licensing does not by itself resolve the obligations attached to a clinical product. A general-purpose component that others adapt and a ready-to-use therapy application can present different facts. Openmind's documented clinical intent, default behavior, claims, and distribution need to be considered together.

## Matters to resolve before clinical distribution

| Matter | What applies to the plan |
| --- | --- |
| Medical-device classification | Assess each intended function, target condition, population, and jurisdiction; do not treat "harness" as a regulatory category |
| Clinical and privacy claims | Make only claims supported by actual behavior and evidence; local endpoints do not prove a third-party runtime never sends data elsewhere |
| Data responsibilities | Map any remote model, speech, support, diagnostics, or research flow separately; no content telemetry in this prototype |
| Patient records | Determine access, correction, retention, and deletion requirements; hiding model notes in the UI does not establish a legal exemption |
| Licensing | Choose a project license and retain third-party notices; public code without a selected license is not a completed open-source licensing decision |
| Liability and professional rules | Obtain jurisdiction-specific advice about product responsibility, applicable practice rules, and the limits of disclaimers |

The FDA's [intended-use guidance](https://www.fda.gov/medical-devices/digital-health-center-excellence/step-1-software-function-intended-medical-purpose) explains that medical purpose and objective intent can be evidenced by expressions, design, and distribution circumstances. My application to this plan is that describing Openmind as a clinical therapy app is relevant even if it connects to someone else's model. This does not determine the final classification.

The FTC's [health-app tool](https://www.ftc.gov/business-guidance/resources/mobile-health-apps-interactive-tool) addresses health-benefit claims and privacy representations. Its [breach-rule guidance](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0) describes covered entities and conditions. A local-only prototype and a later app using remote speech or diagnostics can have different data flows; neither should be labeled compliant without assessment.

The [MIT license](https://opensource.org/license/mit) grants broad reuse rights and includes warranty and liability disclaimers. Do not interpret those clauses as medical-device authorization or assume their enforceability settles every statutory obligation. No project license has been selected in this repository yet.

These US examples are not a worldwide assessment. A qualified adviser should review the actual first-launch countries, product claims, and clinical delivery model. The [clinical development plan](conversation-policy.md#clinical-development-and-jurisdictions) remains separate from engineering verification.

## Current engineering boundary

Build and test the desktop foundation with synthetic conversations. Identify the app as an engineering preview, make no clinical effectiveness claims, and document missing capabilities. This development boundary does not authorize offering treatment or enrolling patients in a study.
