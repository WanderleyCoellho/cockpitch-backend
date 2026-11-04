import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app.js'
import { env } from '../src/config/env.js'

const page = (path: string) => `${env.FRONTEND_URL}${path}`

function send(report: Record<string, unknown>, contentType = 'application/csp-report') {
    return request(app)
        .post('/api/csp-report')
        .set('Content-Type', contentType)
        .send(JSON.stringify({ 'csp-report': report }))
}

function logged() {
    return warn.mock.calls
        .map((args) => String(args[0]))
        .filter((line) => line.startsWith('[csp-violation] '))
        .map((line) => JSON.parse(line.slice('[csp-violation] '.length)))
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('relatórios de CSP', () => {
    it('registra a violação sem query string e sem o token do link da proposta', async () => {
        const res = await send({
            'document-uri': page('/p/slug-secreto-123?pkg=1#topo'),
            'blocked-uri': 'https://cdn.exemplo.com/lib.js?key=abc',
            'effective-directive': 'script-src-elem',
            'source-file': page('/assets/index.js'),
            'line-number': 12,
            disposition: 'enforce',
        })

        expect(res.status).toBe(204)
        expect(logged()).toEqual([
            {
                directive: 'script-src-elem',
                blocked: 'https://cdn.exemplo.com/lib.js',
                page: `${env.FRONTEND_URL}/p/:token`,
                source: `${env.FRONTEND_URL}/assets/index.js`,
                line: 12,
                disposition: 'enforce',
            },
        ])
    })

    it('mascara o token de convite e de confirmação de conta', async () => {
        await send({ 'document-uri': page('/convite/abc123'), 'blocked-uri': 'inline', 'violated-directive': 'style-src' })
        await send({ 'document-uri': page('/confirmar-conta/xyz'), 'blocked-uri': 'eval', 'effective-directive': 'script-src' })

        expect(logged().map((line) => [line.page, line.blocked])).toEqual([
            [`${env.FRONTEND_URL}/convite/:token`, 'inline'],
            [`${env.FRONTEND_URL}/confirmar-conta/:token`, 'eval'],
        ])
    })

    it('ignora violações de extensões do navegador', async () => {
        const res = await send({
            'document-uri': page('/dashboard'),
            'blocked-uri': 'chrome-extension://abcdef/content.js',
            'effective-directive': 'script-src-elem',
        })

        expect(res.status).toBe(204)
        expect(logged()).toEqual([])
    })

    it('ignora relatórios de páginas que não são nossas', async () => {
        const res = await send({
            'document-uri': 'https://site-qualquer.com/pagina',
            'blocked-uri': 'https://cdn.exemplo.com/lib.js',
            'effective-directive': 'script-src-elem',
        })

        expect(res.status).toBe(204)
        expect(logged()).toEqual([])
    })

    it('aceita corpo em formato inesperado sem registrar nada', async () => {
        const vazio = await request(app).post('/api/csp-report').set('Content-Type', 'application/csp-report').send('{"outra":1}')
        const texto = await request(app).post('/api/csp-report').set('Content-Type', 'text/plain').send('qualquer coisa')

        expect(vazio.status).toBe(204)
        expect(texto.status).toBe(204)
        expect(logged()).toEqual([])
    })

    it('recusa corpo grande demais', async () => {
        const res = await send({ 'document-uri': page('/dashboard'), padding: 'x'.repeat(20_000) })
        expect(res.status).toBe(413)
        expect(logged()).toEqual([])
    })

    it('limita a quantidade de relatórios por IP', async () => {
        let last: request.Response | undefined
        for (let i = 0; i < 21; i += 1) {
            last = await send({ 'document-uri': page('/dashboard'), 'blocked-uri': 'inline', 'effective-directive': 'style-src' })
        }
        expect(last?.status).toBe(429)
    })
})
