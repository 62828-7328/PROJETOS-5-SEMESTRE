import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { userQuery, queryOriginal, genero, categoria } = await req.json()
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!
    const hfToken = Deno.env.get("HUGGINGFACE_TOKEN")!
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

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

    const queryParaVerificar = (queryOriginal || userQuery).toLowerCase()
    const ehPedidoPerfume = palavrasChave.some(p => queryParaVerificar.includes(p))

    if (!ehPedidoPerfume) {
      const conversaResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `Você é o Olfatto, um assistente especialista em perfumes. O usuário disse: "${queryOriginal || userQuery}". Responda de forma breve, elegante e em português brasileiro. Se for uma saudação ou agradecimento, responda de forma simpática e pergunte se pode ajudar com alguma fragrância.` }] }],
            generationConfig: { maxOutputTokens: 200, temperature: 0.8 }
          })
        }
      )
      const conversaData = await conversaResponse.json()
      const resposta = conversaData.candidates?.[0]?.content?.parts?.[0]?.text || 'Posso ajudar com alguma fragrância?'

      return new Response(
        JSON.stringify({ sucesso: true, recomendacao: resposta, dados: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' } }
      )
    }

    const embResponse = await fetch(
      "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2/pipeline/feature-extraction",
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hfToken}`
        },
        body: JSON.stringify({ inputs: userQuery })
      }
    )

    const embData = await embResponse.json()

    let queryVector = embData
    if (Array.isArray(embData) && Array.isArray(embData[0])) {
      queryVector = embData[0]
    }

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new Error("Não foi possível gerar o vetor para a sua busca.")
    }

    const filtroGenero = genero === 'masculino' ? 'men'
      : genero === 'feminino' ? 'women'
      : genero === 'compartilhável' ? 'unisex'
      : ''

    const filtroCategoria = categoria === 'árabe' ? 'arabe'
      : categoria === 'nacional' ? 'nacional'
      : categoria === 'designer' ? 'designer'
      : categoria === 'nicho' ? 'nicho'
      : ''

    // Busca 15 perfumes e seleciona 3 aleatórios entre os melhores
    const { data: perfumes, error: rpcError } = await supabase.rpc('match_perfumes', {
      query_embedding: queryVector,
      match_threshold: 0.45,
      match_count: 15,
      filtro_genero: filtroGenero,
      filtro_categoria: filtroCategoria
    })

    if (rpcError) throw new Error(`Erro na busca do banco: ${rpcError.message}`)

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

    // Embaralha e pega 3
    const embaralhados = pool.sort(() => Math.random() - 0.5)
    const perfumesFinais = embaralhados.slice(0, 3)

    const listaPerfumes = perfumesFinais.map((p: any, i: number) =>
      `${i+1}. ${p.nome} (${p.marca}) | Notas: ${p.notas} | Acordes: ${p.accords}`
    ).join('\n')

    const prompt = `Você é um sommelier de perfumes brasileiro. O cliente pediu: "${queryOriginal || userQuery}"

Perfumes encontrados:
${listaPerfumes}

Responda OBRIGATORIAMENTE em português brasileiro seguindo EXATAMENTE este formato sem nenhum texto extra:

RECOMENDACAO: [2 frases elegantes recomendando os perfumes mencionando os nomes]
NOTAS_1: [notas do perfume 1 traduzidas para português, separadas por |]
ACORDES_1: [acordes do perfume 1 traduzidos para português, separados por ,]
NOTAS_2: [notas do perfume 2 traduzidas para português, separadas por |]
ACORDES_2: [acordes do perfume 2 traduzidos para português, separados por ,]
NOTAS_3: [notas do perfume 3 traduzidas para português, separadas por |]
ACORDES_3: [acordes do perfume 3 traduzidos para português, separados por ,]`

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

    const recomendacaoMatch = fullText.match(/RECOMENDACAO:\s*(.+?)(?=NOTAS_1:|$)/s)
    const recomendacao = recomendacaoMatch?.[1]?.trim() || "Encontrei ótimas opções para você!"

    const perfumesComTraducao = perfumesFinais.map((p: any, i: number) => {
      const notasMatch = fullText.match(new RegExp(`NOTAS_${i+1}:\\s*(.+?)(?=ACORDES_${i+1}:|$)`, 's'))
      const acordesMatch = fullText.match(new RegExp(`ACORDES_${i+1}:\\s*(.+?)(?=NOTAS_${i+2}:|ACORDES_${i+2}:|$)`, 's'))
      return {
        ...p,
        notas: notasMatch?.[1]?.trim() || p.notas,
        accords: acordesMatch?.[1]?.trim() || p.accords
      }
    })

    return new Response(
      JSON.stringify({ sucesso: true, recomendacao, dados: perfumesComTraducao }),
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