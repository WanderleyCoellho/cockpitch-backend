import type { WorkspaceSegment } from '@prisma/client'
import type { ProposalBlock } from '../blocks.js'

/**
 * Modelos do sistema (um ou mais por segmento). Ficam no código, versionados, e não no banco.
 * Placeholders trocados na exibição: {cliente} e {empresa}.
 *
 * Ordem dos blocos nos modelos novos (pesquisa de mercado, ver specs/proposal-templates.md):
 * capa → o momento do cliente → escopo → etapas → provas (portfólio, equipe, depoimentos)
 * → investimento → dúvidas → chamada/contato → condições → aceite. Valor antes do preço.
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
const about = (body: string, title = 'Quem somos'): ProposalBlock => ({ id: 'about', type: 'about', visible: true, title, data: { body } })
const team = (members: Array<[string, string, string]>, title = 'Quem vai cuidar do seu projeto'): ProposalBlock => ({
    id: 'team', type: 'team', visible: true, title,
    data: { members: members.map(([name, role, bio]) => ({ name, role, bio })) }
})
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
const testimonials = (title = 'O que dizem nossos clientes'): ProposalBlock => ({
    id: 'testimonials', type: 'testimonials', visible: true, title,
    data: { items: [{ quote: 'Escreva aqui um depoimento real de um cliente satisfeito. Depoimentos aumentam muito a confiança de quem está decidindo.', author: 'Nome do cliente', role: 'Empresa ou cidade' }] }
})
const faq = (items: Array<[string, string]>): ProposalBlock => ({
    id: 'faq', type: 'faq', visible: true, title: 'Perguntas frequentes',
    data: { items: items.map(([question, answer]) => ({ question, answer })) }
})
const terms = (body: string): ProposalBlock => ({ id: 'terms', type: 'terms', visible: true, title: 'Condições', data: { body } })
const contact = (message: string, title = 'Vamos conversar?'): ProposalBlock => ({
    id: 'contact', type: 'contact', visible: true, title,
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
    },
    // ── Modelos com os temas novos (referências de design enviadas pelo cliente) ──
    {
        id: 'sys-agency-growth', segment: 'AGENCY', theme: 'neon_lime',
        name: 'Agência de crescimento', description: 'Preto e verde-limão, títulos fortes e preços em faixa de destaque.',
        blocks: [
            cover('Estratégia que gera crescimento real', 'Proposta para {cliente}, preparada pela {empresa}'),
            about('<p>Hoje a {cliente} cresce pelo boca a boca, mas sem previsibilidade: tem mês bom e mês fraco, e fica difícil planejar.</p><p>Nosso trabalho é transformar marketing em um processo que gera contatos todo mês, com metas claras e números abertos.</p>', 'O seu momento'),
            scope('Tudo o que entra no projeto:', [['Diagnóstico', 'Análise de canais, concorrência e funil de vendas.'], ['Estratégia', 'Plano de 90 dias com metas e prioridades.'], ['Conteúdo e campanhas', 'Produção, anúncios e otimização contínua.'], ['Relatórios', 'Resultados mês a mês, em linguagem simples.']], 'O que vamos fazer'),
            timeline([['Imersão', 'Conhecemos o negócio, os clientes e os números.', 'Semana 1'], ['Plano', 'Metas, canais e calendário.', 'Semana 2'], ['Crescimento', 'Execução e ajustes a cada 15 dias.', 'A partir do mês 1']], 'Como vamos trabalhar'),
            testimonials('Resultados de quem já cresceu com a gente'),
            pricing('Três formatos para o seu momento. O mais escolhido está em destaque.', 'Investimento'),
            faq([['Em quanto tempo vejo resultado?', 'Os primeiros sinais aparecem no primeiro mês; o crescimento consistente vem a partir do terceiro.'], ['Existe fidelidade?', 'Sugerimos 3 meses, o tempo mínimo para a estratégia amadurecer.']]),
            cta('Vamos acelerar o seu crescimento', 'Quero começar'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-consulting-corporate', segment: 'CONSULTING', theme: 'corporate_green',
        name: 'Consultoria corporativa', description: 'Claro e confiável, com faixas verde-petróleo. Bom para B2B e agronegócio.',
        blocks: [
            cover('Soluções que fortalecem o seu negócio', 'Proposta técnica e comercial para {cliente}'),
            about('<p>Entendemos que a {cliente} precisa de <strong>eficiência e segurança</strong> para crescer: processos claros, custos sob controle e decisões baseadas em dados.</p>', 'O seu desafio'),
            scope('Frentes de trabalho:', [['Diagnóstico', 'Mapeamento de processos, custos e indicadores.'], ['Plano de melhoria', 'Ações priorizadas por impacto e esforço.'], ['Implantação', 'Acompanhamento junto à equipe.'], ['Indicadores', 'Painel mensal de resultados.']], 'Escopo da consultoria'),
            timeline([['Diagnóstico', 'Visitas, entrevistas e análise de dados.', '3 semanas'], ['Plano', 'Apresentação e validação com a diretoria.', '1 semana'], ['Implantação', 'Acompanhamento das ações.', '3 meses']], 'Metodologia'),
            team([['Seu nome', 'Consultor responsável', 'Experiência relevante para este projeto.'], ['Nome do especialista', 'Especialista técnico', 'Área de domínio e principais resultados.']], 'Equipe do projeto'),
            testimonials('Empresas que confiam em nós'),
            pricing('Honorários conforme o escopo acima, com opção de acompanhamento estendido.', 'Investimento'),
            faq([['Como é feito o acompanhamento?', 'Reuniões quinzenais e um relatório mensal com os indicadores.'], ['A equipe interna precisa se dedicar?', 'Pouco: pedimos um ponto focal e duas horas por semana.']]),
            contact('Agende uma conversa com o nosso time.', 'Fale com a gente'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-tech-product', segment: 'TECH', theme: 'impact',
        name: 'Produto digital', description: 'Títulos condensados, destaque em verde-limão e faixas claras. Para apps, sites e SaaS.',
        blocks: [
            cover('Do rascunho ao produto no ar', 'Proposta de desenvolvimento para {cliente}'),
            about('<p>A {cliente} precisa colocar uma ideia no ar <strong>rápido e sem retrabalho</strong>, validando com usuários reais antes de investir pesado.</p>', 'O problema que vamos resolver'),
            scope('O que será entregue:', [['Descoberta', 'Requisitos, fluxos e protótipo navegável.'], ['Design', 'Interface pensada para conversão e uso fácil.'], ['Desenvolvimento', 'Entregas a cada duas semanas.'], ['Lançamento', 'Publicação, métricas e 30 dias de garantia.']], 'Escopo'),
            timeline([['Descoberta', 'Protótipo aprovado.', '2 semanas'], ['Construção', 'Sprints com demonstração.', '6 a 10 semanas'], ['Go-live', 'Publicação e treinamento.', '1 semana']], 'Cronograma'),
            gallery('Projetos entregues'),
            pricing('Valor fechado do projeto e planos opcionais de evolução.', 'Investimento'),
            faq([['O código fica com quem?', 'Com você, após a quitação.'], ['E depois do lançamento?', 'Garantia de 30 dias inclusa; evolução contínua é opcional.']]),
            cta('Vamos tirar isso do papel', 'Aprovar proposta'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-general-studio', segment: 'GENERAL', theme: 'geometric',
        name: 'Estúdio criativo', description: 'Cinza e laranja, formas geométricas e cantos retos. Para design, branding e estúdios.',
        blocks: [
            cover('Uma marca que as pessoas lembram', 'Proposta criativa para {cliente}'),
            about('<p>A {cliente} tem um ótimo produto, mas a comunicação ainda não mostra isso. Vamos criar uma identidade que <strong>diferencia e gera confiança</strong>.</p>', 'Onde estamos hoje'),
            scope('Entregáveis:', [['Pesquisa', 'Público, concorrentes e posicionamento.'], ['Identidade visual', 'Logo, cores, tipografia e aplicações.'], ['Manual da marca', 'Guia para usar tudo do jeito certo.']], 'O que vamos criar'),
            timeline([['Briefing', 'Conversa e pesquisa.', 'Semana 1'], ['Criação', 'Duas rotas criativas para escolher.', 'Semanas 2 a 4'], ['Entrega', 'Arquivos finais e manual.', 'Semana 5']], 'Processo'),
            gallery('Trabalhos recentes'),
            testimonials(),
            pricing('Escolha o pacote; opcionais podem ser adicionados.', 'Investimento'),
            faq([['Quantas revisões estão incluídas?', 'Duas rodadas de ajustes por etapa.']]),
            contact('Vamos conversar sobre a sua marca?'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-photo-video-production', segment: 'PHOTO_VIDEO', theme: 'spotlight',
        name: 'Produtora audiovisual', description: 'Preto com laranja vibrante e brilho. Para vídeos institucionais, publicidade e eventos.',
        blocks: [
            cover('Vídeos que fazem a sua marca ser vista', 'Proposta de produção para {cliente}'),
            about('<p>A {cliente} quer contar a sua história com qualidade de cinema e chegar a mais pessoas, sem complicação na produção.</p>', 'O seu objetivo'),
            scope('O que inclui:', [['Roteiro', 'Ideia, roteiro e decupagem.'], ['Captação', 'Equipe, câmeras, luz e som.'], ['Edição', 'Montagem, cor, trilha e legendas.'], ['Versões', 'Cortes para redes sociais.']], 'Produção completa'),
            timeline([['Pré-produção', 'Roteiro e planejamento.', '1 semana'], ['Gravação', 'Diárias de captação.', 'Data combinada'], ['Pós-produção', 'Edição e entregas.', '2 a 3 semanas']], 'Etapas'),
            gallery('Portfólio'),
            pricing('Pacotes por projeto, com opcionais de versões e diárias extras.', 'Investimento'),
            faq([['Vocês gravam fora da cidade?', 'Sim; deslocamento é combinado à parte.'], ['Quantas revisões?', 'Duas rodadas de ajustes na edição.']]),
            cta('Vamos produzir o seu próximo vídeo', 'Quero produzir'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-health-beauty-skincare', segment: 'HEALTH_BEAUTY', theme: 'nude_editorial',
        name: 'Estética e skincare', description: 'Tons moca e creme, serifa de revista. Antes e depois só com autorização da paciente.',
        blocks: [
            cover('Cuidar da pele é um ato de amor próprio', 'Plano personalizado para {cliente}'),
            about('<p>Na avaliação, você contou o que mais incomoda e o resultado que deseja. Este plano foi montado a partir disso, respeitando o tempo da sua pele.</p>', 'O seu momento'),
            scope('O seu protocolo:', [['Avaliação', 'Análise da pele e histórico.'], ['Sessões', 'Procedimentos do protocolo, no ritmo indicado.'], ['Home care', 'Rotina de cuidados em casa.'], ['Retorno', 'Acompanhamento da evolução.']], 'Seu tratamento'),
            timeline([['Avaliação', 'Primeira consulta.', 'Dia 1'], ['Protocolo', 'Sessões programadas.', '4 a 8 semanas'], ['Manutenção', 'Cuidados para manter o resultado.', 'Contínuo']], 'Como vai ser'),
            testimonials('Quem já cuidou da pele com a gente'),
            pricing('Valores por sessão ou em pacote. O pacote completo tem o melhor custo.', 'Investimento'),
            faq([['Quantas sessões vou precisar?', 'Indicamos na avaliação, de acordo com a sua pele.'], ['Posso remarcar?', 'Sim, com até 24 horas de antecedência.']]),
            contact('Ficou com alguma dúvida? Chame no WhatsApp.', 'Fale comigo'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-health-beauty-clinic', segment: 'HEALTH_BEAUTY', theme: 'bronze_glass',
        name: 'Clínica premium', description: 'Escuro e acolhedor, capa com foto e painel de vidro. Use uma foto sua na capa.',
        blocks: [
            cover('A beleza está nos detalhes', 'Plano de tratamento para {cliente}'),
            about('<p>Cada rosto é único. O seu plano foi pensado para realçar a sua beleza natural, com <strong>segurança e naturalidade</strong>.</p>', 'O seu plano'),
            scope('O que está incluído:', [['Consulta de avaliação', 'Análise facial completa.'], ['Procedimento', 'Técnica indicada para o seu caso.'], ['Revisão', 'Retorno para avaliar e ajustar.']], 'Seu tratamento'),
            team([['Seu nome', 'Responsável técnica', 'Formação, registro profissional e especialidades.']], 'Quem vai cuidar de você'),
            testimonials('Pacientes que confiam no nosso trabalho'),
            pricing('Valores do tratamento e opções de pacote.', 'Investimento'),
            faq([['O resultado fica natural?', 'Sim. Trabalhamos com doses e técnicas que respeitam os seus traços.'], ['Tem recuperação?', 'Na maioria dos casos você volta à rotina no mesmo dia.']]),
            cta('Agende o seu procedimento', 'Quero agendar'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-health-beauty-harmonization', segment: 'HEALTH_BEAUTY', theme: 'champagne',
        name: 'Harmonização facial', description: 'Bege nude, títulos finos e grandes. Antes e depois só educativo e com autorização (CFM 2.336/2023).',
        blocks: [
            cover('Desvende a arte da beleza natural', 'Proposta de harmonização para {cliente}'),
            about('<p>A harmonização cuida dos pequenos detalhes que fazem toda a diferença: <strong>simetria, contornos e volume</strong>, sempre com naturalidade.</p>', 'Sobre o seu plano'),
            scope('Áreas tratadas:', [['Lábios', 'Contorno e hidratação.'], ['Mandíbula e queixo', 'Definição e equilíbrio.'], ['Olhar', 'Suavização de sinais.']], 'Seu plano de harmonização'),
            timeline([['Avaliação', 'Análise facial e planejamento.', 'Consulta'], ['Procedimento', 'Aplicação conforme o plano.', 'Sessão'], ['Revisão', 'Retorno para ajustes finos.', '15 a 30 dias']], 'Etapas'),
            gallery('Resultados'),
            pricing('Valores por área ou em protocolo completo.', 'Investimento'),
            faq([['Dói?', 'Usamos anestésico para o seu conforto.'], ['Quanto tempo dura?', 'Depende do produto e da área; explicamos na avaliação.']]),
            contact('Tire suas dúvidas e agende a sua avaliação.'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-construction-interiors', segment: 'CONSTRUCTION', theme: 'sand_portfolio',
        name: 'Arquitetura e interiores', description: 'Portfólio claro em tons de areia, com faixas taupe e serifa elegante.',
        blocks: [
            cover('Arquitetura como forma de dar sentido ao espaço', 'Proposta comercial para {cliente}'),
            about('<p>Você quer um espaço que seja a sua cara, funcional no dia a dia e bonito por muitos anos. Este projeto parte da sua rotina e do seu jeito de viver.</p>', 'Olá!'),
            scope('Serviços:', [['Projeto arquitetônico', 'Estudo, layout e projeto executivo.'], ['Design de interiores', 'Mobiliário, iluminação e materiais.'], ['Acompanhamento de obra', 'Visitas técnicas e apoio a fornecedores.']], 'Meus serviços'),
            timeline([['Briefing', 'Entendimento das necessidades.', 'Semana 1'], ['Estudo preliminar', 'Layout e conceito.', 'Semanas 2 a 4'], ['Projeto executivo', 'Detalhamento completo.', 'Semanas 5 a 8']], 'Etapas do projeto'),
            gallery('Portfólio'),
            testimonials('Palavras de clientes'),
            pricing('Proposta de orçamento por etapa ou pacote completo.', 'Investimento'),
            faq([['O orçamento da obra está incluso?', 'Não; ajudamos a cotar com fornecedores de confiança.']]),
            contact('Vamos conversar sobre o seu espaço?'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    },
    {
        id: 'sys-construction-architecture', segment: 'CONSTRUCTION', theme: 'golden_arch',
        name: 'Escritório de arquitetura', description: 'Branco quente e dourado, títulos fortes em caixa alta e linhas finas.',
        blocks: [
            cover('Arquitetura que transforma', 'Projetos que inspiram, soluções que perduram. Proposta para {cliente}.'),
            about('<p>Mais que projetar espaços, realizamos sonhos e valorizamos histórias. Para a {cliente}, o objetivo é <strong>unir beleza, conforto e funcionalidade</strong> dentro do orçamento.</p>', 'O seu projeto'),
            scope('Nossos pilares:', [['Projeto', 'Planejamento inteligente e soluções sob medida.'], ['Inovação', 'Criatividade e tecnologia em cada etapa.'], ['Funcionalidade', 'Espaços pensados para o dia a dia.'], ['Sustentabilidade', 'Conforto com menos impacto.']], 'Nossos pilares'),
            timeline([['Levantamento', 'Visita técnica e medições.', 'Semana 1'], ['Anteprojeto', 'Conceito e volumetria.', 'Semanas 2 a 5'], ['Executivo e aprovação', 'Detalhamento e prefeitura.', 'Semanas 6 a 12']], 'Do conceito à realização'),
            gallery('Obras e projetos'),
            team([['Seu nome', 'Arquiteto(a) responsável', 'Registro no CAU e principais projetos.']], 'Equipe'),
            pricing('Honorários por etapa, com opção de gerenciamento de obra.', 'Investimento'),
            faq([['A aprovação na prefeitura está incluída?', 'Sim, no pacote completo.']]),
            cta('Vamos construir o seu projeto', 'Quero começar'),
            terms(DEFAULT_TERMS),
            acceptance()
        ]
    }
]

export function findSystemTemplate(id: string) {
    return SYSTEM_TEMPLATES.find((template) => template.id === id) ?? null
}
