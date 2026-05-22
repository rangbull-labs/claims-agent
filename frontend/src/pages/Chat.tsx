import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import { DispositionBadge } from "../components/DispositionBadge";
import { MemberPicker } from "../components/MemberPicker";
import { sendInquiry } from "../lib/api";
import type { AgentResult } from "../types";

interface UserMessage {
  kind: "user";
  text: string;
}

interface AssistantMessage {
  kind: "assistant";
  result: AgentResult;
}

interface ErrorMessage {
  kind: "error";
  text: string;
}

export type Message = UserMessage | AssistantMessage | ErrorMessage;

interface Props {
  selectedMemberId: string | null;
  setSelectedMemberId: Dispatch<SetStateAction<string | null>>;
  chatMessages: Message[];
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
}

export function Chat({
  selectedMemberId,
  setSelectedMemberId,
  chatMessages,
  setChatMessages,
}: Props) {
  // Transient state stays local — these represent in-flight UI that
  // should reset when the user navigates away.
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, loading]);

  async function handleSubmit() {
    if (!selectedMemberId || !input.trim() || loading) return;
    const inquiry = input.trim();
    setChatMessages((m) => [...m, { kind: "user", text: inquiry }]);
    setInput("");
    setLoading(true);
    try {
      const result = await sendInquiry(selectedMemberId, inquiry);
      setChatMessages((m) => [...m, { kind: "assistant", result }]);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setChatMessages((m) => [...m, { kind: "error", text }]);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setChatMessages([]);
  }

  const canSend = Boolean(selectedMemberId) && input.trim().length > 0 && !loading;
  const canClear = chatMessages.length > 0 && !loading;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
      <MemberPicker value={selectedMemberId} onChange={setSelectedMemberId} />

      <div className="flex flex-col gap-3 min-h-[20rem]">
        {chatMessages.length === 0 && !loading && (
          <div className="text-zinc-500 text-sm text-center py-8">
            Pick a member, then ask a question to see the agent in action.
          </div>
        )}

        {chatMessages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {loading && <LoadingBubble />}

        <div ref={messagesEndRef} />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            selectedMemberId
              ? "Ask about a claim, coverage, or denial…"
              : "Select a member first"
          }
          disabled={!selectedMemberId || loading}
          className="flex-1 border border-zinc-300 rounded px-3 py-2 bg-white text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:bg-zinc-100 disabled:text-zinc-500"
        />
        <button
          type="button"
          onClick={handleClear}
          disabled={!canClear}
          className="bg-white border border-zinc-300 hover:border-zinc-400 text-zinc-700 font-medium px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Clear chat
        </button>
        <button
          type="submit"
          disabled={!canSend}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 py-2 rounded disabled:bg-zinc-300 disabled:cursor-not-allowed"
        >
          {loading ? "Thinking…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-indigo-600 text-white px-4 py-2 rounded-lg whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.kind === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2 rounded-lg text-sm">
          <div className="font-medium">Request failed</div>
          <div className="text-rose-700 mt-1">{message.text}</div>
        </div>
      </div>
    );
  }
  return <AssistantBubble result={message.result} />;
}

function AssistantBubble({ result }: { result: AgentResult }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-white border border-zinc-200 px-4 py-3 rounded-lg flex flex-col gap-2 text-zinc-900">
        <div className="flex items-center gap-2">
          <DispositionBadge disposition={result.disposition} />
          {result.classification && (
            <span className="text-xs text-zinc-600">
              {result.classification.intent} ·{" "}
              <span className="font-medium">
                {result.classification.confidence.toFixed(2)}
              </span>{" "}
              confidence
            </span>
          )}
          <span className="text-xs text-zinc-400 ml-auto">
            {(result.durationMs / 1000).toFixed(1)}s
          </span>
        </div>

        {result.disposition === "escalated" ? (
          <div className="text-sm">
            <div className="font-medium text-amber-900">
              Inquiry routed to human review.
            </div>
            {result.escalationReason && (
              <div className="text-zinc-600 mt-1">
                Reason: <span className="font-mono">{result.escalationReason}</span>
              </div>
            )}
          </div>
        ) : result.draftResponse ? (
          <div className="text-sm whitespace-pre-wrap">{result.draftResponse}</div>
        ) : (
          <div className="text-sm text-zinc-500 italic">
            Agent did not produce a draft. Try rephrasing the question.
          </div>
        )}

        {result.toolNames.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1 border-t border-zinc-100">
            <span className="text-xs text-zinc-500 mr-1">Tools:</span>
            {result.toolNames.map((name, i) => (
              <span
                key={i}
                className="text-xs bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-mono"
              >
                {name}
              </span>
            ))}
          </div>
        )}

        {result.classification?.reasoning && (
          <details className="text-xs text-zinc-500 mt-1">
            <summary className="cursor-pointer hover:text-zinc-700">
              Classifier reasoning
            </summary>
            <div className="mt-1 pl-3 border-l-2 border-zinc-200">
              {result.classification.reasoning}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function LoadingBubble() {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-zinc-200 px-4 py-3 rounded-lg flex items-center gap-2 text-zinc-600 text-sm">
        <span className="inline-block w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
        <span>Thinking…</span>
      </div>
    </div>
  );
}
