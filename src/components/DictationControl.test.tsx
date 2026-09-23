import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DictationControl } from "./DictationControl";

const actions = {
  onInstall: vi.fn(),
  onStart: vi.fn(),
  onFinish: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
};

describe("DictationControl", () => {
  it("explains unavailable local speech without starting the microphone", () => {
    render(
      <DictationControl
        phase="unavailable"
        message="On-device speech recognition is not available in this desktop runtime."
        disabled={false}
        {...actions}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Why is dictation unavailable?" }),
    );
    expect(
      screen.getByText(/On-device speech recognition is not available/),
    ).toBeVisible();
    expect(actions.onStart).not.toHaveBeenCalled();
  });

  it("keeps a recognition error visible and offers a retry", () => {
    const { rerender } = render(
      <DictationControl
        phase="error"
        message="Openmind could not access the microphone."
        disabled={false}
        {...actions}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Dictation stopped");
    fireEvent.click(
      screen.getByRole("button", { name: "Dictation error details" }),
    );
    expect(
      screen.getByText("Openmind could not access the microphone."),
    ).toBeVisible();
    const retry = screen.getByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);
    expect(actions.onRetry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Dictation error details" }),
    ).toHaveFocus();
    rerender(
      <DictationControl
        phase="starting"
        message="Starting local dictation"
        disabled={false}
        {...actions}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Starting local dictation" }),
    ).toHaveFocus();
  });

  it("announces capability checking without claiming dictation is unavailable", () => {
    render(
      <DictationControl
        phase="checking"
        message="Checking local dictation support"
        disabled={false}
        {...actions}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Checking dictation");
    expect(screen.queryByRole("button", { name: /unavailable/i })).toBeNull();
  });
});
