import { memo, useEffect, type RefObject } from "react";
import { MessageScroller } from "@shadcn/react/message-scroller";
import { Square } from "lucide-react";
import type { Message, Session } from "../lib/desktop";
import { Mark } from "./Mark";
import { ModelActivity } from "./ModelActivity";

const TranscriptMessage = memo(function TranscriptMessage({
  message,
  highlighted,
}: {
  message: Message;
  highlighted: boolean;
}) {
  return (
    <article
      id={`message-${message.id}`}
      data-highlight={highlighted || undefined}
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
            <span className="user-mark" aria-hidden="true" />
            You
          </>
        )}
      </div>
      <div className="message-content">
        {message.content ||
          (message.status === "streaming" ? (
            <ModelActivity phase="preparing" />
          ) : null)}
      </div>
      {message.status === "interrupted" && (
        <p className="interrupted">
          <Square size={11} /> Reply stopped before completion
        </p>
      )}
    </article>
  );
});

export function Transcript({
  highlight,
  messages,
  session,
  sample,
  hasRememberedContext,
  fontSize,
  scroll,
  onScroll,
}: {
  highlight?: string | null;
  messages: Message[];
  session: Session | undefined;
  sample: boolean;
  hasRememberedContext: boolean;
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
    <MessageScroller.Provider autoScroll={false} defaultScrollPosition="end">
      <MessageScroller.Root className="transcript-scroller">
        <MessageScroller.Viewport
          className="transcript-scroll"
          ref={scroll}
          onScroll={onScroll}
          aria-label="Conversation transcript"
        >
          <div className="conversation-column">
            {messages.length ? (
              <>
                <div className="conversation-title">
                  <div className="eyebrow">
                    <span className="margin-line" aria-hidden="true" />
                    {sample ? "CONVERSATION" : "YOUR CONVERSATION"}
                  </div>
                  <h1>{session?.title ?? "A moment to reflect"}</h1>
                  <p className="conversation-date">
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
                <MessageScroller.Content
                  className="messages"
                  aria-label="Messages"
                  aria-busy={messages.some(
                    (message) => message.status === "streaming",
                  )}
                  aria-relevant="additions"
                  style={{ fontSize }}
                >
                  {messages.map((message) => (
                    <MessageScroller.Item
                      className="message-item"
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <TranscriptMessage
                        message={message}
                        highlighted={highlight === message.id}
                      />
                    </MessageScroller.Item>
                  ))}
                </MessageScroller.Content>
              </>
            ) : (
              <div className="empty-conversation">
                <span className="eyebrow">A PLACE TO BEGIN</span>
                <h1>What feels important to talk through today?</h1>
                <p>
                  We can take it one part at a time. Share only what you want
                  to.
                </p>
                {hasRememberedContext && (
                  <p className="empty-memory-note">
                    Remembered context from earlier conversations is available
                    here.
                  </p>
                )}
              </div>
            )}
          </div>
        </MessageScroller.Viewport>
      </MessageScroller.Root>
    </MessageScroller.Provider>
  );
}
