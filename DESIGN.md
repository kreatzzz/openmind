---
version: alpha
name: Openmind
description: A focused desktop workspace using the Geist design system's neutral colors, typography, and component proportions.
colors:
  background: "#FFFFFF"
  surface: "#FAFAFA"
  ink: "#171717"
  muted: "#666666"
  line: "#E5E5E5"
  input-border: "#8F8F8F"
  selected: "#EBEBEB"
  primary: "#171717"
  on-primary: "#FFFFFF"
  focus: "#0070F3"
  error: "#CC0000"
  night-background: "#0A0A0A"
  night-surface: "#111111"
  night-ink: "#EDEDED"
  night-muted: "#A1A1A1"
  night-line: "#292929"
  night-input-border: "#666666"
  night-focus: "#52A8FF"
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

Krish selected Vercel's Geist design system for this interface. Openmind keeps its own name and mark. The implementation uses bundled Geist and Geist Mono fonts, neutral semantic tokens, compact controls, and restrained elevation. Reference the official [colors](https://vercel.com/geist/colors), [typography](https://vercel.com/geist/typography), [buttons](https://vercel.com/geist/button), and [materials](https://vercel.com/geist/materials) when extending components. This is a local implementation of those principles, not an imported Vercel component library.

## Implemented desktop preview

The shell has a 248px navigation rail, a 64px header, and a reading column around 680px wide. The rail contains conversation search and history, Your notes, Settings, and Lock vault. Below 960px navigation moves into an accessible dialog. Content uses one column on narrow screens without hiding essential actions.

The welcome screen is a compact workspace entry, with vault creation or unlock and a visible Open demo action. Demo opens fictional conversations and notes without creating a personal account. The native demo uses a separate demo vault. Its known credentials are unsuitable for personal information. Keep the synthetic-only banner visible in every demo view. The browser demo permits temporary edits to fictional notes and clearly states that it has no inference or storage.

The conversation header offers deletion with confirmation. Deleting a conversation removes its transcript and derived notes and internal memory from the active vault. Do not promise backup erasure.

The notebook is a full workspace view. Each note has a kind, its visible evidence quote, a source conversation link, edit controls, and an explicit deletion confirmation. Edited notes are labeled. Source links reveal the conversation and outline the referenced message. Keep the transcript flat and readable; do not present raw internal memory as notebook content.

Conversation output has explicit You and Openmind AI labels. Generation and note updates have separate text status. The same Stop control cancels the active operation. A completed reply remains readable while notes update. Failures preserve existing content. Do not invent simulated typing or human-presence indicators.

Settings provide loopback Ollama configuration, a connection check, reading size, send shortcut preference, and system/light/dark appearance. In the native demo, ChatGPT via Codex is an optional online testing provider. Label it Online, explain the data sent to OpenAI, and require an unchecked consent checkbox before either replies or note updates. Hide this option in personal vaults and the browser sample. Switching providers or locking clears consent. Only the appearance choice goes into browser localStorage. Conversations, drafts, and personal notes must never be stored there.

## Color and components

Use background for content and surface for the rail and subtle component separation. Neutral shades cover resting, hover, active, border, and text roles. Blue is reserved for focus and the demo disclosure. Errors include readable text. Color alone must not convey status.

Inputs have a stronger border than structural dividers. Preserve visible keyboard focus and readable contrast in both themes. Buttons and inputs use a shared 6px radius and a minimum 40px desktop height. Touch layouts increase action height to 44px. The composer has 8px padding around a 6px send button, giving it a 14px outer radius. Dialogs use 12px corners with a small layered shadow. Avoid decorative gradients, glass, oversized welcome headlines, and stacks of unnecessary cards.

## Type and motion

Use Geist for titles, prose, and controls. Reserve Geist Mono for compact technical values or counts. Conversation text defaults to 17px and can increase to 22px. Use tabular numerals for dates and values. Headings balance their wrapping; content preserves paragraph breaks and wraps long words.

Interaction is immediate. Hover and focus color transitions last at most 120ms and specify their properties. Respect reduced motion. Do not animate routine navigation, streamed text, or notebook updates. Icons use the existing Lucide outline set with currentColor.

## Product boundaries

Clinical therapy is the intended product scope; treatment model and evidence remain unresolved. This engineering preview must not claim evaluated clinical care. Do not imply a human clinician is watching or that the AI has feelings.

Remote providers, speech input, scheduling, urgent support resources, and user-facing remembered context remain proposed work. Do not add nonfunctional navigation entries for them. Any remote provider must explain whether messages leave the device and obtain explicit consent. Preserve correction, deletion, evidence, and the fact that a device owner can inspect decrypted internal records.

Browser checks do not establish native macOS or Windows accessibility. Native webview, keyboard, screen-reader, 200% zoom, and platform title-bar validation remain required before release.
