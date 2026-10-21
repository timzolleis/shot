/** The evidence block in a PR body: one per PR, replaced on each publish (C12). */
export const evidenceStartMarker = '<!-- shot:evidence -->'
export const evidenceEndMarker = '<!-- /shot:evidence -->'

/** `body` with the block between the markers replaced by `evidenceMarkdown`, or appended when there is none. */
export const prBodyWithEvidence = ({
  body,
  evidenceMarkdown,
}: {
  readonly body: string
  readonly evidenceMarkdown: string
}): string => {
  const block = `${evidenceStartMarker}\n${evidenceMarkdown.trim()}\n${evidenceEndMarker}`
  const start = body.indexOf(evidenceStartMarker)
  const end = body.indexOf(evidenceEndMarker, start)

  if (start !== -1 && end !== -1) {
    return `${body.slice(0, start)}${block}${body.slice(end + evidenceEndMarker.length)}`
  }

  return body.trim() === '' ? `${block}\n` : `${body.trimEnd()}\n\n${block}\n`
}
