import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  emptyEntries,
  localeFilePath,
  readLocaleFile,
  type LocaleFileContent,
} from '@localness/contract/locale-file'
import { requireFiles, type LoadedConfig } from './config'

export interface LocalLocaleFile {
  /** Platform locale code. */
  locale: string
  /** Absolute path. */
  path: string
  /** Relative to the config file, `/`-separated. */
  relativePath: string
  /** Null when the file does not exist yet. */
  source: string | null
  content: LocaleFileContent
}

export async function readLocalFiles(
  loaded: LoadedConfig,
  locales: readonly string[],
): Promise<LocalLocaleFile[]> {
  const files = requireFiles(loaded)
  return Promise.all(
    locales.map(async (locale) => {
      const relativePath = localeFilePath(
        files.dir,
        files.pattern,
        locale,
        loaded.config.localeMap ?? null,
      )
      const path = join(loaded.root, ...relativePath.split('/'))
      const source = await readFile(path, 'utf8').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      })
      let content: LocaleFileContent
      try {
        content =
          source === null
            ? { entries: emptyEntries(), paths: new Map(), blocked: [] }
            : readLocaleFile(source)
      } catch (error) {
        throw new Error(
          `${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return { locale, path, relativePath, source, content }
    }),
  )
}
