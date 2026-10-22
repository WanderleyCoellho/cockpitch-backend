import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import type { PutObjectInput, StorageDriver } from './types.js'

export class LocalStorageDriver implements StorageDriver {
    readonly kind = 'local' as const

    constructor(private readonly rootDir: string) {
        fs.mkdirSync(rootDir, { recursive: true })
    }

    localPath(key: string): string {
        const resolved = path.resolve(this.rootDir, key)
        // Impede path traversal (ex.: "../../etc/passwd").
        if (!resolved.startsWith(path.resolve(this.rootDir) + path.sep)) {
            throw new Error('Invalid storage key')
        }
        return resolved
    }

    async put({ key, body }: PutObjectInput): Promise<void> {
        const target = this.localPath(key)
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await pipeline(body, fs.createWriteStream(target))
    }

    async getSignedReadUrl(): Promise<string | null> {
        return null
    }

    async exists(key: string): Promise<boolean> {
        try {
            await fs.promises.access(this.localPath(key))
            return true
        } catch {
            return false
        }
    }

    async delete(key: string): Promise<void> {
        await fs.promises.unlink(this.localPath(key)).catch(() => undefined)
    }
}
