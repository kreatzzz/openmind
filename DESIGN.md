---
version: alpha
name: Openmind
description: A focused desktop workspace using the Geist design system's neutral colors, typography, and component proportions.
colors:
  background: "#FFFFFF"
  surface: "#FFFFFF"
  ink: "#000000"
  muted: "#666666"
  line: "#E5E5E5"
  input-border: "#8F8F8F"
  selected: "#EBEBEB"
  primary: "#000000"
  on-primary: "#FFFFFF"
  focus: "#525252"
  error: "#CC0000"
  night-background: "#000000"
  night-surface: "#000000"
  night-ink: "#FFFFFF"
  night-muted: "#A8A8A8"
  night-line: "#202020"
  night-input-border: "#666666"
  night-focus: "#D4D4D4"
typography:
  title:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.7px"
  conversation:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.75
  body:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Geist Variable, Geist, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.5
  metadata:
    fontFamily: "Geist Mono Variable, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 8px
  lg: 12px
  composer: 14px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: 40px
  field:
    backgroundColor: "{colors.background}"
    borderColor: "{colors.input-border}"
    rounded: "{rounded.sm}"
    height: 40px
  dialog:
    backgroundColor: "{colors.background}"
    borderColor: "{colors.line}"
    rounded: "{rounded.lg}"
---

# Openmind design direction

Krish selected Vercel's Geist design system for this interface. Openmind uses a monochrome letter “o” mark in the interface and native app icons; do not restore the leaf. The implementation uses bundled Geist and Geist Mono fonts, neutral semantic tokens, compact controls, and restrained elevation. Reference the official [colors](https://vercel.com/geist/colors), [typography](https://vercel.com/geist/typography), [buttons](https://vercel.com/geist/button), and [materials](https://vercel.com/geist/materials) when extending components. This is a local implementation of those principles, not an imported Vercel component library.

## Implemented desktop workspace

The shell has a 230px navigation rail, a compact header, and a configurable reading column. The rail is a quiet utility surface: the dark New conversation action establishes the primary path, while selected rows use a neutral fill and the remaining navigation stays low contrast. Below 960px navigation moves into an accessible dialog. Content uses one column on narrow screens without hiding essential actions.

The welcome screen uses a guided workspace, privacy, and model-connection flow. Vault creation or unlock remains primary. An example workspace is identified once at entry as fictional and temporary; it does not repeat disclosure banners throughout the product.

The conversation header offers Conversation controls and deletion with confirmation. Conversation controls let the user rename the conversation and independently choose whether to use/save remembered context and save notebook updates. Off states remain visible beside the conversation. Explain that the transcript stays saved, existing memories and notes are retained, and settings apply to this conversation. Disabling a branch also stops its outstanding updates; enabling it again does not process messages submitted while it was off. Keep controls unavailable during an active reply or notes update, with a clear stop-first explanation. Deleting a conversation removes its transcript and derived notes and internal memory from the active vault. Do not promise backup erasure.

The notebook is a full workspace view. Each note has a kind, its visible evidence quote, a source conversation link, edit controls, and an explicit deletion confirmation. Edited notes are labeled. Source links reveal the conversation and outline the referenced message. Keep the transcript flat and readable; do not present raw internal memory as notebook content.

Conversation output has explicit You and Openmind AI labels. Generation and note updates have separate text status. The same Stop control cancels the active operation. A completed reply remains readable while notes update. Failures preserve existing content. Do not invent simulated typing or human-presence indicators.

An empty conversation presents one gentle opening question directly above the composer. It is interface guidance, not a stored or generated AI turn. Keep the prompt and input together at desktop sizes, and let the conversation scroll normally after the first message. Note-update status appears above the composer; note generation runs after a completed reply without a manual chat action. Offer a retry there only when an update has failed.

Settings separate Appearance, Model connection, Privacy & storage, and Memory & notes. Persist provider and reading preferences in the encrypted vault. Local Ollama is the default; ChatGPT via Codex and compatible API providers require explicit consent describing the destination and data sent. ChatGPT via Codex is available in native personal and example workspaces through the device's existing Codex sign-in. Provider changes require consent to be reviewed again. Appearance and accent choices alone go into browser localStorage. Conversations, drafts, and personal notes must never be stored there.

## Remembered context

Remembered context is a separate workspace from Your notes. Group concise statements by people, events, goals, preferences, and concerns. Show their source date, evidence status, and a link to the original message. Search filters the visible records. Corrections preserve the original quotation with an explicit original-source label; do not present that quotation as evidence of the correction.

Correct and Forget are explicit actions with revision checks. Explain the affected source-message scope before forgetting, including linked memories and notebook entries, retained transcript, future context exclusions, and backup limits. Keep failures visible and preserve edits for retry. The browser sample uses fictional records and temporary state only.

## Color and components

Use pure white surfaces in light mode and pure black (#000000) for the dark canvas, rail, panels, fields, and dialogs. The system theme must use the same palette without selector-specificity overrides. Reserve gray for secondary text, structural dividers, and small hover/selection states. Graphite is the neutral default; Blue, Teal, Violet, and Amber are optional accents for selection and focus. Errors include readable text. Color alone must not convey status. Conversation turns, notes, and remembered context use whitespace and dividers instead of stacked cards; elevation is limited to floating or contained controls such as the composer, dialogs, and vault panel.

Inputs have a stronger border than structural dividers. Preserve visible keyboard focus and readable contrast in both themes. Buttons and inputs use a shared 6px radius and a minimum 40px desktop height. Touch layouts increase action height to 44px. The composer has 8px padding around a 6px send button, giving it a 14px outer radius. Dialogs use 12px corners with a small layered shadow. Avoid decorative gradients, glass, oversized welcome headlines, and stacks of unnecessary cards.

## Type and motion

Use Geist for titles, prose, and controls. Reserve Geist Mono for compact technical values or counts. Conversation text defaults to 17px; reading controls scale text from 75% to 200% and offer compact, comfortable, or wide columns. Use tabular numerals for dates and values. Headings balance their wrapping; content preserves paragraph breaks and wraps long words.

Interaction is immediate. Hover and focus color transitions last at most 120ms and specify their properties. Respect reduced motion. Do not animate routine navigation, streamed text, or notebook updates. Icons use the existing Lucide outline set with currentColor.

## Product boundaries

Clinical therapy is the intended product scope; treatment model and evidence remain unresolved. This engineering preview must not claim evaluated clinical care. Do not imply a human clinician is watching or that the AI has feelings.

Remote providers and planned sessions have working controls. Speech input and urgent support resources remain proposed; do not add nonfunctional navigation entries for them. Any remote provider must explain whether messages leave the device and obtain explicit consent. Preserve correction, deletion, evidence, and the fact that a device owner can inspect decrypted internal records.

Browser checks do not establish native macOS or Windows accessibility. Native webview, keyboard, screen-reader, 200% zoom, and platform title-bar validation remain required before release.
