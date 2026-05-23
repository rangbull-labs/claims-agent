import {
  type Dispatch,
  Fragment,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import { DispositionBadge } from "../components/DispositionBadge";
import { MemberPicker } from "../components/MemberPicker";
import { listMembers, sendInquiry } from "../lib/api";
import type { AgentResult, Member } from "../types";

interface UserMessage {
  kind: "user";
  text: string;
  memberId: string;
  memberLabel: string;
}

interface AssistantMessage {
  kind: "assistant";
  result: AgentResult;
  memberId: string;
  memberLabel: string;
}

interface ErrorMessage {
  kind: "error";
  text: string;
  memberId: string;
  memberLabel: string;
}

export type Message = UserMessage | AssistantMessage | ErrorMessage;

interface Props {
  selectedMemberId: string | null;
  setSelectedMemberId: Dispatch<SetStateAction<string | null>>;
  chatMessages: Message[];
  setChatMessages: Dispatch<SetStateAction<Message[]>>;
}

const EXAMPLE_PROMPTS = [
  "Why was my last claim denied?",
  "What is my current deductible?",
  "When was my last claim processed?",
  "Tell me about claim C-0007",
  "I want to sue you for this denial",
];

export function Chat({
  selectedMemberId,
  setSelectedMemberId,
  chatMessages,
  setChatMessages,
}: Props) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [memberMap, setMemberMap] = useState<Map<string, Member>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listMembers()
      .then((ms) => {
        if (!cancelled) {
          setMemberMap(new Map(ms.map((m) => [m.memberId, m])));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, loading]);

  function getMemberLabel(memberId: string): string {
    const member = memberMap.get(memberId);
    if (!member) return memberId;
    return `${member.memberId} · ${member.planType}`;
  }

  async function handleSubmit() {
    if (!selectedMemberId || !input.trim() || loading) return;
    const memberId = selectedMemberId;
    const memberLabel = getMemberLabel(memberId);
    const inquiry = input.trim();
    setChatMessages((m) => [...m, { kind: "user", text: inquiry, memberId, memberLabel }]);
    setInput("");
    setLoading(true);
    try {
      const result = await sendInquiry(memberId, inquiry);
      setChatMessages((m) => [...m, { kind: "assistant", result, memberId, memberLabel }]);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setChatMessages((m) => [...m, { kind: "error", text, memberId, memberLabel }]);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    setChatMessages([]);
  }

  function handleExampleClick(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  const canSend = Boolean(selectedMemberId) && input.trim().length > 0 && !loading;
  const canClear = chatMessages.length > 0 && !loading;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
      <MemberPicker value={selectedMemberId} onChange={setSelectedMemberId} />

      <div className="flex flex-col gap-3 min-h-[20rem]">
        {chatMessages.length === 0 && !loading && (
          selectedMemberId ? (
            <ExamplePrompts onSelect={handleExampleClick} />
          ) : (
            <div className="text-zinc-500 text-sm text-center py-8">
              Pick a member, then ask a question to see the agent in action.
            </div>
          )
        )}

        {chatMessages.map((m, i) => {
          const prev = i > 0 ? chatMessages[i - 1] : undefined;
          const showDivider = !prev || prev.memberId !== m.memberId;
          return (
            <Fragment key={i}>
              {showDivider && <MemberDivider label={m.memberLabel} />}
              <MessageBubble message={m} />
            </Fragment>
          );
        })}

        {loading && <LoadingSkeleton />}

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
          ref={inputRef}
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

function ExamplePrompts({ onSelect }: { onSelect: (text: string) => void }) {
  return (
    <div className="py-6 flex flex-col items-center gap-3">
      <span className="text-xs text-zinc-500">Try one of these:</span>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className="text-sm text-zinc-700 hover:text-zinc-900 border border-zinc-200 hover:border-zinc-300 rounded px-3 py-2 transition-colors"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MemberDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex-1 border-t border-zinc-200" />
      <span className="text-xs text-zinc-500 px-2 whitespace-nowrap">{label}</span>
      <div className="flex-1 border-t border-zinc-200" />
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

function LoadingSkeleton() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] w-96 bg-white border border-zinc-200 px-4 py-3 rounded-lg flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="w-14 h-5 bg-zinc-200 rounded animate-pulse" />
          <div className="w-32 h-4 bg-zinc-200 rounded animate-pulse" />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="w-3/4 h-4 bg-zinc-200 rounded animate-pulse" />
          <div className="w-full h-4 bg-zinc-200 rounded animate-pulse" />
          <div className="w-2/3 h-4 bg-zinc-200 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
