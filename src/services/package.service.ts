import type { Package, PackageItem, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { calculatePackagePricing, centsToDecimalString, LIMITS, parseMoneyToCents, type PricingPackage } from './pricing.js'

type Db = typeof prisma | Prisma.TransactionClient
type PackageWithItems = Package & { items: PackageItem[] }

/** Item com quantidade numérica (o Prisma devolve Decimal, que viraria string no JSON). */
export function serializeItem(item: PackageItem) {
    return { ...item, quantity: Number(item.quantity) }
}

function toPricingInput(pkg: PackageWithItems): PricingPackage {
    return {
        priceMode: pkg.priceMode,
        fixedPriceCents: pkg.fixedPriceCents,
        discountType: pkg.discountType,
        discountValue: pkg.discountValue,
        items: pkg.items.map((item) => ({
            id: item.id,
            kind: item.kind,
            quantity: Number(item.quantity),
            unitPriceCents: item.unitPriceCents
        }))
    }
}

/** Pacote para a API: itens ordenados, quantidade numérica e o preço calculado (sem opcionais). */
export function serializePackage(pkg: PackageWithItems) {
    const items = [...pkg.items].sort((a, b) => a.order - b.order || a.createdAt.getTime() - b.createdAt.getTime())
    return {
        ...pkg,
        items: items.map(serializeItem),
        pricing: calculatePackagePricing(toPricingInput({ ...pkg, items }))
    }
}

/**
 * Mantém o campo legado `price` ("3500.00") igual ao total calculado, para telas e integrações antigas.
 * Chamado depois de qualquer alteração no pacote ou nos seus itens.
 */
export async function refreshPackagePrice(db: Db, packageId: string) {
    const pkg = await db.package.findUnique({ where: { id: packageId }, include: { items: true } })
    if (!pkg) return null
    const pricing = calculatePackagePricing(toPricingInput(pkg))
    const price = pricing.onRequest ? (pkg.priceLabel?.trim() || 'Sob consulta') : centsToDecimalString(pricing.totalCents)
    if (price !== pkg.price) {
        await db.package.update({ where: { id: packageId }, data: { price } })
    }
    return { ...pkg, price }
}

/**
 * Compatibilidade com clientes antigos que só enviam `price` em texto:
 * vira valor fixo em centavos, ou "sob consulta" com o texto como rótulo.
 */
export function legacyPriceToFields(price: string | undefined) {
    if (price === undefined) return {}
    const cents = parseMoneyToCents(price)
    return cents === null
        ? { priceMode: 'ON_REQUEST' as const, fixedPriceCents: null, priceLabel: price }
        : { priceMode: 'FIXED' as const, fixedPriceCents: cents }
}

export async function assertItemCapacity(db: Db, packageId: string) {
    const count = await db.packageItem.count({ where: { packageId } })
    return count < LIMITS.maxItems
}
