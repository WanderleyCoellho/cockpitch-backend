import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { PutObjectInput, StorageDriver } from './types.js'

export type S3DriverConfig = {
    endpoint: string
    region: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    forcePathStyle: boolean
}

export class S3StorageDriver implements StorageDriver {
    readonly kind = 's3' as const
    private readonly client: S3Client

    constructor(private readonly config: S3DriverConfig) {
        this.client = new S3Client({
            endpoint: config.endpoint,
            region: config.region,
            forcePathStyle: config.forcePathStyle,
            credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
            // Timeouts explícitos: um bucket lento não pode travar requisições indefinidamente.
            requestHandler: { requestTimeout: 60_000, connectionTimeout: 5_000 }
        })
    }

    async put({ key, body, contentType }: PutObjectInput): Promise<void> {
        // Upload multipart em streaming: não carrega vídeos inteiros na memória.
        const upload = new Upload({
            client: this.client,
            params: { Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType },
            queueSize: 2,
            partSize: 8 * 1024 * 1024
        })
        await upload.done()
    }

    async getSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
        return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), {
            expiresIn: expiresInSeconds
        })
    }

    localPath(): null {
        return null
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }))
            return true
        } catch (error) {
            const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
            if (status === 404) return false
            throw error
        }
    }

    async delete(key: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }))
    }
}
