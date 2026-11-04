import Stripe from 'stripe'

/** Stripe em memória com só o que a API usa. As assinaturas de webhook usam a biblioteca real. */
export function createStripeFake() {
    let seq = 0
    const id = (prefix: string) => `${prefix}_fake${++seq}`
    const notFound = (what: string) => Object.assign(new Error(`No such ${what}`), { code: 'resource_missing' })

    const products = new Map<string, any>()
    const prices = new Map<string, any>()
    const customers = new Map<string, any>()
    const subscriptions = new Map<string, any>()
    const sessions = new Map<string, any>()
    const portalConfigs: any[] = []
    const portalSessions: any[] = []
    const charges = new Map<string, any>()
    const paymentMethods = new Map<string, any>()
    const real = new Stripe('sk_test_dummy')

    const fake = {
        webhooks: real.webhooks,
        products: {
            retrieve: async (pid: string) => {
                if (!products.has(pid)) throw notFound('product')
                return products.get(pid)
            },
            create: async (params: any) => {
                if (products.has(params.id)) throw Object.assign(new Error('exists'), { code: 'resource_already_exists' })
                const product = { ...params, object: 'product', default_price: null }
                products.set(params.id, product)
                return product
            },
            update: async (pid: string, params: any) => Object.assign(products.get(pid), params)
        },
        prices: {
            list: async (params: any) => ({
                data: [...prices.values()].filter((p) => p.active && params.lookup_keys.includes(p.lookup_key))
            }),
            create: async (params: any) => {
                if (params.transfer_lookup_key) {
                    for (const p of prices.values()) if (p.lookup_key === params.lookup_key) p.lookup_key = null
                }
                const price = { id: id('price'), object: 'price', active: true, ...params }
                prices.set(price.id, price)
                return price
            }
        },
        customers: {
            create: async (params: any) => {
                const customer = { id: id('cus'), object: 'customer', ...params }
                customers.set(customer.id, customer)
                return customer
            },
            retrieve: async (cid: string) => {
                if (!customers.has(cid)) throw notFound('customer')
                return customers.get(cid)
            },
            update: async (cid: string, params: any) => {
                if (!customers.has(cid)) throw notFound('customer')
                return Object.assign(customers.get(cid), params)
            },
            /** Como no Stripe: apagar o cliente cancela as assinaturas na hora e remove os cartões. */
            del: async (cid: string) => {
                if (!customers.has(cid)) throw notFound('customer')
                customers.delete(cid)
                for (const sub of subscriptions.values()) if (sub.customer === cid) sub.status = 'canceled'
                for (const pm of paymentMethods.values()) if (pm.customer === cid) pm.customer = null
                return { id: cid, object: 'customer', deleted: true }
            },
            listPaymentMethods: async (cid: string) => ({ data: [...paymentMethods.values()].filter((pm) => pm.customer === cid) })
        },
        paymentMethods: {
            detach: async (pmid: string) => {
                if (!paymentMethods.has(pmid)) throw notFound('payment_method')
                const pm = paymentMethods.get(pmid)
                pm.customer = null
                return pm
            }
        },
        charges: {
            retrieve: async (chid: string) => {
                if (!charges.has(chid)) throw notFound('charge')
                return charges.get(chid)
            }
        },
        subscriptions: {
            list: async (params: any) => ({
                data: [...subscriptions.values()].filter((s) => s.customer === params.customer)
            }),
            cancel: async (sid: string) => {
                if (!subscriptions.has(sid)) throw notFound('subscription')
                const sub = subscriptions.get(sid)
                sub.status = 'canceled'
                return sub
            }
        },
        checkout: {
            sessions: {
                create: async (params: any) => {
                    const session = { id: id('cs'), object: 'checkout.session', url: 'https://checkout.stripe.com/fake', ...params }
                    sessions.set(session.id, session)
                    return session
                },
                retrieve: async (sid: string) => {
                    if (!sessions.has(sid)) throw notFound('checkout session')
                    return sessions.get(sid)
                }
            }
        },
        billingPortal: {
            configurations: {
                list: async () => ({ data: portalConfigs.filter((c) => c.active) }),
                create: async (params: any) => {
                    const config = { id: id('bpc'), active: true, ...params }
                    portalConfigs.push(config)
                    return config
                }
            },
            sessions: {
                create: async (params: any) => {
                    const session = { id: id('bps'), url: 'https://billing.stripe.com/fake', ...params }
                    portalSessions.push(session)
                    return session
                }
            }
        }
    }

    /** Simula uma assinatura criada pelo Stripe para o cliente. */
    function addSubscription(customer: string, priceId: string, status: Stripe.Subscription.Status = 'active', extra: Record<string, unknown> = {}) {
        const price = prices.get(priceId) ?? { id: priceId, lookup_key: null }
        const sub = {
            id: id('sub'),
            object: 'subscription',
            customer,
            status,
            created: Math.floor(Date.now() / 1000) + seq,
            cancel_at_period_end: false,
            items: { data: [{ id: id('si'), price }] },
            ...extra
        }
        subscriptions.set(sub.id, sub)
        return sub
    }

    /** Simula uma cobrança paga pelo cliente (disputas e alertas de fraude apontam para ela). */
    function addCharge(customer: string, amount = 9900) {
        const charge = { id: id('ch'), object: 'charge', customer, amount, currency: 'brl', amount_refunded: 0, refunded: false }
        charges.set(charge.id, charge)
        return charge
    }

    /** Cartão salvo no cliente. */
    function addPaymentMethod(customer: string) {
        const pm = { id: id('pm'), object: 'payment_method', type: 'card', customer }
        paymentMethods.set(pm.id, pm)
        return pm
    }

    return {
        stripe: fake as unknown as Stripe,
        products,
        prices,
        customers,
        subscriptions,
        sessions,
        portalConfigs,
        portalSessions,
        charges,
        paymentMethods,
        addSubscription,
        addCharge,
        addPaymentMethod
    }
}

/** Corpo + cabeçalho assinado de um evento, como o Stripe envia. */
export function signedEvent(type: string, object: Record<string, unknown>, options: { secret?: string; livemode?: boolean; id?: string } = {}) {
    const { secret = 'whsec_dummy', livemode = false, id = `evt_${Math.random().toString(36).slice(2)}` } = options
    const payload = JSON.stringify({ id, object: 'event', type, livemode, data: { object } })
    const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret })
    return { payload, header }
}
