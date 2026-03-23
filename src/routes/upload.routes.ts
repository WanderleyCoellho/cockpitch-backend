import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileTypeFromFile } from 'file-type'
import { requireAuth } from '../middlewares/authMiddleware.js'

const MAX_FILE_SIZE_MB = Number(process.env.UPLOAD_MAX_FILE_SIZE_MB ?? '100')
const MAX_FILE_SIZE_BYTES = Math.max(5, MAX_FILE_SIZE_MB) * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
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

const uploadsDir = path.resolve(process.cwd(), 'uploads')
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true })
}

const storage = multer.diskStorage({
    destination: (
        _req: Request,
        _file: Express.Multer.File,
        cb: (error: Error | null, destination: string) => void
    ) => cb(null, uploadsDir),
    filename: (
        _req: Request,
        file: Express.Multer.File,
        cb: (error: Error | null, filename: string) => void
    ) => {
        const originalExt = path.extname(file.originalname)
        const ext = EXTENSION_BY_MIME[file.mimetype] || originalExt || '.bin'
        const base = path.basename(file.originalname, originalExt).replace(/[^a-zA-Z0-9-_]/g, '-')
        cb(null, `${Date.now()}-${base}${ext}`)
    }
})

const upload = multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/octet-stream' && !isMediaMime(file.mimetype)) {
            cb(new Error('Unsupported file type'))
            return
        }
        cb(null, true)
    }
})

export const uploadRouter = Router()

uploadRouter.post('/upload', requireAuth, (req: Request, res: Response) => {
    upload.single('file')(req, res, async (err: unknown) => {
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

        const detected = await fileTypeFromFile(req.file.path)
        if (detected && !isCompatibleMime(req.file.mimetype, detected.mime)) {
            await fs.promises.unlink(req.file.path).catch(() => undefined)
            return res.status(400).json({
                message: 'File signature does not match declared media type',
                declaredMime: req.file.mimetype,
                detectedMime: detected.mime
            })
        }

        if (!detected && !isMediaMime(req.file.mimetype)) {
            await fs.promises.unlink(req.file.path).catch(() => undefined)
            return res.status(400).json({
                message: 'Could not validate file signature for non-media content',
                declaredMime: req.file.mimetype,
                detectedMime: null
            })
        }

        const origin = `${req.protocol}://${req.get('host')}`
        const fileUrl = `${origin}/uploads/${req.file.filename}`

        return res.status(201).json({ file_url: fileUrl })
    })
})
