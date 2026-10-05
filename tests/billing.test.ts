import { describe, expect, it } from 'vitest'
import { mapPlanTier, priceIdForTier } from '../src/lib/billing.js'

describe('mapPlanTier', () => {
    it('resolve o plano pelo mapa explícito de preços', () => {
        expect(mapPlanTier('price_starter_test')).toBe('STARTER')
        expect(mapPlanTier('price_pro_test')).toBe('PRO')
    })

    it('retorna null para preço não mapeado (quem chama preserva o plano atual)', () => {
        expect(mapPlanTier('price_1AbCdEf')).toBeNull()
        expect(mapPlanTier('price_pro_placeholder')).toBeNull()
        expect(mapPlanTier(null)).toBeNull()
    })

    it('não casa preço vazio com plano sem configuração', () => {
        // STRIPE_PRICE_AGENCY não está configurado nos testes
        expect(priceIdForTier('AGENCY')).toBeNull()
        expect(mapPlanTier('')).toBeNull()
    })
})
