import crypto from 'crypto'
import path from 'path'
import { env } from '../../config/env.js'
import { LocalStorageDriver } from './localDriver.js'
import { S3StorageDriver } from './s3Driver.js'
import type { StorageDriver } from './types.js'

export type { StorageDriver } from './types.js'

/** Prefixo de objetos servidos publicamente via /media. Tudo fora dele é privado. */
export const PUBLIC_PREFIX = 'public/'
export const PRIVATE_PREFIX = 'private/'

let driver: StorageDriver | null = null

export function getStorage(): StorageDriver {
    if (driver) return driver
    driver =
        env.STORAGE_DRIVER === 's3'
            ? new S3StorageDriver({
                endpoint: env.S3_ENDPOINT,
                region: env.S3_REGION,
                bucket: env.S3_BUCKET,
                accessKeyId: env.S3_ACCESS_KEY_ID,
                secretAccessKey: env.S3_SECRET_ACCESS_KEY,
                forcePathStyle: env.S3_FORCE_PATH_STYLE
            })
            : new LocalStorageDriver(path.resolve(process.cwd(), env.LOCAL_STORAGE_DIR))
    return driver
}

/** Permite trocar o driver em testes. */
export function setStorageForTests(next: StorageDriver | null) {
    driver = next
}

function slugifyFilename(name: string) {
    return (
        name
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-zA-Z0-9-_]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .toLowerCase()
            .slice(0, 60) || 'arquivo'
    )
}

/**
 * Gera uma chave única e não adivinhável: <visibilidade>/<pasta>/<aaaa>/<mm>/<aleatório>-<nome>.<ext>
 */
export function buildObjectKey(options: {
    visibility: 'public' | 'private'
    folder: string
    originalName: string
    extension: string
}) {
    const now = new Date()
    const yyyy = String(now.getUTCFullYear())
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const random = crypto.randomBytes(12).toString('hex')
    const base = slugifyFilename(path.basename(options.originalName, path.extname(options.originalName)))
    const prefix = options.visibility === 'public' ? PUBLIC_PREFIX : PRIVATE_PREFIX
    return `${prefix}${options.folder}/${yyyy}/${mm}/${random}-${base}${options.extension}`
}

/** Chave válida: só caracteres seguros, sem "..", com prefixo conhecido. */
export function isValidObjectKey(key: string) {
    return (
        /^[a-z0-9][a-z0-9/_\-.]*$/i.test(key) &&
        !key.includes('..') &&
        !key.includes('//') &&
        (key.startsWith(PUBLIC_PREFIX) || key.startsWith(PRIVATE_PREFIX))
    )
}
