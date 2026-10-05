import { describe, expect, it } from 'vitest'
import { Readable } from 'stream'
import { S3StorageDriver } from '../src/lib/storage/s3Driver.js'

// Integração real com um servidor S3 (moto/MinIO). Rode com S3_TEST_ENDPOINT=http://localhost:5000.
const endpoint = process.env.S3_TEST_ENDPOINT

describe.skipIf(!endpoint)('S3StorageDriver (integração)', () => {
    it('grava, verifica, gera URL assinada e apaga', async () => {
        const { S3Client, CreateBucketCommand } = await import('@aws-sdk/client-s3')
        const bucket = `lumen-deal-test-${Date.now()}`
        const credentials = { accessKeyId: 'test', secretAccessKey: 'test' }
        await new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials }).send(
            new CreateBucketCommand({ Bucket: bucket })
        )

        const driver = new S3StorageDriver({
            endpoint: endpoint!,
            region: 'us-east-1',
            bucket,
            forcePathStyle: true,
            ...credentials
        })
        const key = 'public/media/2026/10/abc-teste.txt'

        await driver.put({ key, body: Readable.from(Buffer.from('olá storage')), contentType: 'text/plain' })
        expect(await driver.exists(key)).toBe(true)

        const url = await driver.getSignedReadUrl(key, 60)
        const res = await fetch(url)
        expect(res.status).toBe(200)
        expect(await res.text()).toBe('olá storage')

        await driver.delete(key)
        expect(await driver.exists(key)).toBe(false)
    })
})
