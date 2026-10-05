import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import fs from 'fs'
import { fileTypeFromFile } from 'file-type'
import { requireAuth } from '../middlewares/authMiddleware.js'
import { uploadRateLimit } from '../middlewares/rateLimit.js'
import { buildObjectKey, getStorage } from '../lib/storage/index.js'
import { publicApiOrigin } from '../lib/publicUrl.js'
import { removeTempFile, tempDiskStorage } from '../lib/tempUploads.js'

const MAX_FILE_SIZE_MB = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB ?? '100')
const MAX_FILE_SIZE_BYTES = Math.max(5, MAX_FILE_SIZE_MB) * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/x-matroska': '.mkv',
    'video/ogg': '.ogv',
    'video/x-ms-wmv': '.wmv',
    'video/3gpp': '.3gp',
    'video/3gpp2': '.3g2'
}

function isMediaMime(mime: string) {
    return mime.startsWith('image/') || mime.startsWith('video/')
}

function isCompatibleMime(declaredMime: string, detectedMime: string) {
    if (!isMediaMime(detectedMime)) return false
    if (declaredMime === 'application/octet-stream') return true
    if (!isMediaMime(declaredMime)) return false
    return declaredMime.split('/')[0] === detectedMime.split('/')[0]
}

const upload = multer({
    storage: tempDiskStorage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/octet-stream' && !isMediaMime(file.mimetype)) {
            cb(new Error('Unsupported file type'))
            return
        }
        cb(null, true)
    }
})

export const uploadRouter = Router()

uploadRouter.post('/upload', requireAuth, uploadRateLimit, (req: Request, res: Response, next) => {
    upload.single('file')(req, res, async (err: unknown) => {
        try {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ message: `File too large. Max size is ${MAX_FILE_SIZE_MB}MB` })
                }
                return res.status(400).json({ message: 'Invalid upload request' })
            }

            if (err instanceof Error) {
                return res.status(400).json({ message: err.message })
            }

            if (!req.file) {
                return res.status(400).json({ message: 'File is required' })
            }

            // A extensão e o Content-Type gravados vêm da assinatura real do arquivo, não do que o cliente declarou.
            const detected = await fileTypeFromFile(req.file.path)
            if (!detected || !isCompatibleMime(req.file.mimetype, detected.mime)) {
                return res.status(400).json({
                    message: 'File signature does not match declared media type',
                    declaredMime: req.file.mimetype,
                    detectedMime: detected?.mime ?? null
                })
            }

            const key = buildObjectKey({
                visibility: 'public',
                folder: 'media',
                originalName: req.file.originalname,
                extension: EXTENSION_BY_MIME[detected.mime] ?? `.${detected.ext}`
            })

            try {
                await getStorage().put({
                    key,
                    body: fs.createReadStream(req.file.path),
                    contentType: detected.mime,
                    contentLength: req.file.size
                })
            } catch (storageError) {
                console.error('[upload] storage put failed', storageError)
                return res.status(502).json({ message: 'Não foi possível salvar o arquivo agora. Tente novamente.' })
            }

            return res.status(201).json({ file_url: `${publicApiOrigin(req)}/media/${key}` })
        } catch (error) {
            return next(error)
        } finally {
            await removeTempFile(req.file?.path)
        }
    })
})
