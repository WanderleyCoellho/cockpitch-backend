import { describe, expect, it } from 'vitest'
import { calculatePackagePricing, lineTotalCents, parseMoneyToCents, type PricingPackage } from '../src/services/pricing.js'

const base: PricingPackage = { priceMode: 'SUM_OF_ITEMS', fixedPriceCents: null, discountType: 'NONE', discountValue: 0, items: [] }

describe('lineTotalCents', () => {
    it('quantidade × unitário com arredondamento half-up', () => {
        expect(lineTotalCents({ quantity: 3, unitPriceCents: 15000 })).toBe(45000)
        expect(lineTotalCents({ quantity: '1.50', unitPriceCents: 333 })).toBe(500) // 499,5 → 500
        expect(lineTotalCents({ quantity: 0.33, unitPriceCents: 100 })).toBe(33)
        expect(lineTotalCents({ quantity: 10000, unitPriceCents: 1_000_000_000 })).toBe(10_000_000_000_000)
    })
})

describe('calculatePackagePricing', () => {
    const items = [
        { id: 'a', kind: 'INCLUDED' as const, quantity: 8, unitPriceCents: 25000 }, // 2.000,00
        { id: 'b', kind: 'INCLUDED' as const, quantity: 1, unitPriceCents: 50000 }, // 500,00
        { id: 'c', kind: 'OPTIONAL' as const, quantity: 1, unitPriceCents: 30000 }, // 300,00
        { id: 'd', kind: 'COURTESY' as const, quantity: 1, unitPriceCents: 20000 } // 200,00 riscado
    ]

    it('soma dos itens incluídos; opcional só entra se selecionado; cortesia soma 0', () => {
        const p = calculatePackagePricing({ ...base, items })
        expect(p.baseCents).toBe(250000)
        expect(p.optionalsCents).toBe(0)
        expect(p.courtesyValueCents).toBe(20000)
        expect(p.totalCents).toBe(250000)

        const withOptional = calculatePackagePricing({ ...base, items }, ['c'])
        expect(withOptional.totalCents).toBe(280000)
        expect(withOptional.lines.find((l) => l.id === 'c')?.selected).toBe(true)
    })

    it('modo FIXED ignora o valor dos incluídos, mas soma opcionais', () => {
        const p = calculatePackagePricing({ ...base, priceMode: 'FIXED', fixedPriceCents: 350000, items }, ['c'])
        expect(p.baseCents).toBe(350000)
        expect(p.totalCents).toBe(380000)
    })

    it('desconto percentual em pontos-base, arredondado', () => {
        const p = calculatePackagePricing({ ...base, discountType: 'PERCENT', discountValue: 1000, items }) // 10%
        expect(p.discountCents).toBe(25000)
        expect(p.totalCents).toBe(225000)
        const odd = calculatePackagePricing({ ...base, priceMode: 'FIXED', fixedPriceCents: 999, discountType: 'PERCENT', discountValue: 1250, items: [] })
        expect(odd.discountCents).toBe(125) // 124,875 → 125
    })

    it('desconto em valor nunca deixa o total negativo', () => {
        const p = calculatePackagePricing({ ...base, priceMode: 'FIXED', fixedPriceCents: 10000, discountType: 'AMOUNT', discountValue: 50000, items: [] })
        expect(p.discountCents).toBe(10000)
        expect(p.totalCents).toBe(0)
    })

    it('percentual acima de 100% é limitado a 100%', () => {
        const p = calculatePackagePricing({ ...base, priceMode: 'FIXED', fixedPriceCents: 10000, discountType: 'PERCENT', discountValue: 50_000, items: [] })
        expect(p.totalCents).toBe(0)
    })

    it('sob consulta não calcula total, mas mostra o valor das cortesias', () => {
        const p = calculatePackagePricing({ ...base, priceMode: 'ON_REQUEST', items })
        expect(p.onRequest).toBe(true)
        expect(p.totalCents).toBe(0)
        expect(p.courtesyValueCents).toBe(20000)
    })

    it('ignora opcional selecionado que não existe e quantidade inválida', () => {
        const p = calculatePackagePricing({ ...base, items: [{ id: 'x', kind: 'INCLUDED', quantity: 'abc', unitPriceCents: 100 }] }, ['zzz'])
        expect(p.totalCents).toBe(0)
    })
})

describe('parseMoneyToCents', () => {
    it('aceita formatos brasileiro e decimal', () => {
        expect(parseMoneyToCents('3500.00')).toBe(350000)
        expect(parseMoneyToCents('3.500,50')).toBe(350050)
        expect(parseMoneyToCents('3500')).toBe(350000)
        expect(parseMoneyToCents('R$ 10')).toBeNull()
        expect(parseMoneyToCents('a combinar')).toBeNull()
    })
})
