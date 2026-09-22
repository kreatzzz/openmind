import {
  lazy,
  Suspense,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ComposerToolbar } from "./ComposerToolbar";

const VoiceBeam = lazy(async () => {
  const module = await import("voice-glow");
  return { default: module.VoiceBeam };
});

export interface ChatComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled: boolean;
  enterToSend: boolean;
  sending: boolean;
  stopping: boolean;
  hasReplyContent: boolean;
  noteStatus: string;
  connectionReady: boolean;
  leadingControls?: ReactNode;
  voiceState?: "idle" | "listening" | "processing";
  voiceTheme?: "auto" | "dark" | "light";
}

export function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  onStop,
  textareaRef,
  disabled,
  enterToSend,
  sending,
  stopping,
  hasReplyContent,
  noteStatus,
  connectionReady,
  leadingControls,
  voiceState = "idle",
  voiceTheme = "auto",
}: ChatComposerProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    void onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      voiceState !== "idle" ||
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      event.keyCode === 229
    )
      return;

    const shouldSend = enterToSend
      ? !event.shiftKey
      : event.metaKey || event.ctrlKey;
    if (!shouldSend) return;

    event.preventDefault();
    void onSubmit();
  }

  const form = (
    <form className="composer" onSubmit={submit}>
      <label className="sr-only" htmlFor="message">
        Your message
      </label>
      <textarea
        ref={textareaRef}
        id="message"
        rows={2}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="What's on your mind?"
        disabled={disabled}
        readOnly={voiceState !== "idle"}
        onKeyDown={handleKeyDown}
      />
      <ComposerToolbar
        canSend={Boolean(value.trim()) && !disabled && voiceState === "idle"}
        connectionReady={connectionReady}
        enterToSend={enterToSend}
        hasReplyContent={hasReplyContent}
        leadingControls={leadingControls}
        noteStatus={noteStatus}
        onStop={onStop}
        sending={sending}
        stopping={stopping}
      />
    </form>
  );

  if (voiceState === "idle") return form;

  return (
    <Suspense fallback={form}>
      <VoiceBeam
        active
        processing={voiceState === "processing"}
        level={0}
        idle={0.1}
        colorVariant="mono"
        theme={voiceTheme}
        staticColors
        distortion={0}
        strength={0.38}
        className="composer-voice-surface"
      >
        {form}
      </VoiceBeam>
    </Suspense>
  );
}
