import { createRef, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./ChatComposer";

vi.mock("voice-glow", () => ({
  VoiceBeam: ({ children }: { children: ReactNode }) => (
    <div data-testid="voice-beam">{children}</div>
  ),
}));

function renderComposer({
  voiceState = "idle",
  onSubmit = vi.fn(),
}: {
  voiceState?: "idle" | "listening" | "processing";
  onSubmit?: () => void;
} = {}) {
  render(
    <ChatComposer
      value="A draft to review"
      onValueChange={vi.fn()}
      onSubmit={onSubmit}
      onStop={vi.fn()}
      textareaRef={createRef<HTMLTextAreaElement>()}
      disabled={false}
      enterToSend
      sending={false}
      stopping={false}
      hasReplyContent={false}
      noteStatus=""
      connectionReady
      voiceState={voiceState}
    />,
  );
  return { onSubmit };
}

describe("ChatComposer", () => {
  it("keeps dictation drafts read-only and blocks submission until review", async () => {
    const { onSubmit } = renderComposer({ voiceState: "listening" });
    const field = screen.getByRole("textbox", { name: "Your message" });

    expect(field).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await screen.findByTestId("voice-beam")).toBeInTheDocument();
  });

  it("submits a reviewed typed draft", () => {
    const { onSubmit } = renderComposer();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Your message" }), {
      key: "Enter",
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
