import { describe, expect, it } from 'vitest'
import { mapPlanTier, priceIdForTier, tierForPrice } from '../src/lib/billing.js'

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

describe('tierForPrice', () => {
    it('reconhece os preços do catálogo pela lookup_key e os legados pelo ID', () => {
        expect(tierForPrice({ id: 'price_qualquer', lookup_key: 'lumen_deal_equipe_mensal' })).toBe('AGENCY')
        expect(tierForPrice({ id: 'price_pro_test', lookup_key: null })).toBe('PRO')
        expect(tierForPrice({ id: 'price_x', lookup_key: 'outro_produto' })).toBeNull()
    })
})
