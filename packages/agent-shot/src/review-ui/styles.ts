/** The review page's CSS. Neutral on purpose: it sits outside the app's design system, like the variant picker. */
export const reviewStyles = `
:root {
  color-scheme: light;
  --canvas: #e6e6e9;
  --panel: #ffffff;
  --line: oklch(0 0 0 / 0.09);
  --text: #18181b;
  --muted: #6b6b76;
  --accent: #0d6efd;
  --accent-soft: oklch(0.6 0.2 260 / 0.12);
  --mark: #e5254b;
  --radius: 8px;
  font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box }
html, body { margin: 0; height: 100%; color: var(--text); background: var(--canvas) }
button, input, select, textarea { font: inherit; color: inherit }
button { cursor: pointer }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }
.app { display: grid; grid-template: 52px 1fr / 232px 1fr 312px; height: 100vh }
.top { grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 0 12px 0 16px; background: var(--panel); box-shadow: 0 1px 0 var(--line); z-index: 2 }
.brand { font-weight: 650; white-space: nowrap }
.brand span { color: var(--muted); font-weight: 500 }
.ask { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted) }
.ask strong { color: var(--text); font-weight: 600 }
.status { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap }
.btn { height: 32px; padding: 0 12px; border-radius: 6px; border: 0; background: oklch(0 0 0 / 0.05); transition-property: scale, background-color; transition-duration: 120ms }
.btn:hover { background: oklch(0 0 0 / 0.09) }
.btn:active { scale: 0.96 }
.btn.primary { background: var(--accent); color: #fff; font-weight: 600 }
.btn.primary:hover { background: #0b5ed7 }
.btn kbd { margin-left: 6px; opacity: 0.7; font: 11px ui-monospace, Menlo, monospace }
.pick { display: flex; align-items: center; gap: 8px; color: var(--muted); white-space: nowrap }
.pick-select { height: 32px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); padding: 0 8px; max-width: 240px; color: var(--text) }
.sheets { background: var(--panel); box-shadow: 1px 0 0 var(--line); overflow: auto; padding: 8px }
.sheets h2, .panel h2 { margin: 8px 8px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted) }
.sheet { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; border: 0; background: none; padding: 8px; border-radius: 6px }
.sheet:hover { background: oklch(0 0 0 / 0.04) }
.sheet[aria-current='true'] { background: var(--accent-soft) }
.sheet-title { overflow-wrap: anywhere }
.sheet-meta { font-size: 12px; color: var(--muted) }
.sheet-meta.voted { color: var(--accent) }
.main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0 }
.toolbar { position: absolute; z-index: 1; left: 50%; bottom: 16px; translate: -50% 0; display: flex; align-items: center; gap: 4px; padding: 4px; background: var(--panel); border-radius: 12px; box-shadow: 0 0 0 1px var(--line), 0 4px 16px oklch(0 0 0 / 0.12) }
.toolbar .sep { width: 1px; align-self: stretch; margin: 4px; background: var(--line) }
.tool { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-width: 36px; height: 36px; padding: 0 8px; border: 0; border-radius: 8px; background: none; color: var(--text); white-space: nowrap }
.tool:hover { background: oklch(0 0 0 / 0.05) }
.tool[aria-pressed='true'] { background: var(--accent); color: #fff }
.tool svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round }
.zoom { min-width: 52px; font-variant-numeric: tabular-nums; color: var(--muted) }
.stage { position: relative; flex: 1; overflow: hidden; cursor: default; touch-action: none }
.stage.panning, .stage.tool-move { cursor: grab }
.stage.dragging { cursor: grabbing }
.stage.tool-draw .frame { cursor: crosshair }
.world { position: absolute; left: 0; top: 0; transform-origin: 0 0; display: grid; grid-auto-flow: column; grid-template-rows: auto auto; column-gap: calc(40px / var(--zoom, 1)); row-gap: calc(8px / var(--zoom, 1)); align-items: start }
.cell { display: contents }
.cell-head { align-self: end; display: flex; align-items: flex-end; gap: 8px; font-size: calc(13px / var(--zoom, 1)); min-height: calc(32px / var(--zoom, 1)) }
.cell-name { font-weight: 650 }
.cell-key { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: calc(2px / var(--zoom, 1)) }
.cell-desc { color: var(--muted) }
.chip { display: inline-block; padding: 0 calc(6px / var(--zoom, 1)); border-radius: 999px; background: oklch(0 0 0 / 0.08); color: var(--muted); font-size: 0.85em; font-weight: 500 }
.cell-pick { margin-left: auto; height: calc(28px / var(--zoom, 1)); padding: 0 calc(10px / var(--zoom, 1)); border-radius: calc(6px / var(--zoom, 1)); border: 0; background: var(--panel); box-shadow: 0 0 0 1px var(--line); font-size: inherit; white-space: nowrap }
.cell-pick[aria-pressed='true'] { background: var(--accent); color: #fff; box-shadow: none; font-weight: 600 }
.frame { position: relative; background: #fff; box-shadow: 0 0 0 1px oklch(0 0 0 / 0.1), 0 2px 8px oklch(0 0 0 / 0.08) }
.cell.picked .frame { box-shadow: 0 0 0 calc(3px / var(--zoom, 1)) var(--accent), 0 2px 8px oklch(0 0 0 / 0.08) }
.frame img { display: block; user-select: none; -webkit-user-drag: none }
.frame svg { position: absolute; inset: 0; overflow: visible }
.frame g[data-note] { cursor: pointer }
.empty { display: grid; place-items: center; color: var(--muted); background: oklch(0 0 0 / 0.04); border: 1px dashed oklch(0 0 0 / 0.2) }
.panel { background: var(--panel); box-shadow: -1px 0 0 var(--line); overflow: auto; padding: 8px 8px 16px; display: flex; flex-direction: column; gap: 12px }
.group { display: flex; flex-direction: column; gap: 2px }
.choice { display: grid; grid-template-columns: 18px 1fr; gap: 2px 8px; align-items: start; padding: 8px; border-radius: 6px; cursor: pointer }
.choice:hover { background: oklch(0 0 0 / 0.04) }
.choice input { margin: 2px 0 0; accent-color: var(--accent) }
.choice small { grid-column: 2; color: var(--muted) }
textarea { width: 100%; min-height: 56px; resize: vertical; padding: 8px; border-radius: 6px; border: 1px solid var(--line); background: #fafafa }
textarea:focus { background: #fff }
.field { padding: 0 8px; display: flex; flex-direction: column; gap: 6px }
.notes { display: flex; flex-direction: column; gap: 6px; padding: 0 8px }
.note { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; box-shadow: 0 0 0 1px var(--line) }
.note.selected { box-shadow: 0 0 0 2px var(--accent) }
.note-head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted) }
.note-num { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--mark); color: #fff; font-weight: 700; font-size: 11px; font-variant-numeric: tabular-nums }
.note-del { margin-left: auto; border: 0; background: none; color: var(--muted); width: 28px; height: 28px; border-radius: 6px }
.note-del:hover { background: oklch(0 0 0 / 0.06); color: var(--text) }
.hint { padding: 0 8px; color: var(--muted); font-size: 12px }
.hint kbd, .flip-hint kbd { font: 11px ui-monospace, Menlo, monospace; padding: 1px 4px; border-radius: 4px; background: oklch(0 0 0 / 0.06) }
.flip-hint { position: absolute; z-index: 1; top: 12px; left: 50%; translate: -50% 0; padding: 6px 12px; border-radius: 999px; background: oklch(0.2 0 0 / 0.85); color: #fff; font-size: 12px }
.flip-hint kbd { background: oklch(1 0 0 / 0.15) }
.done { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; background: oklch(0.9 0 0 / 0.75); backdrop-filter: blur(6px) }
.done div { padding: 24px 32px; border-radius: 12px; background: var(--panel); box-shadow: 0 8px 32px oklch(0 0 0 / 0.15); text-align: center; max-width: 420px }
.done h1 { margin: 0 0 4px; font-size: 16px }
.done p { margin: 0; color: var(--muted) }
`
