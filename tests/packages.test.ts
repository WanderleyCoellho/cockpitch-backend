import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { prisma } from '../src/lib/prisma.js'
import { createUser, resetDatabase } from './helpers.js'

beforeEach(resetDatabase)

async function createPackage(auth: string, providerId: string, body: Record<string, unknown>) {
    return request(app).post('/api/packages').set('Authorization', auth).send({ providerId, name: 'Pacote', ...body })
}

async function addItem(auth: string, packageId: string, body: Record<string, unknown>) {
    return request(app).post('/api/package-items').set('Authorization', auth).send({ packageId, name: 'Item', ...body })
}

describe('pacotes com preço calculado', () => {
    it('soma dos itens: quantidade × valor, opcionais e cortesia; total refletido no campo legado price', async () => {
        const a = await createUser()
        const pkg = await createPackage(a.auth, a.provider.id, { priceMode: 'SUM_OF_ITEMS', discountType: 'PERCENT', discountValue: 1000 })
        expect(pkg.status).toBe(201)
        const id = pkg.body.package.id

        expect((await addItem(a.auth, id, { name: 'Horas de consultoria', quantity: 8, unit: 'h', unitPriceCents: 25000 })).status).toBe(201)
        expect((await addItem(a.auth, id, { name: 'Relatório extra', kind: 'OPTIONAL', unitPriceCents: 30000 })).status).toBe(201)
        expect((await addItem(a.auth, id, { name: 'Diagnóstico', kind: 'COURTESY', unitPriceCents: 20000 })).status).toBe(201)

        const res = await request(app).get(`/api/packages/${id}`).set('Authorization', a.auth)
        expect(res.status).toBe(200)
        const { pricing, items, price } = res.body.package
        expect(items[0].quantity).toBe(8) // número, não string
        expect(pricing).toMatchObject({ baseCents: 200000, optionalsCents: 0, courtesyValueCents: 20000, discountCents: 20000, totalCents: 180000 })
        expect(price).toBe('1800.00')
        expect(items.find((i: { kind: string }) => i.kind === 'COURTESY').isCourtesy).toBe(true)
    })

    it('cliente antigo que envia price em texto continua funcionando', async () => {
        const a = await createUser()
        const fixed = await createPackage(a.auth, a.provider.id, { price: '3500.00' })
        expect(fixed.body.package).toMatchObject({ priceMode: 'FIXED', fixedPriceCents: 350000, price: '3500.00' })

        const text = await createPackage(a.auth, a.provider.id, { price: 'a combinar' })
        expect(text.body.package).toMatchObject({ priceMode: 'ON_REQUEST', priceLabel: 'a combinar', price: 'a combinar' })
        expect(text.body.package.pricing.onRequest).toBe(true)
    })

    it('legado isCourtesy vira kind COURTESY', async () => {
        const a = await createUser()
        const pkg = await createPackage(a.auth, a.provider.id, { price: '100.00' })
        const item = await addItem(a.auth, pkg.body.package.id, { name: 'Brinde', isCourtesy: true })
        expect(item.body.item).toMatchObject({ kind: 'COURTESY', isCourtesy: true })
    })

    it('valida limites: valor negativo, quantidade zero e desconto acima de 100%', async () => {
        const a = await createUser()
        const pkg = await createPackage(a.auth, a.provider.id, { priceMode: 'SUM_OF_ITEMS' })
        const id = pkg.body.package.id
        expect((await addItem(a.auth, id, { unitPriceCents: -1 })).status).toBe(400)
        expect((await addItem(a.auth, id, { quantity: 0 })).status).toBe(400)
        expect((await createPackage(a.auth, a.provider.id, { priceMode: 'FIXED', fixedPriceCents: 1000, discountType: 'PERCENT', discountValue: 10001 })).status).toBe(400)
    })

    it('alterar item ou desconto recalcula o total', async () => {
        const a = await createUser()
        const pkg = await createPackage(a.auth, a.provider.id, { priceMode: 'SUM_OF_ITEMS' })
        const id = pkg.body.package.id
        const item = await addItem(a.auth, id, { quantity: 2, unitPriceCents: 10000 })

        await request(app).patch(`/api/package-items/${item.body.item.id}`).set('Authorization', a.auth).send({ quantity: 3 })
        expect((await prisma.package.findUniqueOrThrow({ where: { id } })).price).toBe('300.00')

        await request(app).patch(`/api/packages/${id}`).set('Authorization', a.auth).send({ discountType: 'AMOUNT', discountValue: 5000 })
        expect((await prisma.package.findUniqueOrThrow({ where: { id } })).price).toBe('250.00')

        await request(app).delete(`/api/package-items/${item.body.item.id}`).set('Authorization', a.auth)
        expect((await prisma.package.findUniqueOrThrow({ where: { id } })).price).toBe('0.00')
    })

    it('página pública traz os pacotes com preço calculado e quantidades numéricas', async () => {
        const a = await createUser()
        const pkg = await createPackage(a.auth, a.provider.id, { priceMode: 'SUM_OF_ITEMS' })
        await addItem(a.auth, pkg.body.package.id, { quantity: '1.5', unitPriceCents: 10000 })
        await request(app)
            .post('/api/proposals')
            .set('Authorization', a.auth)
            .send({ providerId: a.provider.id, packageIds: [pkg.body.package.id], clientName: 'Cliente', slug: 'com-preco' })

        const res = await request(app).get('/api/public/proposals/com-preco')
        const publicPkg = res.body.proposal.packageIds[0]
        expect(publicPkg.items[0].quantity).toBe(1.5)
        expect(publicPkg.pricing.totalCents).toBe(15000)
    })
})
