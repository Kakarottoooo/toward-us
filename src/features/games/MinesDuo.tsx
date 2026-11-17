import { ArrowClockwise, Bomb, Flag, Lightbulb, X } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { localized } from "../../i18n";
import type { ScreenProps } from "./MatchScreen";
import "./arcade-table.css";

type Cell = { kind: "open"; count: number } | { kind: "hidden" | "mine" | "hit" | "flag" | "incorrect" };
type Field = { cells: Cell[]; size: number; count: number; flags: number; opened: number; safe: number; hints: number; outcome: "win" | "loss" | null; revision: number };

export function MinesDuo({ match, language, act, onRematch }: ScreenProps<Field>) {
  const t = (zh: string, en: string, es: string) => localized(language, zh, en, es);
  const { cells, size, count, flags, opened, safe, hints, outcome, revision } = match.state;
  const [tool, setTool] = useState<"open" | "flag">("open");
  const [busy, setBusy] = useState(false), [confirmEnd, setConfirmEnd] = useState(false);
  const pending = useRef(false);
  async function move(type: "open" | "flag" | "hint" | "abandon", index?: number) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await act({ type, index, revision }); }
    finally { pending.current = false; setBusy(false); }
  }

  return <section className="mines-duo" data-testid="mines-duo">
    <div className="mines-summary" role="status">
      <span><Flag size={17} weight="fill" />{t(`还可标 ${count - flags} 面旗`, `${count - flags} flags left`, `Quedan ${count - flags} banderas`)}</span>
      <span>{t(`打开 ${opened}/${safe} 格`, `${opened}/${safe} safe tiles open`, `${opened}/${safe} casillas seguras`)}</span>
    </div>
    <div className="mines-grid" role="group" aria-label={t("共同雷区", "Shared minefield", "Campo minado compartido")} style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
      {cells.map((cell, index) => {
        const row = Math.floor(index / size) + 1, column = index % size + 1;
        const position = t(`第 ${row} 行第 ${column} 列`, `Row ${row}, column ${column}`, `Fila ${row}, columna ${column}`);
        const label = cell.kind === "open" ? t(`附近 ${cell.count} 个雷`, `${cell.count} nearby mines`, `${cell.count} minas cerca`) : cell.kind === "hidden" ? t("未翻开", "Covered", "Tapada") : cell.kind === "flag" ? t("有旗子", "Flagged", "Marcada") : cell.kind === "incorrect" ? t("旗子标错了", "Incorrect flag", "Bandera incorrecta") : t("有雷", "Mine", "Mina");
        const blocked = Boolean(outcome) || busy || cell.kind === "open" || (tool === "open" && cell.kind === "flag") || (tool === "flag" && flags >= count && cell.kind !== "flag");
        return <button key={index} type="button" className={`mines-tile is-${cell.kind}`} disabled={blocked}
          data-testid={`mines-cell-${index}`} data-kind={cell.kind} data-count={cell.kind === "open" ? cell.count : undefined}
          aria-label={position + ", " + label} onClick={() => void move(tool, index)}>
          {cell.kind === "open" && cell.count > 0 ? <b className={`mines-number c${cell.count}`}>{cell.count}</b> :
            cell.kind === "flag" || cell.kind === "incorrect" ? <Flag size={20} weight={cell.kind === "flag" ? "fill" : "regular"} aria-hidden="true" /> :
              cell.kind === "mine" || cell.kind === "hit" ? <Bomb size={20} weight="fill" aria-hidden="true" /> : null}
        </button>;
      })}
    </div>
    {outcome ? <div className="arcade-table-outcome" role="status" data-testid="mines-result">
      <strong>{outcome === "win" ? t("你们扫完啦！", "You cleared the field!", "¡Despejaron el campo!") : t("踩到雷了！", "That was a mine!", "¡Era una mina!")}</strong>
      <button type="button" className="game-primary" onClick={onRematch} data-testid="mines-rematch"><ArrowClockwise size={17} />{t("换一张地图", "Play a new board", "Jugar otro tablero")}</button>
    </div> : <>
      <div className="mines-tools" role="group" aria-label={t("选择操作", "Choose a tool", "Elige una acción")}>
        <button type="button" aria-pressed={tool === "open"} className={tool === "open" ? "is-selected" : ""} data-testid="mines-tool-open" onClick={() => setTool("open")}>{t("翻开", "Reveal", "Abrir")}</button>
        <button type="button" aria-pressed={tool === "flag"} className={tool === "flag" ? "is-selected" : ""} data-testid="mines-tool-flag" onClick={() => setTool("flag")}><Flag size={17} />{t("标雷", "Flag", "Marcar")}</button>
      </div>
      <p className="arcade-table-note">{opened ? t("数字是周围八格里的雷数。你们都可以翻格或插旗。", "A number tells you how many mines touch that tile. You can both reveal and flag.", "Cada número indica cuántas minas tocan esa casilla. Los dos pueden abrir y marcar.") : t("第一格可以放心翻，周围也没有雷。", "The first tile and the spaces around it are safe.", "La primera casilla y las de alrededor son seguras.")}</p>
      <div className="arcade-table-actions">
        <button type="button" className="game-quiet" disabled={busy || !opened || !hints} onClick={() => void move("hint")} data-testid="mines-hint"><Lightbulb size={16} />{t(`提示 ${hints}`, `Hints ${hints}`, `Pistas ${hints}`)}</button>
        <button type="button" className="game-quiet" disabled={busy} onBlur={() => setConfirmEnd(false)} onClick={() => confirmEnd ? void move("abandon") : setConfirmEnd(true)}><X size={16} />
          {confirmEnd ? t("确认结束", "End for both?", "¿Terminar para ambos?") : t("结束", "End", "Terminar")}</button>
      </div>
    </>}
  </section>;
}
