import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// headers necessários pra o navegador aceitar as requisições
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { userQuery, queryOriginal, genero, categoria } = await req.json()
    // pega as chaves de API das variáveis de ambiente
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!
    const hfToken = Deno.env.get("HUGGINGFACE_TOKEN")!
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)
    // palavras que indicam que é uma busca de perfume
    const palavrasChave = [

      'perfume', 'fragrância', 'fragrance', 'aroma', 'cheiro', 'cologne', 'eau de',
      'floral', 'amadeirado', 'cítrico', 'oriental', 'fresco', 'doce', 'almiscarado',
      'notas', 'base', 'topo', 'coração', 'oud', 'baunilha', 'rosa', 'jasmim',
      'masculino', 'feminino', 'unissex', 'nicho', 'designer', 'árabe', 'nacional',
      'intenso', 'suave', 'marcante', 'leve', 'sofisticado', 'elegante', 'refrescante',
      'verão', 'inverno', 'festa', 'trabalho', 'casual', 'esportivo', 'sedutor',
      'procuro', 'busco', 'indica', 'recomenda', 'sugere', 'similar', 'quero',
      'parecido', 'cheiroso', 'fragrante', 'olfativo', 'sillage', 'fixação',
      'woody', 'fresh', 'sweet', 'spicy', 'aquatic', 'musky', 'citrus'
    ]

    // palavras de conversa casual tipo "obrigado" "oi" etc
    const palavrasConversa = [
      'obrigado', 'obrigada', 'olá', 'oi', 'tudo bem', 'valeu', 'legal', 'ótimo',
      'perfeito', 'gostei', 'adorei', 'excelente', 'muito bom', 'ok', 'entendi'
    ]

    // usa a query original (sem os filtros) pra verificar o contexto
     const queryParaVerificar = (queryOriginal || userQuery).toLowerCase()
    const ehPedidoPerfume = palavrasChave.some(p => queryParaVerificar.includes(p))
    const ehConversa = palavrasConversa.some(p => queryParaVerificar.includes(p))

    // resposta para saudações e agradecimentos
    if (!ehPedidoPerfume && ehConversa) {

      const conversaResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
        contents: [{ parts: [{ text: `Você é o Olfatto, um assistente especialista em perfumes. O usuário disse: "${queryOriginal || userQuery}". Responda de forma breve, elegante e em português brasileiro. Responda à saudação ou agradecimento de forma simpática e pergunte se pode ajudar com alguma fragrância.` }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.8 }
          })
        }
      )
      const conversaData = await conversaResponse.json()
    const resposta = conversaData.candidates?.[0]?.content?.parts?.[0]?.text || 'Fico feliz em ajudar! Deseja descobrir alguma fragrância especial?'
      return new Response(

        JSON.stringify({ sucesso: true, recomendacao: resposta, dados: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } }
      )
    }
    // se não tem nada a ver com perfume, recusa o pedido
    if (!ehPedidoPerfume && !ehConversa) {

      return new Response(
        JSON.stringify({
         sucesso: true,
          recomendacao: 'Sou especialista apenas em perfumes e fragrâncias. Posso ajudá-lo a encontrar a fragrância perfeita para você! Descreva o tipo de perfume que procura.',
          dados: []
        }),

        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } }
      )
    }

    // gera o vetor de embedding pelo HuggingFace,usei o all-MiniLM-L6-v2 porque é leve e funciona bem pra essa busca semântica
     const embResponse = await fetch(

      "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
      {
        method: 'POST',
        headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${hfToken}` },
        body: JSON.stringify({ inputs: userQuery })
      }
    )

    const embData = await embResponse.json()

    // as vezes o HuggingFace manda [[...]] em vez de [...], trato isso aqui
    let queryVector = embData
    if (Array.isArray(embData) && Array.isArray(embData[0])) {
    queryVector = embData[0]
    }
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
     throw new Error("Não foi possível gerar o vetor para a sua busca.")
    }

    // mapeia os filtros do portugues pro inglês que tá no banco
    const filtroGenero = genero === 'masculino' ? 'men'
     : genero === 'feminino' ? 'women'
    : genero === 'compartilhável' ? 'unisex'
    : ''

    const filtroCategoria = categoria === 'árabe' ? 'arabe'
    : categoria === 'nacional' ? 'nacional'
     : categoria === 'designer' ? 'designer'
     : categoria === 'nicho' ? 'nicho'
    : ''
    // busca os 15 mais similares com threshold alto primeiro
    const { data: perfumes, error: rpcError } = await supabase.rpc('match_perfumes', {

      query_embedding: queryVector,

      match_threshold: 0.45,
      match_count: 15,
      filtro_genero: filtroGenero,
      filtro_categoria: filtroCategoria
    })

    if (rpcError) throw new Error(`Erro na busca do banco: ${rpcError.message}`)

    // se não achou nada com threshold alto, tenta com um mais baixo
    let pool = perfumes || []
    if (pool.length === 0) {
      const { data: perfumesFallback } = await supabase.rpc('match_perfumes', {
       query_embedding: queryVector,
        match_threshold: 0.3,
      match_count: 15,
      filtro_genero: filtroGenero,
        filtro_categoria: filtroCategoria
      })
      pool = perfumesFallback || []
    }
    const listaPerfumes = pool.map((p: any, i: number) =>
   `${i+1}. ${p.nome} (${p.marca}) | Notas: ${p.notas} | Acordes: ${p.accords}`
    ).join('\n')

    // manda a lista pro gemini e deixa ele escolher os 3 melhores perfumes
    const prompt = `Você é um sommelier de perfumes brasileiro. O cliente pediu: "${queryOriginal || userQuery}"

Filtros selecionados pelo cliente: Gênero: ${filtroGenero || 'não especificado'} | Categoria: ${filtroCategoria || 'não especificada'}
Perfumes disponíveis:
${listaPerfumes}

IMPORTANTE: Os filtros selecionados têm prioridade absoluta sobre o texto do cliente. Se o texto contradiz os filtros, escolha perfumes que sigam os filtros e mencione educadamente na recomendação que seguiu as opções selecionadas.

Escolha os 3 perfumes DIFERENTES e mais adequados respeitando os filtros. Responda OBRIGATORIAMENTE em português brasileiro seguindo EXATAMENTE este formato sem nenhum texto extra:

RECOMENDACAO: [2 frases elegantes apresentando os 3 perfumes. Se o texto contradiz os filtros, mencione que seguiu as opções selecionadas]
ESCOLHIDO_1: [número do primeiro perfume escolhido]
NOTAS_1: [notas traduzidas para português, separadas por |]
ACORDES_1: [acordes traduzidos para português, separados por ,]
ESCOLHIDO_2: [número do segundo perfume escolhido, DIFERENTE do primeiro]
NOTAS_2: [notas traduzidas para português, separadas por |]
ACORDES_2: [acordes traduzidos para português, separados por ,]
ESCOLHIDO_3: [número do terceiro perfume escolhido, DIFERENTE dos anteriores]
NOTAS_3: [notas traduzidas para português, separadas por |]
ACORDES_3: [acordes traduzidos para português, separados por ,]`

    const chatResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8, maxOutputTokens: 2000 }
        })
      }
    )

    const chatData = await chatResponse.json()
    const fullText = chatData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    const recomendacaoMatch = fullText.match(/RECOMENDACAO:\s*(.+?)(?=ESCOLHIDO_1:|$)/s)
    
    const recomendacao = recomendacaoMatch?.[1]?.trim() || "Encontrei ótimas opções para você!"
    // pega quais perfumes o gemini escolheu
    const escolhido1 = parseInt(fullText.match(/ESCOLHIDO_1:\s*(\d+)/)?.[1] || '1') - 1
    const escolhido2 = parseInt(fullText.match(/ESCOLHIDO_2:\s*(\d+)/)?.[1] || '2') - 1
    const escolhido3 = parseInt(fullText.match(/ESCOLHIDO_3:\s*(\d+)/)?.[1] || '3') - 1

    // garante que os 3 perfumes sao diferentes e que os índices são validos
    const indicesUsados = new Set<number>()
    const indicesFinais: number[] = []

    for (const idx of [escolhido1, escolhido2, escolhido3]) {
      const idxValido = Math.max(0, Math.min(idx, pool.length - 1))
      if (!indicesUsados.has(idxValido)) {
      indicesUsados.add(idxValido)
      indicesFinais.push(idxValido)
      }
    }
    // completa com outros se o gemini repetiu algum
    for (let i = 0; indicesFinais.length < 3 && i < pool.length; i++) {
      if (!indicesUsados.has(i)) {
      indicesUsados.add(i)
     indicesFinais.push(i)
      }
    }

    const perfumesFinais = indicesFinais.map((idx, i) => {
      
      const p = pool[idx]
      const notasMatch = fullText.match(new RegExp(`NOTAS_${i+1}:\\s*(.+?)(?=ACORDES_${i+1}:|$)`, 's'))
      const acordesMatch = fullText.match(new RegExp(`ACORDES_${i+1}:\\s*(.+?)(?=ESCOLHIDO_${i+2}:|NOTAS_${i+2}:|$)`, 's'))
      return {
        ...p,
        notas: notasMatch?.[1]?.trim() || p.notas,
        accords: acordesMatch?.[1]?.trim() || p.accords
      }
    }).filter(Boolean)
    return new Response(
      JSON.stringify({ sucesso: true, recomendacao, dados: perfumesFinais }),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    )

  } catch (error: any) {
    console.error("Erro geral:", error.message)
    return new Response(
      JSON.stringify({ sucesso: false, error: error.message }),
     { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } }
    )
  }
})