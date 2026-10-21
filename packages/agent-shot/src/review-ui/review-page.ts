import type { Note, Point, ReviewCell, ReviewDraft, ReviewPage, Mark, Vote } from '../review/domain/review.ts'
import { numberedNotes, marksSvg } from '../review/marks.ts'
import { reviewStyles } from './styles.ts'

/**
 * The review page (F22–F35): labels side by side on a pan-and-zoom canvas, votes, and pins, boxes, arrows and pen
 * strokes on the stills. Runs in the browser without Effect; talks to the review server with the session token.
 */

type Tool = 'move' | 'pin' | 'box' | 'arrow' | 'pen'

type Gesture =
  | { readonly kind: 'pan'; readonly startX: number; readonly startY: number; readonly x: number; readonly y: number }
  | {
      readonly kind: 'draw'
      readonly tool: Exclude<Tool, 'move'>
      readonly label: string
      readonly svg: SVGSVGElement
      readonly width: number
      readonly height: number
      readonly start: Point
      current: Point
      readonly points: Array<Point>
    }

interface State {
  page: ReviewPage
  draft: ReviewDraft
  sheet: number
  variant: string
  flip: string | null
  tool: Tool
  zoom: number
  x: number
  y: number
  selected: string | null
  spaceHeld: boolean
  gesture: Gesture | null
  saving: 'saved' | 'saving' | 'failed'
  ended: boolean
  fitPending: boolean
}

const token = new URLSearchParams(location.search).get('t') ?? ''
const headers = { 'x-shot-token': token, 'content-type': 'application/json' }
const minZoom = 0.05
const maxZoom = 8

const icons: Readonly<Record<Tool, string>> = {
  move: '<path d="M5 3l12 7-5 1.5L9.5 17z"/>',
  pin: '<path d="M10 17s-5-4.6-5-8.5a5 5 0 0 1 10 0C15 12.4 10 17 10 17z"/><circle cx="10" cy="8.5" r="1.8"/>',
  box: '<rect x="3.5" y="5" width="13" height="10" rx="1.5"/>',
  arrow: '<path d="M4 16L16 4M8 4h8v8"/>',
  pen: '<path d="M3.5 16.5c2-1 3.5-4 5.5-6s4-3.2 5.5-5.5M13 3.5l3.5 3.5"/>',
}

const toolNames: Readonly<Record<Tool, { readonly name: string; readonly key: string }>> = {
  move: { name: 'Move', key: 'V' },
  pin: { name: 'Comment', key: 'C' },
  box: { name: 'Box', key: 'R' },
  arrow: { name: 'Arrow', key: 'A' },
  pen: { name: 'Pen', key: 'P' },
}

const tools: ReadonlyArray<Tool> = ['move', 'pin', 'box', 'arrow', 'pen']

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const displayLabel = (label: string) => (label === '' ? 'shot' : label)

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] => {
  const created = document.createElement(tag)
  created.className = className

  return created
}

const style = document.createElement('style')

style.textContent = reviewStyles

document.head.append(style)

const root = document.querySelector<HTMLElement>('#app')!

root.innerHTML = '<p style="padding:24px">Loading the review…</p>'

const fail = (message: string) => {
  root.innerHTML = `<p style="padding:24px">${escapeHtml(message)}</p>`
}

const loadPage = async (): Promise<ReviewPage | undefined> => {
  const response = await fetch(`/api/review?t=${token}`, { headers }).catch(() => undefined)

  if (response === undefined || !response.ok) return undefined
  const page: ReviewPage = await response.json()

  return page
}

const emptyPage: ReviewPage = {
  round: 1,
  ask: '',
  labels: [],
  sheets: [],
  draft: { votes: [], notes: [], pick: null, comment: '' },
  previous: [],
}

const state: State = {
  page: emptyPage,
  draft: emptyPage.draft,
  sheet: 0,
  variant: '',
  flip: null,
  tool: 'move',
  zoom: 1,
  x: 0,
  y: 0,
  selected: null,
  spaceHeld: false,
  gesture: null,
  saving: 'saved',
  ended: false,
  fitPending: true,
}

const votingLabels = () => state.page.labels.filter((label) => !label.base)
const currentSheet = () => state.page.sheets[state.sheet]!

const currentVariant = () =>
  currentSheet().variants.find((column) => column.variant === state.variant) ?? currentSheet().variants[0]!

const voteOf = (sheet: string): Vote | undefined => state.draft.votes.find((vote) => vote.sheet === sheet)

const numbers = () =>
  new Map(
    numberedNotes({ notes: state.draft.notes, sheets: state.page.sheets.map((sheet) => sheet.key) }).map(
      ({ note, number }) => [note.id, number],
    ),
  )

const cellNotes = ({ notes, label }: { readonly notes: ReadonlyArray<Note>; readonly label: string }) =>
  notes.filter(
    (note) => note.sheet === currentSheet().key && note.variant === currentVariant().variant && note.label === label,
  )

// Shell

const app = element('div', 'app')
const top = element('header', 'top')
const sheetsAside = element('nav', 'sheets')
const main = element('main', 'main')
const stage = element('div', 'stage')
const world = element('div', 'world')
const toolbar = element('div', 'toolbar')
const flipHint = element('div', 'flip-hint')
const panel = element('aside', 'panel')

sheetsAside.setAttribute('aria-label', 'Sheets')

panel.setAttribute('aria-label', 'Vote and notes')

toolbar.setAttribute('role', 'toolbar')

toolbar.setAttribute('aria-label', 'Tools')

stage.append(world)

main.append(stage, toolbar, flipHint)

app.append(top, sheetsAside, main, panel)

// Draft

let saveTimer: ReturnType<typeof setTimeout> | undefined

const saveDraft = () => {
  state.saving = 'saving'
  renderStatus()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    const saved = await fetch(`/api/draft?t=${token}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(state.draft),
    }).catch(() => undefined)

    state.saving = saved?.ok === true ? 'saved' : 'failed'
    renderStatus()
  }, 300)
}

const updateDraft = (draft: ReviewDraft) => {
  state.draft = draft
  saveDraft()
}

const setVote = ({ sheet, pick }: { readonly sheet: string; readonly pick: string | null | undefined }) => {
  const others = state.draft.votes.filter((vote) => vote.sheet !== sheet)
  const comment = voteOf(sheet)?.comment ?? ''
  updateDraft({ ...state.draft, votes: pick === undefined ? others : [...others, { sheet, pick, comment }] })
}

const addNote = (note: Note) => {
  updateDraft({ ...state.draft, notes: [...state.draft.notes, note] })
  state.selected = note.id
}

const removeNote = (id: string) => {
  updateDraft({ ...state.draft, notes: state.draft.notes.filter((note) => note.id !== id) })

  if (state.selected === id) state.selected = null
}

const isEmptyDraft = () =>
  state.draft.votes.length === 0 &&
  state.draft.notes.length === 0 &&
  state.draft.pick === null &&
  state.draft.comment.trim() === ''

// Rendering

const statusText = () => {
  if (state.saving === 'saving') return 'Saving…'

  if (state.saving === 'failed') return 'Draft not saved'

  return 'Draft saved'
}

function renderStatus() {
  const status = top.querySelector('.status')

  if (status !== null) status.textContent = statusText()
}

const mostVoted = () => {
  const counts = votingLabels().map((label) => ({
    label: label.label,
    count: state.draft.votes.filter((vote) => vote.pick === label.label).length,
  }))

  const most = Math.max(0, ...counts.map(({ count }) => count))

  return most === 0 ? null : (counts.find(({ count }) => count === most)?.label ?? null)
}

const renderTop = () => {
  const most = mostVoted()
  const automatic = most === null ? 'None yet' : `${displayLabel(most)} (most votes)`

  const options = [
    `<option value="">${escapeHtml(automatic)}</option>`,
    ...votingLabels().map(
      (label) =>
        `<option value="${escapeHtml(label.label)}" ${state.draft.pick === label.label ? 'selected' : ''}>${escapeHtml(displayLabel(label.label))}</option>`,
    ),
  ].join('')

  const ask = state.page.ask === '' ? '' : `<strong>Asked:</strong> ${escapeHtml(state.page.ask)}`

  top.innerHTML = `<div class="brand">shot review <span>· round ${state.page.round}</span></div>
<div class="ask" title="${escapeHtml(state.page.ask)}">${ask}</div>
<span class="status" aria-live="polite">${statusText()}</span>
<label class="pick">Overall pick <select class="pick-select">${options}</select></label>
<button class="btn" data-action="close">Close</button>
<button class="btn primary" data-action="submit">Send to agent<kbd>⌘↵</kbd></button>`
}

const renderSheets = () => {
  const counts = numbers()
  const heading = '<h2>Sheets</h2>'

  const items = state.page.sheets.map((sheet, index) => {
    const vote = voteOf(sheet.key)
    const notes = state.draft.notes.filter((note) => note.sheet === sheet.key && counts.has(note.id)).length

    const voted =
      vote === undefined ? 'No vote' : vote.pick === null ? 'None of these' : `Picked ${displayLabel(vote.pick)}`

    const meta = `${voted}${notes === 0 ? '' : ` · ${notes} ${notes === 1 ? 'note' : 'notes'}`}`

    return `<button class="sheet" data-sheet="${index}" aria-current="${index === state.sheet}">
<span class="sheet-title">${escapeHtml(sheet.title)}</span>
<span class="sheet-meta ${vote === undefined ? '' : 'voted'}">${escapeHtml(meta)}</span></button>`
  })

  sheetsAside.innerHTML = heading + items.join('')
}

const renderToolbar = () => {
  const toolButtons = tools.map((tool) => {
    const { name, key } = toolNames[tool]

    return `<button class="tool" data-tool="${tool}" aria-pressed="${state.tool === tool}" aria-label="${name} (${key})" title="${name} (${key})"><svg viewBox="0 0 20 20" aria-hidden="true">${icons[tool]}</svg></button>`
  })

  const variants = currentSheet().variants.map(
    (column) =>
      `<button class="tool" data-variant="${escapeHtml(column.variant)}" aria-pressed="${column.variant === currentVariant().variant}">${escapeHtml(column.variant)}</button>`,
  )

  const view = `<button class="tool" data-action="toggle-flip" aria-pressed="${state.flip !== null}" title="Flip between labels at full size (1–9)">Flip</button>`

  toolbar.innerHTML = [
    toolButtons.join(''),
    '<span class="sep"></span>',
    variants.join(''),
    '<span class="sep"></span>',
    view,
    `<button class="tool" data-action="fit" title="Zoom to fit (⇧1)">Fit</button>`,
    `<button class="tool zoom" data-action="actual" title="Zoom to 100% (⇧0)">${Math.round(state.zoom * 100)}%</button>`,
  ].join('')
}

const renderFlipHint = () => {
  if (state.flip === null) {
    flipHint.hidden = true

    return
  }

  const labels = state.page.labels
  const index = labels.findIndex((label) => label.label === state.flip)
  flipHint.hidden = false
  flipHint.innerHTML = `${index + 1} / ${labels.length} · ${escapeHtml(displayLabel(state.flip))} · <kbd>1</kbd>–<kbd>${labels.length}</kbd> or <kbd>←</kbd><kbd>→</kbd> to flip, <kbd>Esc</kbd> side by side`
}

const shownCells = (): ReadonlyArray<ReviewCell> =>
  state.flip === null ? currentVariant().cells : currentVariant().cells.filter((cell) => cell.label === state.flip)

const renderMarks = () => {
  const numbered = numbers()

  for (const frame of world.querySelectorAll<HTMLElement>('.frame[data-label]')) {
    const label = frame.dataset['label'] ?? ''
    const svg = frame.querySelector('svg')

    if (svg === null) continue

    const previous = cellNotes({ notes: state.page.previous, label }).map((note) => ({
      mark: note.mark,
      faded: true,
    }))

    const current = cellNotes({ notes: state.draft.notes, label }).map((note) => ({
      mark: note.mark,
      id: note.id,
      selected: note.id === state.selected,
      number: numbered.get(note.id) ?? 0,
    }))

    svg.innerHTML = marksSvg([...previous, ...current])
  }
}

const renderStage = () => {
  const labels = new Map(state.page.labels.map((label, index) => [label.label, { ...label, index }]))
  const vote = voteOf(currentSheet().key)

  world.innerHTML = shownCells()
    .map(({ label, cell }) => {
      const info = labels.get(label)!
      const picked = vote?.pick === label
      const chip = info.base ? '<span class="chip">base</span>' : ''

      const pick = info.base
        ? ''
        : `<button class="cell-pick" data-pick="${escapeHtml(label)}" aria-pressed="${picked}">${picked ? 'Picked' : 'Pick'}</button>`

      const description = info.description === '' ? '' : `<div class="cell-desc">${escapeHtml(info.description)}</div>`

      const head = `<div class="cell-head"><div><div><span class="cell-key">${info.index + 1}</span> <span class="cell-name">${escapeHtml(displayLabel(label))}</span> ${chip}</div>${description}</div>${pick}</div>`

      const frame =
        cell._tag === 'ShotCell'
          ? `<div class="frame" data-label="${escapeHtml(label)}"><img alt="${escapeHtml(displayLabel(label))} at ${escapeHtml(currentVariant().variant)}" data-scale="${cell.scale}" src="/files?t=${token}&file=${encodeURIComponent(cell.file)}"><svg xmlns="http://www.w3.org/2000/svg"></svg></div>`
          : `<div class="empty" style="width:360px;height:240px">${cell._tag === 'FailedCell' ? 'Failed to shoot' : 'Not shot in this variant'}</div>`

      return `<div class="cell ${picked ? 'picked' : ''}">${head}${frame}</div>`
    })
    .join('')

  const images = [...world.querySelectorAll<HTMLImageElement>('img')]

  const column = images.map((image) => {
    const size = () => {
      const scale = Number(image.dataset['scale'] ?? '1') || 1
      const width = image.naturalWidth / scale
      const height = image.naturalHeight / scale
      image.style.width = `${width}px`
      image.style.height = `${height}px`
      const svg = image.parentElement?.querySelector('svg')
      svg?.setAttribute('viewBox', `0 0 ${width} ${height}`)
      svg?.setAttribute('width', String(width))
      svg?.setAttribute('height', String(height))
    }

    return image
      .decode()
      .then(size)
      .catch(() => undefined)
  })

  Promise.all(column).then(() => {
    if (state.fitPending) fit()
    state.fitPending = false
  })

  renderMarks()
  renderFlipHint()
}

const noteTitle = (note: Note) =>
  `${displayLabel(note.label)} · ${note.variant} · ${{ Pin: 'Comment', Box: 'Box', Arrow: 'Arrow', Pen: 'Pen' }[note.mark._tag]}`

const renderPanel = () => {
  const sheet = currentSheet()
  const vote = voteOf(sheet.key)
  const numbered = numbers()

  const choices = votingLabels()
    .map((label) => {
      const description = label.description === '' ? '' : `<small>${escapeHtml(label.description)}</small>`

      return `<label class="choice"><input type="radio" name="vote" value="${escapeHtml(label.label)}" ${vote?.pick === label.label ? 'checked' : ''}><span>${escapeHtml(displayLabel(label.label))}</span>${description}</label>`
    })
    .join('')

  const none = `<label class="choice"><input type="radio" name="vote" value="" ${vote !== undefined && vote.pick === null ? 'checked' : ''}><span>None of these</span></label>`

  const notes = state.draft.notes
    .filter((note) => note.sheet === sheet.key)
    .map(
      (note) => `<div class="note ${note.id === state.selected ? 'selected' : ''}" data-note-card="${note.id}">
<div class="note-head"><span class="note-num">${numbered.get(note.id) ?? ''}</span><span>${escapeHtml(noteTitle(note))}</span><button class="note-del" data-delete="${note.id}" aria-label="Delete note ${numbered.get(note.id) ?? ''}">✕</button></div>
<textarea data-note-comment="${note.id}" placeholder="What should change here?" aria-label="Comment for note ${numbered.get(note.id) ?? ''}">${escapeHtml(note.comment)}</textarea></div>`,
    )
    .join('')

  const emptyNotes = `<p class="hint">Pick a tool below, then draw on a still: <kbd>C</kbd> comment, <kbd>R</kbd> box, <kbd>A</kbd> arrow, <kbd>P</kbd> pen.</p>`

  panel.innerHTML = `<section class="group"><h2>Vote on this sheet</h2>${choices}${none}
<div class="field"><textarea data-vote-comment ${vote === undefined ? 'disabled' : ''} placeholder="${vote === undefined ? 'Vote first, then say why' : 'Why (optional)'}" aria-label="Why this vote">${escapeHtml(vote?.comment ?? '')}</textarea>
${vote === undefined ? '' : '<button class="btn" data-action="clear-vote">Clear vote</button>'}</div></section>
<section class="group"><h2>Notes on this sheet</h2><div class="notes">${notes === '' ? emptyNotes : notes}</div></section>
<section class="group"><h2>For the agent</h2><div class="field"><textarea data-overall-comment placeholder="Anything else, across all sheets" aria-label="Overall comment">${escapeHtml(state.draft.comment)}</textarea></div></section>`
}

const applyTransform = () => {
  world.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.zoom})`
  world.style.setProperty('--zoom', String(state.zoom))
  const zoom = toolbar.querySelector('.zoom')

  if (zoom !== null) zoom.textContent = `${Math.round(state.zoom * 100)}%`
}

const renderStageClasses = () => {
  stage.classList.toggle('panning', state.spaceHeld)
  stage.classList.toggle('tool-move', state.tool === 'move')
  stage.classList.toggle('tool-draw', state.tool !== 'move' && !state.spaceHeld)
  stage.classList.toggle('dragging', state.gesture?.kind === 'pan')
}

const renderAll = () => {
  renderTop()
  renderSheets()
  renderToolbar()
  renderStage()
  renderPanel()
  renderStageClasses()
  applyTransform()
}

// Zoom and pan

const zoomAt = ({ zoom, x, y }: { readonly zoom: number; readonly x: number; readonly y: number }) => {
  const next = Math.min(maxZoom, Math.max(minZoom, zoom))
  state.x = x - ((x - state.x) * next) / state.zoom
  state.y = y - ((y - state.y) * next) / state.zoom
  state.zoom = next
  applyTransform()
}

function fit() {
  const bounds = stage.getBoundingClientRect()
  const width = world.offsetWidth
  const height = world.offsetHeight

  if (width === 0 || height === 0) return
  const margin = 48
  const bottom = 72
  const zoom = Math.min(1, (bounds.width - margin * 2) / width, (bounds.height - margin - bottom) / height)
  state.zoom = Math.max(minZoom, zoom)
  state.x = (bounds.width - width * state.zoom) / 2
  state.y = margin
  applyTransform()
}

const actualSize = () => {
  const bounds = stage.getBoundingClientRect()
  zoomAt({ zoom: 1, x: bounds.width / 2, y: bounds.height / 2 })
}

stage.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    const bounds = stage.getBoundingClientRect()

    if (event.ctrlKey || event.metaKey) {
      zoomAt({
        zoom: state.zoom * Math.exp(-event.deltaY * 0.01),
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })

      return
    }

    state.x -= event.deltaX
    state.y -= event.deltaY
    applyTransform()
  },
  { passive: false },
)

// Drawing

const pointIn = ({
  svg,
  width,
  height,
  event,
}: {
  readonly svg: SVGSVGElement
  readonly width: number
  readonly height: number
  readonly event: PointerEvent
}): Point => {
  const bounds = svg.getBoundingClientRect()
  const x = ((event.clientX - bounds.left) / bounds.width) * width
  const y = ((event.clientY - bounds.top) / bounds.height) * height

  return { x: Math.min(width, Math.max(0, x)), y: Math.min(height, Math.max(0, y)) }
}

const markOfGesture = (gesture: Extract<Gesture, { kind: 'draw' }>): Mark | null => {
  const { start, current } = gesture
  const distance = Math.hypot(current.x - start.x, current.y - start.y)

  switch (gesture.tool) {
    case 'pin':
      return { _tag: 'Pin', x: start.x, y: start.y }
    case 'box':
      return distance < 4
        ? null
        : {
            _tag: 'Box',
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            width: Math.abs(current.x - start.x),
            height: Math.abs(current.y - start.y),
          }
    case 'arrow':
      return distance < 6 ? null : { _tag: 'Arrow', from: start, to: current }
    case 'pen':
      return gesture.points.length < 2 ? null : { _tag: 'Pen', points: gesture.points }
  }
}

const drawPreview = (gesture: Extract<Gesture, { kind: 'draw' }>) => {
  const mark = markOfGesture(gesture)
  gesture.svg.querySelector('[data-preview]')?.remove()

  if (mark === null || mark._tag === 'Pin') return
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('data-preview', '')
  group.innerHTML = marksSvg([{ mark }])
  gesture.svg.append(group)
}

const newId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const focusNoteComment = (id: string) => {
  panel.querySelector<HTMLTextAreaElement>(`[data-note-comment="${id}"]`)?.focus()
}

const finishDrawing = (gesture: Extract<Gesture, { kind: 'draw' }>) => {
  gesture.svg.querySelector('[data-preview]')?.remove()
  const mark = markOfGesture(gesture)

  if (mark === null) return
  const id = newId()
  addNote({ id, sheet: currentSheet().key, label: gesture.label, variant: currentVariant().variant, mark, comment: '' })
  renderMarks()
  renderPanel()
  renderSheets()
  focusNoteComment(id)
}

stage.addEventListener('pointerdown', (event) => {
  if (state.ended) return
  const target = event.target instanceof Element ? event.target : null

  if (target === null || target.closest('button') !== null) return
  const noteMark = target.closest<SVGGElement>('g[data-note]')
  const frame = target.closest<HTMLElement>('.frame[data-label]')
  const pan = state.spaceHeld || event.button === 1 || state.tool === 'move'

  if (noteMark !== null && !state.spaceHeld && event.button === 0) {
    state.selected = noteMark.dataset['note'] ?? null
    renderMarks()
    renderPanel()

    if (state.selected !== null) focusNoteComment(state.selected)

    return
  }

  if (pan || frame === null || event.button !== 0) {
    state.gesture = { kind: 'pan', startX: event.clientX, startY: event.clientY, x: state.x, y: state.y }
    stage.setPointerCapture(event.pointerId)
    renderStageClasses()

    return
  }

  const svg = frame.querySelector('svg')
  const viewBox = svg?.viewBox.baseVal

  if (svg === null || viewBox === undefined || viewBox.width === 0) return
  const start = pointIn({ svg, width: viewBox.width, height: viewBox.height, event })
  const tool = state.tool === 'move' ? 'pin' : state.tool

  state.gesture = {
    kind: 'draw',
    tool,
    label: frame.dataset['label'] ?? '',
    svg,
    width: viewBox.width,
    height: viewBox.height,
    start,
    current: start,
    points: [start],
  }
  stage.setPointerCapture(event.pointerId)
})

stage.addEventListener('pointermove', (event) => {
  const gesture = state.gesture

  if (gesture === null) return

  if (gesture.kind === 'pan') {
    state.x = gesture.x + event.clientX - gesture.startX
    state.y = gesture.y + event.clientY - gesture.startY
    applyTransform()

    return
  }

  const point = pointIn({ svg: gesture.svg, width: gesture.width, height: gesture.height, event })
  const last = gesture.points.at(-1)!
  gesture.current = point

  if (Math.hypot(point.x - last.x, point.y - last.y) >= 2) gesture.points.push(point)
  drawPreview(gesture)
})

const endGesture = () => {
  const gesture = state.gesture
  state.gesture = null

  if (gesture?.kind === 'draw') finishDrawing(gesture)
  renderStageClasses()
}

stage.addEventListener('pointerup', endGesture)

stage.addEventListener('pointercancel', () => {
  if (state.gesture?.kind === 'draw') state.gesture.svg.querySelector('[data-preview]')?.remove()
  state.gesture = null
  renderStageClasses()
})

// Controls

const showSheet = (index: number) => {
  state.sheet = index
  const variants = currentSheet().variants

  if (!variants.some((column) => column.variant === state.variant)) state.variant = variants[0]!.variant
  state.selected = null
  state.fitPending = true
  renderAll()
}

const showFlip = (label: string | null) => {
  state.flip = label
  state.fitPending = true
  renderToolbar()
  renderStage()
}

const setTool = (tool: Tool) => {
  state.tool = tool
  renderToolbar()
  renderStageClasses()
}

const end = ({ title, text }: { readonly title: string; readonly text: string }) => {
  state.ended = true
  const overlay = element('div', 'done')
  overlay.innerHTML = `<div role="status"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></div>`
  document.body.append(overlay)
  lease.close()
}

const close = async () => {
  if (!isEmptyDraft() && !confirm('Close without sending? Your draft stays for the next shot review.')) return
  await fetch(`/api/close?t=${token}`, { method: 'POST', headers }).catch(() => undefined)
  end({ title: 'Closed', text: 'Nothing was sent to the agent. You can close this tab.' })
}

const submit = async () => {
  if (state.ended) return

  if (isEmptyDraft()) {
    if (confirm('Nothing to send yet. Close the review instead?')) await close()

    return
  }

  clearTimeout(saveTimer)

  const sent = await fetch(`/api/submit?t=${token}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(state.draft),
  }).catch(() => undefined)

  if (sent?.ok !== true) {
    alert('The review has ended or shot is not running. Your draft is saved.')

    return
  }

  end({ title: 'Sent to the agent', text: 'Your votes and notes are on their way. You can close this tab.' })
}

top.addEventListener('click', (event) => {
  const action = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null

  if (action?.dataset['action'] === 'submit') void submit()

  if (action?.dataset['action'] === 'close') void close()
})

top.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLSelectElement)) return
  updateDraft({ ...state.draft, pick: event.target.value === '' ? null : event.target.value })
})

sheetsAside.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-sheet]') : null

  if (button !== null) showSheet(Number(button.dataset['sheet']))
})

toolbar.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null

  if (button === null) return
  const { tool, variant, action } = button.dataset

  if (tool !== undefined) setTool(tools.find((candidate) => candidate === tool) ?? 'move')

  if (variant !== undefined) {
    state.variant = variant
    state.selected = null
    state.fitPending = true
    renderToolbar()
    renderStage()
    renderPanel()
  }

  if (action === 'toggle-flip') showFlip(state.flip === null ? (state.page.labels[0]?.label ?? null) : null)

  if (action === 'fit') fit()

  if (action === 'actual') actualSize()
})

world.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pick]') : null

  if (button === null) return
  const label = button.dataset['pick'] ?? ''
  const sheet = currentSheet().key
  setVote({ sheet, pick: voteOf(sheet)?.pick === label ? undefined : label })
  renderAll()
})

panel.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.name !== 'vote') return
  setVote({ sheet: currentSheet().key, pick: event.target.value === '' ? null : event.target.value })
  renderTop()
  renderSheets()
  renderStage()
  renderPanel()
})

panel.addEventListener('input', (event) => {
  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) return

  if (target.dataset['noteComment'] !== undefined) {
    const id = target.dataset['noteComment']
    updateDraft({
      ...state.draft,
      notes: state.draft.notes.map((note) => (note.id === id ? { ...note, comment: target.value } : note)),
    })
  }

  if (target.dataset['voteComment'] !== undefined) {
    const sheet = currentSheet().key
    const vote = voteOf(sheet)

    if (vote !== undefined) {
      const others = state.draft.votes.filter((entry) => entry.sheet !== sheet)
      updateDraft({ ...state.draft, votes: [...others, { ...vote, comment: target.value }] })
    }
  }

  if (target.dataset['overallComment'] !== undefined) updateDraft({ ...state.draft, comment: target.value })
})

panel.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null

  if (target === null) return
  const remove = target.closest<HTMLElement>('[data-delete]')

  if (remove !== null) {
    removeNote(remove.dataset['delete'] ?? '')
    renderMarks()
    renderPanel()
    renderSheets()

    return
  }

  if (target.closest('[data-action="clear-vote"]') !== null) {
    setVote({ sheet: currentSheet().key, pick: undefined })
    renderAll()

    return
  }

  const card = target.closest<HTMLElement>('[data-note-card]')

  if (card !== null && state.selected !== card.dataset['noteCard']) {
    state.selected = card.dataset['noteCard'] ?? null
    renderMarks()

    for (const other of panel.querySelectorAll<HTMLElement>('[data-note-card]')) {
      other.classList.toggle('selected', other.dataset['noteCard'] === state.selected)
    }
  }
})

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement

const toolKeys = new Map<string, Tool>([
  ['v', 'move'],
  ['c', 'pin'],
  ['r', 'box'],
  ['a', 'arrow'],
  ['p', 'pen'],
])

document.addEventListener('keydown', (event) => {
  if (state.ended) return

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void submit()

    return
  }

  if (event.key === 'Escape') {
    if (isTyping(event.target) && event.target instanceof HTMLElement) {
      event.target.blur()

      return
    }

    if (state.gesture?.kind === 'draw') state.gesture.svg.querySelector('[data-preview]')?.remove()
    else if (state.selected !== null) state.selected = null
    else if (state.flip !== null) showFlip(null)
    else setTool('move')
    state.gesture = null
    renderMarks()
    renderPanel()

    return
  }

  if (isTyping(event.target)) return

  if ((event.metaKey || event.ctrlKey) && (event.key === '=' || event.key === '+' || event.key === '-')) {
    event.preventDefault()
    const bounds = stage.getBoundingClientRect()
    const factor = event.key === '-' ? 1 / 1.25 : 1.25
    zoomAt({ zoom: state.zoom * factor, x: bounds.width / 2, y: bounds.height / 2 })

    return
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return

  if (event.shiftKey && event.code === 'Digit0') {
    event.preventDefault()
    actualSize()

    return
  }

  if (event.shiftKey && event.code === 'Digit1') {
    event.preventDefault()
    fit()

    return
  }

  if (event.key === ' ') {
    event.preventDefault()
    state.spaceHeld = true
    renderStageClasses()

    return
  }

  const digit = /^Digit([1-9])$/.exec(event.code)

  if (digit !== null && !event.shiftKey) {
    const label = state.page.labels[Number(digit[1]) - 1]?.label

    if (label !== undefined) showFlip(state.flip === label ? null : label)

    return
  }

  if (state.flip !== null && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const labels = state.page.labels
    const index = labels.findIndex((label) => label.label === state.flip)
    const next = labels[(index + (event.key === 'ArrowRight' ? 1 : labels.length - 1)) % labels.length]!
    state.flip = next.label
    renderStage()

    return
  }

  if ((event.key === 'Backspace' || event.key === 'Delete') && state.selected !== null) {
    removeNote(state.selected)
    renderMarks()
    renderPanel()
    renderSheets()

    return
  }

  const tool = toolKeys.get(event.key.toLowerCase())

  if (tool !== undefined) setTool(tool)
})

document.addEventListener('keyup', (event) => {
  if (event.key !== ' ') return
  state.spaceHeld = false
  renderStageClasses()
})

window.addEventListener('resize', () => {
  if (state.fitPending) fit()
})

// The server ends the review as closed when no tab has been connected for 30s (F33).
const lease = new EventSource(`/api/lease?t=${token}`)

const start = async () => {
  const page = await loadPage()

  if (page === undefined) {
    lease.close()
    fail('This review has ended or the link is wrong. Run shot review again.')

    return
  }

  if (page.sheets.length === 0) {
    fail('Nothing to review.')

    return
  }

  state.page = page
  state.draft = page.draft
  state.variant = page.sheets[0]!.variants[0]!.variant
  root.replaceChildren(app)
  renderAll()
}

void start()
