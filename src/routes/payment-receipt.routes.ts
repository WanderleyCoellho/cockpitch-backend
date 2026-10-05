import { Router, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileTypeFromFile } from 'file-type'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { receiptFilePath, receiptUploadsDir } from '../lib/receiptStorage.js'

const MAX_RECEIPT_SIZE_BYTES = 10 * 1024 * 1024

const ALLOWED_RECEIPT_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
])

const EXTENSION_BY_MIME: Record<string, string> = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
}


const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, receiptUploadsDir),
    filename: (_req, file, cb) => {
        const originalExt = path.extname(file.originalname)
        const ext = EXTENSION_BY_MIME[file.mimetype] || originalExt || '.bin'
        const base = path.basename(file.originalname, originalExt).replace(/[^a-zA-Z0-9-_]/g, '-')
        cb(null, `receipt-${Date.now()}-${base}${ext}`)
    }
})

const upload = multer({
    storage,
    limits: { fileSize: MAX_RECEIPT_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.mimetype)) {
            cb(new Error('Unsupported receipt file type'))
            return
        }
        cb(null, true)
    }
})

export const paymentReceiptRouter = Router()

paymentReceiptRouter.use(requireAuth)

paymentReceiptRouter.post('/', (req: AuthenticatedRequest, res: Response) => {
    upload.single('receipt')(req, res, async (err: unknown) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Receipt file too large. Max size is 10MB' })
            }
            return res.status(400).json({ message: 'Invalid receipt upload request' })
        }

        if (err instanceof Error) {
            return res.status(400).json({ message: err.message })
        }

        if (!req.auth) {
            return res.status(401).json({ message: 'Unauthorized' })
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Receipt file is required' })
        }

        const detected = await fileTypeFromFile(req.file.path)
        if (!detected || !ALLOWED_RECEIPT_MIME_TYPES.has(detected.mime) || detected.mime !== req.file.mimetype) {
            await fs.promises.unlink(req.file.path).catch(() => undefined)
            return res.status(400).json({ message: 'Receipt file signature does not match allowed type' })
        }

        const created = await prisma.paymentReceipt.create({
            data: {
                userId: req.auth.userId,
                fileUrl: '',
                storedFilename: req.file.filename,
                originalFilename: req.file.originalname,
                mimeType: req.file.mimetype
            },
            select: { id: true }
        })

        const receipt = await prisma.paymentReceipt.update({
            where: { id: created.id },
            data: { fileUrl: receiptFilePath(created.id) },
            select: {
                id: true,
                originalFilename: true,
                mimeType: true,
                status: true,
                riskLevel: true,
                createdAt: true
            }
        })

        return res.status(201).json({ receipt })
    })
})

paymentReceiptRouter.get('/me', async (req: AuthenticatedRequest, res: Response) => {
    if (!req.auth) {
        return res.status(401).json({ message: 'Unauthorized' })
    }

    const receipts = await prisma.paymentReceipt.findMany({
        where: { userId: req.auth.userId },
        select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            status: true,
            riskLevel: true,
            analysisSummary: true,
            reviewerNotes: true,
            reviewerName: true,
            reviewedAt: true,
            createdAt: true,
            updatedAt: true
        },
        orderBy: { createdAt: 'desc' }
    })

    return res.json({ receipts })
})
