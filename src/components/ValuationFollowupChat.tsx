"use client";

import { useState, useTransition } from "react";
import { askValuationFollowupAction } from "@/app/dashboard/position/[id]/actions";
import type { ValuationChatTurn } from "@/lib/valuationChats";

// Conversational follow-up area on the Valoración tab. Renders the
// per-ticker chat history grouped by valuation snapshot (so when the
// math has been regenerated since a turn, the user sees the IV/method
// of the moment it was asked under) and a textarea to ask a new
// question. Always uses Sonnet 4.6 server-side; per-turn cost is
// negligible at personal-tool scale.
export default function ValuationFollowupChat({
  positionId,
  ticker,
  initialHistory,
}: {
  positionId: number;
  ticker: string;
  initialHistory: ValuationChatTurn[];
}) {
  const [history, setHistory] = useState<ValuationChatTurn[]>(initialHistory);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = () => {
    setError(null);
    const trimmed = draft.trim();
    if (trimmed.length < 3) {
      setError("Escribe una pregunta.");
      return;
    }
    startTransition(async () => {
      const r = await askValuationFollowupAction(positionId, trimmed);
      if (r.ok) {
        setHistory((prev) => [...prev, r.turn]);
        setDraft("");
      } else {
        setError(r.error);
      }
    });
  };

  // Group consecutive turns by snapshot signature so we can render a
  // divider when the math has changed between two adjacent questions.
  // The first group always gets a header — even on a fresh chat — so
  // the user knows what context backed the first answer.
  const grouped = groupTurnsBySnapshot(history);

  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <header className="mb-3">
        <h3 className="text-base font-semibold text-navy-900">
          Pregúntale a Moatboard sobre esta valoración
        </h3>
        <p className="mt-1 text-xs italic text-navy-500">
          No reemplaza tu juicio. Úsalo para desafiar tus asunciones, no
          para validarlas.
        </p>
      </header>

      {grouped.length === 0 ? (
        <p className="mb-4 rounded-lg border border-dashed border-navy-200 bg-navy-50/40 px-4 py-3 text-xs text-navy-500">
          Sin conversaciones todavía. Cuando preguntes algo, Moatboard
          responderá usando los datos exactos que ves arriba (método, IV,
          asunciones, distribuciones, moat, tier).
        </p>
      ) : (
        <div className="mb-4 space-y-5">
          {grouped.map((group, gi) => (
            <div key={gi} className="space-y-3">
              <SnapshotDivider snapshot={group.snapshot} firstAt={group.turns[0].asked_at} />
              {group.turns.map((turn) => (
                <ChatTurn key={turn.id} turn={turn} ticker={ticker} />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          disabled={isPending}
          placeholder="¿Por qué DCF y P/B discrepan tanto? · ¿Qué asume el modelo sobre el moat? · ¿Qué tendría que cambiar para que P/B sea realmente barato?"
          className="w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-navy-400 focus:border-navy-400 focus:outline-none disabled:opacity-60"
          onKeyDown={(e) => {
            // Cmd/Ctrl + Enter sends.
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSubmit}
            disabled={isPending || draft.trim().length < 3}
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "Pensando…" : "Preguntar"}
          </button>
          <span className="text-[11px] text-navy-400">
            Cmd/Ctrl + Enter para enviar · Sonnet 4.6
          </span>
          {error && (
            <span className="text-xs text-red-700">
              <span aria-hidden className="mr-1">
                ✗
              </span>
              {error}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

function ChatTurn({
  turn,
  ticker,
}: {
  turn: ValuationChatTurn;
  ticker: string;
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-navy-200 bg-navy-50/60 px-4 py-3 text-sm text-navy-900">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
          Tú · {formatTurnDate(turn.asked_at)}
        </div>
        <div className="whitespace-pre-wrap">{turn.question}</div>
      </div>
      <div className="rounded-lg border border-navy-100 bg-white px-4 py-3 text-sm text-navy-800">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-500">
          Moatboard sobre {ticker}
        </div>
        <Markdown text={turn.answer} />
      </div>
    </div>
  );
}

function SnapshotDivider({
  snapshot,
  firstAt,
}: {
  snapshot: ValuationChatTurn["snapshot"];
  firstAt: string;
}) {
  const iv = snapshot.iv_base.toFixed(2);
  const px = snapshot.current_price.toFixed(2);
  const mos = (snapshot.mos_pct * 100).toFixed(0);
  return (
    <div className="flex items-center gap-3 pt-1">
      <div className="h-px flex-1 bg-navy-200" />
      <span className="text-[10px] uppercase tracking-wider text-navy-500">
        Sobre la valoración del {formatShortDate(firstAt)} · IV ${iv} · Px $
        {px} · MoS {mos}% · {snapshot.method}
      </span>
      <div className="h-px flex-1 bg-navy-200" />
    </div>
  );
}

// Group consecutive turns whose snapshot is "the same valuation"
// (same method + same IV base to the cent + same current price to the
// cent + same MoS to one decimal). When any of those changes, a new
// group starts so the UI renders a fresh divider above the next turn.
function groupTurnsBySnapshot(
  turns: ValuationChatTurn[],
): Array<{ snapshot: ValuationChatTurn["snapshot"]; turns: ValuationChatTurn[] }> {
  const groups: Array<{
    snapshot: ValuationChatTurn["snapshot"];
    turns: ValuationChatTurn[];
  }> = [];
  let lastSig: string | null = null;
  for (const t of turns) {
    const sig = `${t.snapshot.method}|${t.snapshot.iv_base.toFixed(2)}|${t.snapshot.current_price.toFixed(2)}|${t.snapshot.mos_pct.toFixed(3)}`;
    if (sig !== lastSig) {
      groups.push({ snapshot: t.snapshot, turns: [t] });
      lastSig = sig;
    } else {
      groups[groups.length - 1].turns.push(t);
    }
  }
  return groups;
}

function formatTurnDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// Minimal markdown renderer matching the AI output convention used
// elsewhere (signal summaries): paragraphs, bullet lists, **bold**.
// Keeps the chat answers readable without pulling in a full library.
function Markdown({ text }: { text: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-navy-800">
      {blocks.map((block, i) => {
        const looksLikeList = /^\s*[-*]\s+/m.test(block);
        if (looksLikeList) {
          const items = block
            .split(/\n/)
            .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
            .filter(Boolean);
          return (
            <ul key={i} className="ml-4 list-disc space-y-1">
              {items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*(.+?)\*\*$/);
    if (m) {
      return (
        <strong key={i} className="font-semibold text-navy-900">
          {m[1]}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
