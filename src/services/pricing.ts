/**
 * Cálculo de preço de pacotes — módulo PURO (sem banco, sem I/O).
 * Uma cópia idêntica vive no frontend (src/shared/pricing.ts) para recalcular o total ao vivo.
 * Valores sempre em CENTAVOS inteiros; arredondamento meio-para-cima (half-up) no centavo.
 */

export type PriceMode = 'SUM_OF_ITEMS' | 'FIXED' | 'ON_REQUEST'
export type DiscountKind = 'NONE' | 'PERCENT' | 'AMOUNT'
export type ItemKind = 'INCLUDED' | 'OPTIONAL' | 'COURTESY'

export type PricingItem = {
    id: string
    kind: ItemKind
    /** Aceita number ou string decimal ("1.50") — o Prisma devolve Decimal serializado como string. */
    quantity: number | string
    unitPriceCents: number
}

export type PricingPackage = {
    priceMode: PriceMode
    fixedPriceCents?: number | null
    discountType: DiscountKind
    /** PERCENT: pontos-base (1000 = 10%). AMOUNT: centavos. */
    discountValue: number
    items: PricingItem[]
}

export type PricedLine = {
    id: string
    kind: ItemKind
    /** Valor cheio da linha (quantidade × unitário). Na cortesia é o valor "riscado". */
    lineCents: number
    /** Quanto a linha soma no total (0 para cortesia, opcional não selecionado ou modo FIXED). */
    chargedCents: number
    selected: boolean
}

export type PackagePricing = {
    onRequest: boolean
    lines: PricedLine[]
    /** Base: valor fixo ou soma dos itens incluídos. */
    baseCents: number
    optionalsCents: number
    /** Soma do valor cheio das cortesias (para mostrar "você ganha R$ X"). */
    courtesyValueCents: number
    grossCents: number
    discountCents: number
    totalCents: number
}

export const LIMITS = {
    maxItems: 100,
    maxQuantity: 10_000,
    maxUnitPriceCents: 1_000_000_000, // R$ 10 milhões
    maxPercentBps: 10_000
} as const

/** Quantidade em centésimos (inteiro), evitando erro de ponto flutuante. */
export function toHundredths(quantity: number | string): number {
    const value = typeof quantity === 'string' ? Number(quantity) : quantity
    if (!Number.isFinite(value) || value < 0) return 0
    return Math.round(value * 100)
}

/** a × b / divisor com arredondamento half-up (todos inteiros não negativos). */
function mulDivHalfUp(a: number, b: number, divisor: number): number {
    return Math.floor((a * b + Math.floor(divisor / 2)) / divisor)
}

export function lineTotalCents(item: Pick<PricingItem, 'quantity' | 'unitPriceCents'>): number {
    return mulDivHalfUp(toHundredths(item.quantity), Math.max(0, Math.trunc(item.unitPriceCents)), 100)
}

export function calculatePackagePricing(pkg: PricingPackage, selectedOptionalIds: Iterable<string> = []): PackagePricing {
    const selected = new Set(selectedOptionalIds)
    const fixedMode = pkg.priceMode === 'FIXED'

    const lines: PricedLine[] = pkg.items.map((item) => {
        const lineCents = lineTotalCents(item)
        if (item.kind === 'COURTESY') {
            return { id: item.id, kind: item.kind, lineCents, chargedCents: 0, selected: true }
        }
        if (item.kind === 'OPTIONAL') {
            const isSelected = selected.has(item.id)
            return { id: item.id, kind: item.kind, lineCents, chargedCents: isSelected ? lineCents : 0, selected: isSelected }
        }
        // Incluído: no modo FIXED o item é descritivo (o preço é o fixo do pacote).
        return { id: item.id, kind: item.kind, lineCents, chargedCents: fixedMode ? 0 : lineCents, selected: true }
    })

    const courtesyValueCents = lines.filter((l) => l.kind === 'COURTESY').reduce((sum, l) => sum + l.lineCents, 0)

    if (pkg.priceMode === 'ON_REQUEST') {
        return {
            onRequest: true,
            lines,
            baseCents: 0,
            optionalsCents: 0,
            courtesyValueCents,
            grossCents: 0,
            discountCents: 0,
            totalCents: 0
        }
    }

    const baseCents = fixedMode
        ? Math.max(0, Math.trunc(pkg.fixedPriceCents ?? 0))
        : lines.filter((l) => l.kind === 'INCLUDED').reduce((sum, l) => sum + l.chargedCents, 0)
    const optionalsCents = lines.filter((l) => l.kind === 'OPTIONAL').reduce((sum, l) => sum + l.chargedCents, 0)
    const grossCents = baseCents + optionalsCents

    let discountCents = 0
    if (pkg.discountType === 'PERCENT') {
        const bps = Math.min(Math.max(0, Math.trunc(pkg.discountValue)), LIMITS.maxPercentBps)
        discountCents = mulDivHalfUp(grossCents, bps, 10_000)
    } else if (pkg.discountType === 'AMOUNT') {
        discountCents = Math.max(0, Math.trunc(pkg.discountValue))
    }
    // O desconto nunca deixa o total negativo.
    discountCents = Math.min(discountCents, grossCents)

    return {
        onRequest: false,
        lines,
        baseCents,
        optionalsCents,
        courtesyValueCents,
        grossCents,
        discountCents,
        totalCents: grossCents - discountCents
    }
}

/** Centavos → "3500.00" (formato legado do campo `price`). */
export function centsToDecimalString(cents: number): string {
    return (cents / 100).toFixed(2)
}

/** "3.500,00", "3500.00", "3500" → centavos. Retorna null se não for número. */
export function parseMoneyToCents(value: string): number | null {
    const trimmed = value.trim()
    if (!trimmed) return null
    const normalized = /,\d{1,2}$/.test(trimmed) ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed.replace(/,/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
    return Math.round(Number(normalized) * 100)
}
