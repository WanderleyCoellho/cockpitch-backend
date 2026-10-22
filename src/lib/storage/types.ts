import type { Readable } from 'stream'

export type PutObjectInput = {
    key: string
    body: Readable
    contentType: string
    contentLength?: number
}

/**
 * Armazenamento de arquivos. Em produção: Railway Buckets (S3-compatível, sempre privado).
 * Em dev/teste: disco local. Quem usa não sabe qual implementação está ativa.
 */
export interface StorageDriver {
    readonly kind: 'local' | 's3'
    put(input: PutObjectInput): Promise<void>
    /** URL temporária de leitura (S3). O driver local devolve null: o arquivo é servido direto. */
    getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string | null>
    /** Caminho no disco (driver local); null no S3. */
    localPath(key: string): string | null
    exists(key: string): Promise<boolean>
    delete(key: string): Promise<void>
}
