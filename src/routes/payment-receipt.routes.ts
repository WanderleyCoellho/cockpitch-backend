import { Router, type NextFunction, type Response } from 'express'
import multer from 'multer'
import fs from 'fs'
import { fileTypeFromFile } from 'file-type'
import { prisma } from '../lib/prisma.js'
import { requireAuth, type AuthenticatedRequest } from '../middlewares/authMiddleware.js'
import { receiptFilePath } from '../lib/receiptStorage.js'
import { buildObjectKey, getStorage } from '../lib/storage/index.js'
import { removeTempFile, tempDiskStorage } from '../lib/tempUploads.js'

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


const upload = multer({
    storage: tempDiskStorage,
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

paymentReceiptRouter.post('/', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // O callback do multer roda fora do fluxo de promessas do Express: erros vão explicitamente para next().
    upload.single('receipt')(req, res, (err: unknown) => void handleReceiptUpload(req, res, err).catch(next))
})

async function handleReceiptUpload(req: AuthenticatedRequest, res: Response, err: unknown) {
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

    const tempPath = req.file.path
    let key: string
    try {
        const detected = await fileTypeFromFile(tempPath)
        if (!detected || !ALLOWED_RECEIPT_MIME_TYPES.has(detected.mime) || detected.mime !== req.file.mimetype) {
            return res.status(400).json({ message: 'Receipt file signature does not match allowed type' })
        }

        // Comprovante é dado financeiro: vai para o espaço privado do storage.
        key = buildObjectKey({
            visibility: 'private',
            folder: 'receipts',
            originalName: req.file.originalname,
            extension: EXTENSION_BY_MIME[detected.mime]
        })
        await getStorage().put({
            key,
            body: fs.createReadStream(tempPath),
            contentType: detected.mime,
            contentLength: req.file.size
        })
    } catch (storageError) {
        console.error('[receipt] storage put failed', storageError)
        return res.status(502).json({ message: 'Não foi possível salvar o comprovante agora. Tente novamente.' })
    } finally {
        await removeTempFile(tempPath)
    }

    const created = await prisma.paymentReceipt.create({
        data: {
            userId: req.auth.userId,
            fileUrl: '',
            storedFilename: key,
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
}

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
