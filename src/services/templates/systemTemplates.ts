import type { WorkspaceSegment } from '@prisma/client'
import type { ProposalBlock } from '../blocks.js'

/**
 * Modelos do sistema (um por segmento). Ficam no código, versionados, e não no banco.
 * Placeholders trocados na exibição: {cliente} e {empresa}.
 */
export type SystemTemplate = {
    id: string
    segment: WorkspaceSegment
    name: string
    description: string
    theme: string
    blocks: ProposalBlock[]
}

const cover = (headline: string, subheadline: string): ProposalBlock => ({
    id: 'cover', type: 'cover', visible: true, title: '',
    data: { headline, subheadline, showClientName: true }
})
const about = (body: string): ProposalBlock => ({ id: 'about', type: 'about', visible: true, title: 'Quem somos', data: { body } })
const scope = (intro: string, items: Array<[string, string]>, title = 'O que está incluso'): ProposalBlock => ({
    id: 'scope', type: 'scope', visible: true, title,
    data: { intro, items: items.map(([t, d]) => ({ title: t, description: d })) }
})
const pricing = (intro: string, title = 'Investimento'): ProposalBlock => ({ id: 'pricing', type: 'pricing', visible: true, title, data: { intro } })
const timeline = (steps: Array<[string, string, string]>, title = 'Como vamos trabalhar'): ProposalBlock => ({
    id: 'timeline', type: 'timeline', visible: true, title,
    data: { steps: steps.map(([t, d, duration]) => ({ title: t, description: d, duration })) }
})
const gallery = (title = 'Portfólio'): ProposalBlock => ({ id: 'gallery', type: 'gallery', visible: true, title, data: { items: [] } })
const testimonials = (): ProposalBlock => ({
    id: 'testimonials', type: 'testimonials', visible: true, title: 'O que dizem nossos clientes',
    data: { items: [{ quote: 'Escreva aqui um depoimento real de um cliente satisfeito. Depoimentos aumentam muito a confiança de quem está decidindo.', author: 'Nome do cliente', role: 'Empresa ou cidade' }] }
})
const faq = (items: Array<[string, string]>): ProposalBlock => ({
    id: 'faq', type: 'faq', visible: true, title: 'Perguntas frequentes',
    data: { items: items.map(([question, answer]) => ({ question, answer })) }
})
const terms = (body: string): ProposalBlock => ({ id: 'terms', type: 'terms', visible: true, title: 'Condições', data: { body } })
const contact = (message: string): ProposalBlock => ({
    id: 'contact', type: 'contact', visible: true, title: 'Vamos conversar?',
    data: { message, showWhatsapp: true, showEmail: true, showInstagram: true }
})
const acceptance = (intro = 'Gostou? Escolha o pacote, confira o total e aceite online. Se quiser mudar algo, é só pedir um ajuste.'): ProposalBlock => ({
    id: 'acceptance', type: 'acceptance', visible: true, title: 'Aceitar proposta',
    data: { intro, allowDecline: true, allowChangeRequest: true, requireDocument: false }
})
const cta = (headline: string, buttonLabel = 'Quero fechar'): ProposalBlock => ({ id: 'cta', type: 'cta', visible: true, title: '', data: { headline, buttonLabel } })

const DEFAULT_TERMS =
    '<p><strong>Validade:</strong> esta proposta é válida pelo prazo indicado no topo da página.</p>' +
    '<p><strong>Pagamento:</strong> 50% na aprovação e 50% na entrega (ajuste conforme sua política).</p>' +
    '<p><strong>Alterações:</strong> mudanças de escopo após a aprovação podem gerar novo orçamento.</p>'

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
    {
        id: 'sys-photo-video', segment: 'PHOTO_VIDEO', theme: 'dark_luxury',
        name: 'Fotografia e vídeo', description: 'Capa com vídeo, portfólio em destaque, pacotes e depoimentos.',
        blocks: [
            cover('Uma história que merece ser eternizada', 'Proposta preparada com carinho para {cliente}'),
            about('<p>Somos a <strong>{empresa}</strong>. Contamos histórias com imagem e emoção, com um olhar atento a cada detalhe do seu dia.</p>'),
            gallery('Nosso trabalho'),
            pricing('Escolha o pacote ideal. Você pode adicionar opcionais e ver o valor final na hora.', 'Pacotes'),
            timeline([['Reunião de alinhamento', 'Entendemos seu estilo, roteiro e momentos importantes.', '1 semana antes'], ['O grande dia', 'Cobertura completa conforme o pacote escolhido.', 'Data do evento'], ['Entrega', 'Fotos tratadas e vídeo editado em galeria online.', 'Até 60 dias']]),
            testimonials(),
            faq([['Vocês viajam para outras cidades?', 'Sim. Custos de deslocamento são combinados à parte.'], ['Como recebo o material?', 'Por galeria online privada, com download em alta resolução.']]),
            terms(DEFAULT_TERMS),
            acceptance(),
            contact('Ficou alguma dúvida? Fale com a gente, vai ser um prazer ajudar.')
        ]
    },
    {
        id: 'sys-events', segment: 'EVENTS', theme: 'rose_blush',
        name: 'Eventos', description: 'Para buffet, decoração, cerimonial, DJ e produção de eventos.',
        blocks: [
            cover('Seu evento, do jeito que você imaginou', 'Proposta exclusiva para {cliente}'),
            about('<p>A <strong>{empresa}</strong> cuida de cada detalhe para que você só se preocupe em aproveitar.</p>'),
            scope('Tudo o que está previsto para o seu evento:', [['Planejamento', 'Reuniões e definição de layout, cardápio ou repertório.'], ['Execução', 'Equipe completa no dia, do início ao fim.'], ['Desmontagem', 'Retirada de materiais e equipamentos.']]),
            gallery('Eventos que realizamos'),
            pricing('Monte seu pacote e acompanhe o valor final.'),
            timeline([['Reserva da data', 'Confirmação com sinal.', 'Hoje'], ['Degustação ou reunião técnica', 'Ajustes finos.', '30 dias antes'], ['Dia do evento', 'Execução completa.', 'Data marcada']]),
            faq([['A data fica reservada?', 'Sim, após a confirmação do sinal.'], ['Posso mudar o número de convidados?', 'Sim, até 15 dias antes, com ajuste no valor.']]),
            terms(DEFAULT_TERMS),
            acceptance(),
            contact('Vamos tirar seu evento do papel?')
        ]
    },
    {
        id: 'sys-agency', segment: 'AGENCY', theme: 'midnight_navy',
        name: 'Agência e marketing', description: 'Diagnóstico, entregáveis, cronograma e investimento mensal.',
        blocks: [
            cover('Estratégia para {cliente} crescer com consistência', 'Proposta comercial — {empresa}'),
            scope('Entregáveis mensais:', [['Planejamento de conteúdo', 'Calendário editorial alinhado aos objetivos.'], ['Produção e design', 'Posts, stories e peças para campanhas.'], ['Relatório de resultados', 'Indicadores e próximos passos todo mês.']], 'Escopo do trabalho'),
            timeline([['Onboarding', 'Acesso às contas, briefing e diagnóstico.', 'Semana 1'], ['Estratégia', 'Plano de comunicação e metas.', 'Semana 2'], ['Execução', 'Produção e publicação contínuas.', 'A partir da semana 3']]),
            pricing('Planos mensais. Opcionais podem ser adicionados a qualquer momento.', 'Planos'),
            about('<p>A <strong>{empresa}</strong> une estratégia, criatividade e dados para gerar resultado de verdade.</p>'),
            testimonials(),
            faq([['Existe fidelidade?', 'Contrato mínimo de 3 meses para que a estratégia tenha tempo de gerar resultado.'], ['Quem aprova os conteúdos?', 'Você aprova tudo antes da publicação.']]),
            cta('Pronto para começar?', 'Quero começar'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-consulting', segment: 'CONSULTING', theme: 'editorial',
        name: 'Consultoria e serviços profissionais', description: 'Objetivo, metodologia, etapas, equipe e honorários.',
        blocks: [
            cover('Proposta de consultoria para {cliente}', 'Preparada por {empresa}'),
            scope('Objetivo: descreva aqui o problema do cliente e o resultado esperado.', [['Diagnóstico', 'Levantamento da situação atual.'], ['Plano de ação', 'Recomendações priorizadas.'], ['Acompanhamento', 'Apoio na implementação.']], 'Escopo e entregáveis'),
            timeline([['Diagnóstico', 'Entrevistas e análise de documentos.', '2 semanas'], ['Recomendações', 'Relatório e apresentação.', '1 semana'], ['Implementação', 'Acompanhamento das ações.', 'Conforme contratado']], 'Metodologia e prazos'),
            { id: 'team', type: 'team', visible: true, title: 'Equipe responsável', data: { members: [{ name: 'Seu nome', role: 'Consultor responsável', bio: 'Breve resumo da experiência relevante para este projeto.' }] } },
            pricing('Honorários conforme o escopo acima.', 'Honorários'),
            terms(DEFAULT_TERMS),
            acceptance(),
            contact('Fico à disposição para esclarecer qualquer ponto.')
        ]
    },
    {
        id: 'sys-health-beauty', segment: 'HEALTH_BEAUTY', theme: 'clean_pastel',
        name: 'Saúde e beleza', description: 'Tratamento, sessões, resultados esperados e cuidados.',
        blocks: [
            cover('Seu plano de cuidados, {cliente}', 'Elaborado por {empresa}'),
            scope('O que inclui o seu tratamento:', [['Avaliação inicial', 'Entendemos suas necessidades e objetivos.'], ['Sessões', 'Protocolo personalizado.'], ['Retorno', 'Acompanhamento dos resultados.']], 'Seu tratamento'),
            pricing('Valores por sessão ou em pacote, com opcionais.', 'Investimento'),
            gallery('Resultados'),
            faq([['Quantas sessões são necessárias?', 'Depende da avaliação; indicamos o número ideal para o seu caso.'], ['Posso remarcar?', 'Sim, com até 24 horas de antecedência.']]),
            terms(DEFAULT_TERMS),
            acceptance(),
            contact('Agende sua avaliação ou tire suas dúvidas pelo WhatsApp.')
        ]
    },
    {
        id: 'sys-construction', segment: 'CONSTRUCTION', theme: 'editorial',
        name: 'Obras e reformas', description: 'Escopo detalhado, etapas da obra, prazos e orçamento.',
        blocks: [
            cover('Orçamento de obra para {cliente}', '{empresa}'),
            scope('Serviços previstos:', [['Demolição e preparação', 'Retirada de revestimentos e limpeza.'], ['Execução', 'Serviços conforme projeto.'], ['Acabamento e entrega', 'Limpeza final e vistoria.']], 'Escopo dos serviços'),
            timeline([['Mobilização', 'Equipe e materiais no local.', 'Semana 1'], ['Execução', 'Etapas principais da obra.', 'Semanas 2 a 6'], ['Entrega', 'Vistoria final com o cliente.', 'Semana 7']], 'Cronograma'),
            pricing('Valores por etapa ou fechados, conforme indicado.', 'Orçamento'),
            gallery('Obras realizadas'),
            terms('<p><strong>Materiais:</strong> informe se estão inclusos ou não.</p>' + DEFAULT_TERMS),
            acceptance(),
            contact('Agende uma visita técnica sem compromisso.')
        ]
    },
    {
        id: 'sys-education', segment: 'EDUCATION', theme: 'clean_pastel',
        name: 'Educação e treinamentos', description: 'Programa, carga horária, formato e investimento.',
        blocks: [
            cover('Programa de treinamento para {cliente}', '{empresa}'),
            scope('Conteúdo programático:', [['Módulo 1', 'Fundamentos.'], ['Módulo 2', 'Prática guiada.'], ['Módulo 3', 'Aplicação no dia a dia.']], 'Programa'),
            timeline([['Formato', 'Presencial, online ou híbrido.', ''], ['Carga horária', 'Total de horas do programa.', ''], ['Certificado', 'Emitido ao final para os participantes.', '']], 'Como funciona'),
            pricing('Valor por turma ou por participante.'),
            testimonials(),
            faq([['Há material de apoio?', 'Sim, entregue a todos os participantes.']]),
            terms(DEFAULT_TERMS),
            acceptance(),
            contact('Vamos montar a turma ideal para sua equipe.')
        ]
    },
    {
        id: 'sys-tech', segment: 'TECH', theme: 'midnight_navy',
        name: 'Tecnologia', description: 'Projeto de software, sites ou suporte: escopo, sprints e investimento.',
        blocks: [
            cover('Proposta de projeto para {cliente}', '{empresa}'),
            scope('Funcionalidades previstas:', [['Descoberta', 'Levantamento de requisitos e protótipo.'], ['Desenvolvimento', 'Entregas incrementais.'], ['Publicação e suporte', 'Implantação e período de garantia.']], 'Escopo do projeto'),
            timeline([['Descoberta', 'Requisitos e protótipo navegável.', '2 semanas'], ['Desenvolvimento', 'Sprints com entregas quinzenais.', '6 a 10 semanas'], ['Go-live', 'Publicação e treinamento.', '1 semana']], 'Cronograma'),
            pricing('Investimento do projeto e opcionais de suporte.'),
            faq([['O código fica com quem?', 'Com você, após a quitação do projeto.'], ['Há suporte após a entrega?', 'Sim, 30 dias de garantia inclusos; planos de suporte são opcionais.']]),
            cta('Vamos construir isso juntos?', 'Aprovar proposta'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-general', segment: 'GENERAL', theme: 'dark_luxury',
        name: 'Serviços em geral', description: 'Modelo enxuto que serve para qualquer tipo de serviço.',
        blocks: [
            cover('Proposta para {cliente}', 'Preparada por {empresa}'),
            about('<p>Conte em poucas linhas quem é a <strong>{empresa}</strong> e por que o cliente pode confiar em você.</p>'),
            scope('O que vamos entregar:', [['Item 1', 'Descreva o primeiro entregável.'], ['Item 2', 'Descreva o segundo entregável.']]),
            pricing('Escolha a opção que faz mais sentido para você.'),
            faq([['Como funciona o pagamento?', 'Explique aqui as formas e prazos de pagamento.']]),
            terms(DEFAULT_TERMS),
            acceptance(),
            contact('Qualquer dúvida, é só chamar.')
        ]
    }
]

export function findSystemTemplate(id: string) {
    return SYSTEM_TEMPLATES.find((template) => template.id === id) ?? null
}
