import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import multer from 'multer'

// Arquivos recebidos ficam num diretório temporário só até a validação de assinatura e o envio ao storage.
export const tempUploadDir = path.join(os.tmpdir(), 'lumen-deal-uploads')
fs.mkdirSync(tempUploadDir, { recursive: true })

export const tempDiskStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempUploadDir),
    filename: (_req, _file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.upload`)
})

export async function removeTempFile(filePath: string | undefined) {
    if (filePath) await fs.promises.unlink(filePath).catch(() => undefined)
}
