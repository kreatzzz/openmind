---
version: alpha
name: Openmind
description: A quiet desktop space for reflection, with warm paper, dark ink, and a restrained moss accent.
colors:
  primary: "#365748"
  on-primary: "#FFFFFF"
  background: "#F4F1E9"
  surface: "#FCFAF5"
  ink: "#292D29"
  muted: "#666A60"
  line: "#D8D8CC"
  selected: "#E2E9DE"
  error: "#994132"
  night-background: "#1C211E"
  night-surface: "#252C27"
  night-ink: "#EDEFE5"
  night-muted: "#B1B9AD"
  night-accent: "#A9C4AE"
typography:
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: 36px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: 26px
    fontWeight: 400
    lineHeight: 1.3
  conversation:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.7
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 12px
  lg: 20px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  conversation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.conversation}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 44px
    padding: 16px
  session-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: 12px
  metadata:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
  error-message:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    typography: "{typography.label}"
  divider:
    backgroundColor: "{colors.line}"
    height: 1px
  page-night:
    backgroundColor: "{colors.night-background}"
    textColor: "{colors.night-ink}"
  conversation-night:
    backgroundColor: "{colors.night-surface}"
    textColor: "{colors.night-ink}"
  metadata-night:
    backgroundColor: "{colors.night-background}"
    textColor: "{colors.night-muted}"
  button-primary-night:
    backgroundColor: "{colors.night-accent}"
    textColor: "{colors.night-background}"
    rounded: "{rounded.md}"
    height: 44px
---

# Openmind design direction

## Overview

Proposed direction, pending visual review with Krish. The interface should give a personal conversation room to breathe. Use a broad writing area, visible dates, quiet navigation, and a single clear action. The visual character comes from proportion, typography, and a small session marker that recalls the margin of a notebook.

The intended product is clinical therapy, with the treatment model and evidence still to be defined. The app is honest about being AI. Avoid a human therapist avatar, relationship status, or an animated face. The interface should not imply a clinician is watching or that a model has feelings. Clearly distinguish an experimental build from an evaluated clinical release.

This document follows the token-and-prose format in the [Google Labs DESIGN.md specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md). Tokens above define proposed values. No interface has been implemented or visually validated yet.

## Colors

Use warm paper for the app background and a slightly lighter writing area. Dark ink carries reading content. Moss marks the primary action, current session, and focus accents. It should occupy little of the screen.

Use the night tokens as semantic replacements when the user selects dark mode or follows the OS appearance. Preserve the warm, low-chroma character. Do not invert the entire screen mechanically.

The line token is for decorative division, not the only indicator of input boundaries or focus. Functional boundaries must reach 3:1 contrast against adjacent colors. Body text needs at least 4.5:1, and large text at least 3:1. Errors use both text and an icon, never color alone. Dark-mode focus, disabled, hover, and urgent-support states need final values and contrast checks during implementation.

## Typography

Newsreader is reserved for page titles and occasional opening questions. Inter carries conversations, controls, and settings. Bundle licensed font assets with the app; keep their license notices and avoid runtime font downloads. Use the listed system fallbacks until bundled assets are available.

Conversation text begins at 17px with generous leading and supports a user font-size control. Do not put long responses in italic serif text. Keep content around 60 to 72 characters wide. Balance headings and use readable wrapping for paragraphs.

Use sentence case, normal punctuation, and direct language. Dates and durations use tabular numerals. On macOS, apply antialiasing where it improves readability. Labels should remain legible at normal viewing distance; small type is not a substitute for hierarchy.

## Layout

At a 1280 by 820 desktop window, begin with a 232px left rail and a centered conversation column up to 720px wide. Use 32px outer spacing and 24px between major groups. Respect the native title bar, macOS traffic lights, Windows window controls, and draggable regions without overlapping interactive content.

The rail contains Openmind, "New conversation," a chronological session list, "Your notes," "Remembered context," "Schedule," and "Settings." Dates organize history. Avoid model controls and technical metrics in the conversation header.

The main view has a short title, optional session date, a readable transcript, and a composer at the bottom of the available space. A narrow margin mark identifies the selected session. User and assistant messages have explicit accessible speaker labels and enough separation to follow the exchange. Do not rely solely on left/right alignment or pale backgrounds.

Below 960px, collapse the rail into a keyboard-accessible drawer. Below 720px or at high zoom, use one column with no lost controls or horizontal reading scroll. Do not enforce a minimum window size that makes 200% zoom unusable.

Opening Openmind resumes the last safe navigation state after unlocking. It must not reveal conversation snippets on the lock screen. On an empty account, "What would you like to talk about?" and a single start action are enough.

## Elevation & Depth

Separate the writing area from the app background through color and space. Keep the transcript flat. Use a small layered shadow for menus and dialogs, for example `0 1px 3px rgb(0 0 0 / 0.06), 0 8px 24px rgb(0 0 0 / 0.08)` in light mode. Dark mode needs its own visible border and shadow treatment.

Use borders for structure, selected state, and input affordances. Avoid stacks of cards, glass panels, decorative blur, textured images behind text, and a dashboard of personal statistics.

## Shapes

Use 12px radii on controls and 20px on a composer containing 12px inner controls with 8px padding. Use 6px for compact list selections. Reserve pills for a short status such as "On this device," not every button.

Icons use one consistent outline set and `currentColor`. Match stroke weight to adjacent text and align asymmetric icons optically. Visible controls target 44px; dense desktop actions may use a 40px hit area. Hidden expansion of a hit area must not overlap its neighbor.

## Components

### Conversation and composer

The composer grows up to a reasonable fraction of window height and then scrolls internally. Offer send, stop while generating, and an accessible multiline shortcut hint. Start with Enter to send and Shift+Enter for a newline, with a preference to reverse the behavior. Respect IME composition and never submit during composition.

Before the first text arrives, show "Preparing a reply" with a static working indicator and a stop button. Append real output as checked sentence-sized units arrive; do not add a simulated typewriter delay or claim that a person is thinking. Additional full-response review can delay visible output when required. Interrupted replies remain visibly marked and do not silently disappear. Preserve the user's draft and scroll position on errors. When reading older messages, show a "New reply" affordance rather than forcing the view to the bottom.

Speech-to-text input is proposed pending clarification. Add a labeled microphone control, permission-denied state, visible recording status, stop/cancel, and an editable transcript preview in the composer. Silence does not submit a message. Typing remains available. Model output stays text-only at launch; future speech playback is an explicit control with its own stop action and remote-provider disclosure.

### Your notes

The notebook contains short takeaways, topics to return to, and agreed next steps, separate from internal memory. Update it after a completed reply with a subtle "Updating notes" or "Notes updated" state. Note generation must not steal keyboard focus, open a panel automatically, or animate the transcript.

Each generated item links to visible conversation evidence. Distinguish suggested actions from agreed actions. Users can edit, dismiss, and delete notes; a later model update cannot overwrite their edits. Show failed updates with a retry action while preserving previous notes. An empty patch produces no distracting notification.

### Connection setup

First-run flow is vault setup, local or remote model choice, connection test, a brief privacy explanation, then conversation. Advanced fields live in connection settings. The choice must explain whether messages leave the device before the user begins sharing.

Show a human-readable status such as "On this device," "Remote provider," or "Execution location unverified." Include the selected provider in settings and in a compact connection detail popover. A green dot alone is insufficient. A failed connection offers a specific retry or setup action, not an empty composer.

### Session history and schedule

Use a chronological list with dates and user-editable titles. Start with neutral titles such as "Sunday conversation"; generating revealing titles requires a deliberate preference. Search appears only when history warrants it. The schedule is a simple list of upcoming sessions with timezone and reminder availability, not a calendar dashboard by default.

State whether reminders require the app to remain open or in the tray. A missed session has no streak penalty, red shame indicator, or guilt message.

### Remembered context

Show understandable statements grouped by people, events, preferences, and goals, with a source date and "Correct" or "Forget" actions. This is a curated user-facing view, not the raw internal graph. State that the app also maintains internal links and tentative interpretations. Do not imply this screen exposes every internal record.

Correction edits meaning with context. Forgetting explains whether the transcript is retained, which derived records will be removed, and what happens to backups. Memory-off and private-session controls remain visible while active.

An Obsidian-style force graph is not a v1 user screen under the proposed hidden-graph requirement. A future developer visualization uses synthetic fixtures by default and is never shipped as an unnoticed backdoor into personal data.

### Support, dialogs, and settings

Urgent support is always reachable from the app menu and works without inference. When relevant, display a calm, readable panel with verified resources and clear actions. Avoid flashing banners, danger animations, or language implying emergency monitoring.

Dialogs trap focus, restore it on dismissal, and explain the consequence of destructive actions. Escape dismisses ordinary dialogs; destructive work does not begin on an accidental keypress. Settings group model connection, privacy and vault, memory, reminders, appearance, and about/update controls.

### Motion and accessibility

Use immediate feedback for send, stop, typing, selection, and frequently used navigation. Hover and focus may use at most 120ms color or opacity transitions. A settings drawer can enter over 180ms with `cubic-bezier(0.2, 0, 0, 1)`, using opacity and a small translation. No character-by-character text animation, routine entrance stagger, or looping breathing ornament.

Transitions must be interruptible and specify their properties. Respect reduced motion with instant layout/state changes and static feedback. Do not animate the transcript to create a feeling of a human presence.

All actions need keyboard access and visible focus. Batch streamed text into coherent announcements through a restrained live region, never announce each token, and prevent duplicate announcements when a response completes. Test VoiceOver and NVDA, selected history items, notebook edits, recording state, dialogs, validation, 200% zoom, text resizing, and reduced motion. Keep icons labeled and status understandable without color.

## Do's and Don'ts

- Give the conversation most of the window. Keep management controls quiet but discoverable.
- Use plain descriptions of privacy and execution location at the moment a user chooses a provider.
- Make correction, forgetting, stop, and lock easy to find.
- Design empty, loading, unavailable-model, interrupted-response, locked, and corrupted-vault states as carefully as the happy path.
- Avoid engagement scores, streaks, inferred mood charts, personality labels, neon gradients, and decorative graph backgrounds.
- Do not describe the model as waiting for, missing, diagnosing, or secretly understanding the user.
- Validate the main flow on both operating systems before treating this proposal as a finished visual system.
