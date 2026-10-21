import { Effect, FileSystem, Layer, Match, Option, Predicate, Schema } from 'effect'
import path from 'node:path'

import { ArtifactStore } from '../artifact/artifact-store.ts'
import { captureFileFromKey, labelDirFromSession, type SessionLabel, sessionNameFromEnv } from '../artifact/session.ts'
import { CaptureResult } from '../capture/domain/capture-result.ts'
import {
  evidenceMarkdownFromReport,
  type SheetHeading,
  sheetGridFromSheet,
} from '../evidence/domain/evidence-report.ts'
import { flowKey, FlowResult } from '../flow/domain/flow.ts'
import { ShotConfig } from '../plugin/shot-config.ts'
import { type GridCell, type GridHeading, Sheets } from './sheets.ts'

const CaptureResultJson = Schema.fromJsonString(Schema.toCodecJson(CaptureResult))
const FlowResultJson = Schema.fromJsonString(Schema.toCodecJson(FlowResult))
const encodeCaptureResult = Schema.encodeSync(CaptureResultJson)
const decodeCaptureResult = Schema.decodeUnknownOption(CaptureResultJson)
const encodeFlowResult = Schema.encodeSync(FlowResultJson)
const decodeFlowResult = Schema.decodeUnknownOption(FlowResultJson)

const HostDefaultsFile = Schema.fromJsonString(
  Schema.Struct({
    hosts: Schema.Record(
      Schema.String,
      Schema.Struct({ user: Schema.String, params: Schema.Record(Schema.String, Schema.String) }),
    ),
  }),
)

const decodeHostDefaultsFile = Schema.decodeUnknownOption(HostDefaultsFile)
const encodeHostDefaultsFile = Schema.encodeSync(HostDefaultsFile)

const shotsDirName = '.shots'

export const FileArtifactStoreLayer = Layer.effect(
  ArtifactStore,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const config = yield* ShotConfig
    const sheets = yield* Sheets
    const projectRoot = config.projectRoot
    const sessionName = sessionNameFromEnv(process.env)
    const sessionDir = path.join(shotsDirName, sessionName)
    const absolutePath = (file: string) => path.resolve(projectRoot, file)

    /** Written by rename: a reader never sees half a file; two writers of one key leave the last. */
    const writeAtomic = (file: string, content: Uint8Array | string) =>
      Effect.gen(function* () {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true })
        const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
        yield* content instanceof Uint8Array ? fs.writeFile(temporary, content) : fs.writeFileString(temporary, content)
        yield* fs.rename(temporary, file)
      }).pipe(Effect.orDie)

    const manifestDir = (label: string) =>
      absolutePath(path.join(labelDirFromSession({ sessionDir, label }), 'manifest'))

    const readJsonFiles = (dir: string) =>
      Effect.gen(function* () {
        if (!(yield* fs.exists(dir))) return []
        const names = (yield* fs.readDirectory(dir)).filter((name) => name.endsWith('.json')).sort()

        return yield* Effect.forEach(names, (name) =>
          fs.readFileString(path.join(dir, name)).pipe(Effect.map((text) => ({ name, text }))),
        )
      }).pipe(Effect.orDie)

    const readLabel = (label: string) =>
      Effect.gen(function* () {
        const files = yield* readJsonFiles(manifestDir(label))

        const captures = files
          .filter((file) => !file.name.startsWith('flow--'))
          .flatMap((file) => Option.toArray(decodeCaptureResult(file.text)))

        const flows = files
          .filter((file) => file.name.startsWith('flow--'))
          .flatMap((file) => Option.toArray(decodeFlowResult(file.text)))

        return { label, captures, flows } satisfies SessionLabel
      })

    const configFile = absolutePath(path.join(shotsDirName, 'config.json'))

    const readHostDefaultsFile = Effect.gen(function* () {
      if (!(yield* fs.exists(configFile))) return { hosts: {} }

      return Option.getOrElse(decodeHostDefaultsFile(yield* fs.readFileString(configFile)), () => ({ hosts: {} }))
    }).pipe(Effect.orDie)

    const authDir = absolutePath(path.join(shotsDirName, 'auth'))

    return ArtifactStore.of({
      projectRoot,
      sessionName,
      sessionDir,
      absolutePath,
      writeCaptureFile: ({ label, key, extension, content, measurements }) =>
        Effect.gen(function* () {
          const file = captureFileFromKey({ sessionDir, label, key, extension })
          yield* writeAtomic(absolutePath(file), content)

          if (measurements !== null && extension !== 'json') {
            yield* writeAtomic(
              absolutePath(`${file.slice(0, -extension.length)}json`),
              JSON.stringify(measurements, null, 2),
            )
          }

          return file
        }),
      writeManifest: ({ label, results }) =>
        Effect.forEach(
          results,
          (result) => writeAtomic(path.join(manifestDir(label), `${result.key}.json`), encodeCaptureResult(result)),
          { discard: true },
        ),
      makeFlowDir: ({ label, flow }) =>
        Effect.gen(function* () {
          const dir = path.join(labelDirFromSession({ sessionDir, label }), 'flows', flowKey(flow))
          yield* fs.remove(absolutePath(dir), { recursive: true, force: true })
          yield* fs.makeDirectory(absolutePath(dir), { recursive: true })

          return dir
        }).pipe(Effect.orDie),
      writeFlowResult: ({ label, flowResult }) =>
        writeAtomic(
          path.join(manifestDir(label), `flow--${flowKey(flowResult.flow)}.json`),
          encodeFlowResult(flowResult),
        ),
      readSession: () =>
        Effect.gen(function* () {
          const root = absolutePath(sessionDir)
          const entries = (yield* fs.exists(root)) ? yield* fs.readDirectory(root) : []
          const candidates = ['', ...entries]

          const labelled = yield* Effect.forEach(candidates, (label) =>
            Effect.gen(function* () {
              const dir = manifestDir(label)
              // Files next to the label directories are not labels.
              const isLabel = yield* fs.exists(dir).pipe(Effect.orElseSucceed(() => false))

              if (!isLabel) return Option.none<{ label: string; createdAt: number }>()
              const stat = yield* fs.stat(dir)

              const createdAt = Option.getOrElse(
                Option.orElse(stat.birthtime, () => stat.mtime),
                () => new Date(0),
              ).getTime()

              return Option.some({ label, createdAt })
            }),
          ).pipe(Effect.orDie)

          const labels = labelled.flatMap(Option.toArray).sort((a, b) => a.createdAt - b.createdAt)

          return {
            name: sessionName,
            dir: sessionDir,
            labels: yield* Effect.forEach(labels, ({ label }) => readLabel(label)),
          }
        }).pipe(Effect.orDie),
      writeReport: (report) =>
        Effect.gen(function* () {
          for (const sheet of report.sheets) {
            // One still: the sheet shows it as is.
            if (
              sheet.rows.flatMap((row) => row.cells).filter((cell) => Predicate.isTagged(cell, 'ShotCell')).length < 2
            )
              continue

            const grid = sheetGridFromSheet(sheet)

            const rows = yield* Effect.forEach(grid.rows, (row) =>
              Effect.forEach(row.cells, (cell) =>
                Match.valueTags(cell, {
                  ShotCell: ({ file, scale }) =>
                    fs.readFile(absolutePath(file)).pipe(Effect.map((png): GridCell => ({ png, scale }))),
                  FailedCell: () => Effect.succeed<GridCell>({ note: 'failed' }),
                  MissingCell: () => Effect.succeed<GridCell>({ note: 'not shot' }),
                }),
              ).pipe(Effect.map((cells) => ({ label: row.label, cells }))),
            ).pipe(Effect.orDie)

            const gridHeading = ({ title, mode, span }: SheetHeading): GridHeading => ({
              title,
              mode: Option.getOrUndefined(mode),
              span,
            })

            const png = yield* sheets.composeGrid({
              groups: grid.groups.map(gridHeading),
              columns: grid.columns.map(gridHeading),
              rows,
            })

            yield* writeAtomic(absolutePath(sheet.file), png)
          }

          const file = path.join(sessionDir, 'report', 'report.md')
          yield* writeAtomic(absolutePath(file), `${evidenceMarkdownFromReport(report)}\n`)

          return file
        }),
      readHostDefaults: (host) => Effect.map(readHostDefaultsFile, (file) => Option.fromNullishOr(file.hosts[host])),
      writeHostDefaults: ({ host, user, params }) =>
        Effect.gen(function* () {
          const file = yield* readHostDefaultsFile
          yield* writeAtomic(
            configFile,
            encodeHostDefaultsFile({ hosts: { ...file.hosts, [host]: { user, params: { ...params } } } }),
          )
        }),
      authFile: (sessionKey) => path.join(authDir, `${sessionKey}.json`),
      removeAuthFiles: ({ host, user }) =>
        Effect.gen(function* () {
          const dir = path.join(authDir, host)

          if (!(yield* fs.exists(dir))) return 0

          const prefix = Option.getOrElse(
            Option.map(user, (email) => `${email.toLowerCase().replaceAll(/[^a-z0-9@.]+/g, '-')}--`),
            () => '',
          )

          const files = (yield* fs.readDirectory(dir)).filter(
            (name) => name.startsWith(prefix) && name.endsWith('.json'),
          )

          yield* Effect.forEach(files, (name) => fs.remove(path.join(dir, name), { force: true }), { discard: true })

          return files.length
        }).pipe(Effect.orDie),
      clean: ({ all }) =>
        Effect.gen(function* () {
          if (!all) {
            yield* fs.remove(absolutePath(sessionDir), { recursive: true, force: true })

            return sessionDir
          }

          const root = absolutePath(shotsDirName)
          const entries = (yield* fs.exists(root)) ? yield* fs.readDirectory(root) : []
          yield* Effect.forEach(
            entries.filter((entry) => entry !== 'config.json'),
            (entry) => fs.remove(path.join(root, entry), { recursive: true, force: true }),
            { discard: true },
          )

          return shotsDirName
        }).pipe(Effect.orDie),
    })
  }),
)
