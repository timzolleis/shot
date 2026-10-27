/** Progress for a person at a terminal. Agents read stderr too, so off a terminal it stays quiet. */
export const writeProgress = (line: string): void => {
  if (process.stderr.isTTY) process.stderr.write(`${line}\n`)
}
