import fs from 'fs'
import path from 'path'

// Comprovantes são dados financeiros privados: ficam FORA do diretório estático público (/uploads)
// e só são lidos pela rota autenticada do Ops (GET /api/internal/licensing/receipts/:id/file).
export const receiptUploadsDir = path.resolve(process.cwd(), 'storage', 'receipts')
// Diretório antigo (servido publicamente até 2026-10); mantido apenas para leitura de arquivos legados.
export const legacyReceiptUploadsDir = path.resolve(process.cwd(), 'uploads', 'receipts')
if (!fs.existsSync(receiptUploadsDir)) {
    fs.mkdirSync(receiptUploadsDir, { recursive: true })
}

export function receiptFilePath(receiptId: string) {
    return `/api/internal/licensing/receipts/${receiptId}/file`
}
