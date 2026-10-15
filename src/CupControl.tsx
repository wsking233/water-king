import { useEffect, useRef, useState } from "react";
import { Droplet } from "lucide-react";
import { heldProgress } from "./cupMotion";

type Props = {
  capacity: number;
  progress: number;
  disabled: boolean;
  onCommit: (amount: number) => void;
  onHolding: (holding: boolean) => void;
};
export function CupControl({
  capacity,
  progress,
  disabled,
  onCommit,
  onHolding,
}: Props) {
  const [preview, setPreview] = useState(progress),
    [holding, setHolding] = useState(false);
  const frame = useRef(0),
    session = useRef<{ start: number; time: number; value: number } | null>(
      null,
    );
  const callbacks = useRef({ onCommit, onHolding });
  callbacks.current = { onCommit, onHolding };
  function stop(commit: boolean) {
    const current = session.current;
    if (!current) return;
    cancelAnimationFrame(frame.current);
    session.current = null;
    setHolding(false);
    callbacks.current.onHolding(false);
    setPreview(progress);
    if (commit && current.value > current.start)
      callbacks.current.onCommit(current.value);
  }
  function start() {
    if (disabled || progress >= capacity || session.current) return;
    session.current = {
      start: progress,
      time: performance.now(),
      value: progress,
    };
    setHolding(true);
    callbacks.current.onHolding(true);
    function tick(time: number) {
      const current = session.current;
      if (!current) return;
      current.value = heldProgress(
        current.start,
        capacity,
        time - current.time,
      );
      setPreview(current.value);
      if (current.value < capacity) frame.current = requestAnimationFrame(tick);
    }
    frame.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    setPreview(progress);
  }, [progress]);
  useEffect(() => {
    if (disabled) stop(false);
  }, [disabled]);
  useEffect(() => {
    const cancel = () => stop(false);
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelAnimationFrame(frame.current);
      session.current = null;
      callbacks.current.onHolding(false);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const remaining = capacity - (holding ? preview : progress);
  return (
    <button
      className={`hold-cup-area ${holding ? "is-holding" : ""}`}
      disabled={disabled || progress >= capacity}
      aria-label="长按水杯展示区记录喝水，松手保存"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (!e.isPrimary || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={() => stop(true)}
      onPointerCancel={() => stop(false)}
      onLostPointerCapture={() => stop(false)}
      onBlur={() => stop(false)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!e.repeat) start();
        }
        if (e.key === "Escape") stop(false);
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          stop(true);
        }
      }}
    >
      <span className="hold-cup" aria-hidden="true">
        <span className="mug-handle" aria-hidden="true" />
        <span className="glass-rim" />
        <span className="glass-body">
          <span
            className="glass-water"
            style={{ height: `${(remaining / capacity) * 100}%` }}
          >
            <span className="water-wave" />
          </span>
          <span className="glass-shine" />

          <Droplet className="glass-drop" size={28} />
        </span>
      </span>
      <span className="remaining-copy">
        <span>{remaining === 0 ? "这杯喝完啦" : "大约还剩"}</span>
        <strong>
          {remaining}
          <small> ml</small>
        </strong>
      </span>
      <span className="hold-hint">
        {holding
          ? "水位慢慢下降，差不多就松手"
          : progress >= capacity
            ? "加满水，继续你的节奏"
            : "长按此区域任意位置 · 松手记录"}
      </span>
    </button>
  );
}
