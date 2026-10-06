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
            }
        },
        subscriptions: {
            list: async (params: any) => ({
                data: [...subscriptions.values()].filter((s) => s.customer === params.customer)
            })
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

    return { stripe: fake as unknown as Stripe, products, prices, customers, subscriptions, sessions, portalConfigs, portalSessions, addSubscription }
}

/** Corpo + cabeçalho assinado de um evento, como o Stripe envia. */
export function signedEvent(type: string, object: Record<string, unknown>, secret = 'whsec_dummy') {
    const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object } })
    const header = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload, secret })
    return { payload, header }
}
