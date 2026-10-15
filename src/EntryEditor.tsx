import { useState } from "react";
import { localInputDate } from "./dataTools";
import type { Entry, Kind } from "./records";
export function EntryEditor({
  entry,
  date,
  onSave,
}: {
  entry: Entry | null;
  date: Date;
  onSave: (input: {
    id?: string;
    kind: Kind;
    amount: number;
    at: string;
  }) => void;
}) {
  const [kind, setKind] = useState<Kind>(entry?.kind ?? "water");
  const [amount, setAmount] = useState(String(entry?.amount ?? 250));
  const [at, setAt] = useState(
    localInputDate(entry ? new Date(entry.at) : date),
  );
  return (
    <form
      className="entry-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          id: entry?.id,
          kind,
          amount: kind === "small" ? 1 : Number(amount),
          at,
        });
      }}
    >
      <div className="editor-types">
        {(["water", "small"] as const).map((k) => (
          <button
            type="button"
            key={k}
            aria-pressed={k === kind}
            onClick={() => {
              setKind(k);
              if (k === "water" && kind === "small") setAmount("250");
            }}
          >
            {k === "water" ? "喝水" : "嘘嘘"}
          </button>
        ))}
      </div>
      <label>
        记录时间
        <input
          aria-label="记录时间"
          type="datetime-local"
          required
          max={localInputDate(new Date())}
          value={at}
          onChange={(e) => setAt(e.target.value)}
        />
      </label>
      {kind === "water" ? (
        <label>
          大约喝了多少（ml）
          <input
            aria-label="补记饮水量"
            type="number"
            inputMode="numeric"
            min="1"
            max="5000"
            step="1"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      ) : (
        <p className="sheet-description">记录一次嘘嘘。</p>
      )}
      <p className="sheet-description">
        按大概的水量记录就好，不需要精确测量。
      </p>
      <button className="primary">{entry ? "保存修改" : "保存补记"}</button>
    </form>
  );
}
