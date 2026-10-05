import { Router } from 'express'
import { getStorage, isValidObjectKey, PUBLIC_PREFIX } from '../lib/storage/index.js'

// Links salvos nas propostas são estáveis (/media/<chave>). Com Railway Buckets (sempre privados)
// a rota redireciona para uma URL assinada de 1 h; o arquivo é baixado direto do bucket (saída grátis).
const SIGNED_URL_TTL_SECONDS = 60 * 60
const REDIRECT_CACHE_SECONDS = 50 * 60

export const mediaRouter = Router()

mediaRouter.get('/*key', async (req, res) => {
    const segments = req.params.key as unknown as string[] | string
    const key = Array.isArray(segments) ? segments.join('/') : segments

    // Só objetos públicos: comprovantes (private/) nunca passam por aqui.
    if (!isValidObjectKey(key) || !key.startsWith(PUBLIC_PREFIX)) {
        return res.status(404).json({ message: 'Not found' })
    }

    const storage = getStorage()

    if (storage.kind === 's3') {
        const url = await storage.getSignedReadUrl(key, SIGNED_URL_TTL_SECONDS)
        if (!url) return res.status(404).json({ message: 'Not found' })
        res.setHeader('Cache-Control', `public, max-age=${REDIRECT_CACHE_SECONDS}`)
        return res.redirect(302, url)
    }

    const filePath = storage.localPath(key)
    if (!filePath || !(await storage.exists(key))) {
        return res.status(404).json({ message: 'Not found' })
    }
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    return res.sendFile(filePath)
})
