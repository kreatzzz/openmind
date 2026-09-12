import { useEffect, type RefObject } from "react";
import { Square } from "lucide-react";
import type { Message, Session } from "../lib/desktop";
import { Mark } from "./Mark";

export function Transcript({
  highlight,
  messages,
  session,
  sample,
  fontSize,
  scroll,
  onScroll,
}: {
  highlight?: string | null;
  messages: Message[];
  session: Session | undefined;
  sample: boolean;
  fontSize: number;
  scroll: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  useEffect(() => {
    if (highlight)
      document
        .getElementById(`message-${highlight}`)
        ?.scrollIntoView?.({ block: "center" });
  }, [highlight]);
  return (
    <div className="transcript-scroll" ref={scroll} onScroll={onScroll}>
      <div className="conversation-column">
        {messages.length ? (
          <>
            <div className="conversation-title">
              <div className="eyebrow">
                <span className="margin-line" />
                {sample ? "A SAMPLE CONVERSATION" : "YOUR CONVERSATION"}
              </div>
              <h1>{session?.title ?? "A moment to reflect"}</h1>
              <p>
                {sample
                  ? "Monday, September 7"
                  : session
                    ? new Date(session.createdAt).toLocaleDateString(
                        undefined,
                        { weekday: "long", month: "long", day: "numeric" },
                      )
                    : ""}
              </p>
            </div>
            <div
              className="messages"
              aria-label="Conversation transcript"
              style={{ fontSize }}
            >
              {messages.map((message) => (
                <article
                  key={message.id}
                  id={`message-${message.id}`}
                  data-highlight={highlight === message.id || undefined}
                  className={`message message-${message.role}`}
                  aria-label={message.role === "user" ? "You" : "Openmind AI"}
                >
                  <div className="speaker">
                    {message.role === "assistant" ? (
                      <>
                        <Mark small />
                        Openmind<span className="ai-label">AI</span>
                      </>
                    ) : (
                      <>
                        <span className="user-mark" />
                        You
                      </>
                    )}
                  </div>
                  <div className="message-content">
                    {message.content ||
                      (message.status === "streaming"
                        ? "Preparing a reply"
                        : "")}
                  </div>
                  {message.status === "interrupted" && (
                    <p className="interrupted">
                      <Square size={11} /> Reply stopped before completion
                    </p>
                  )}
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-conversation">
            <div className="eyebrow">
              <span className="margin-line" />
              NEW CONVERSATION
            </div>
            <h1>What's on your mind?</h1>
            <p>
              Start wherever you are.
              <br />A thought, a question, or something from your day.
            </p>
            <div className="empty-line" />
            <span className="empty-caption">
              There is no right way to begin.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
