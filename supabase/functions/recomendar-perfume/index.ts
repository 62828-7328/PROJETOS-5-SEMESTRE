import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Permite que o site acesse a função (CORS)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Responde requisições de preflight do navegador
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Pega a pergunta do usuário enviada pelo frontend
    const { userQuery } = await req.json()

    // Carrega as variáveis de ambiente (chaves de API)
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!
    const hfToken = Deno.env.get("HUGGINGFACE_TOKEN")!
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // ETAPA 1: Transforma a pergunta do usuário em um vetor numérico (embedding)
    // Usamos o modelo all-MiniLM-L6-v2 via HuggingFace — gera vetores de 384 dimensões
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

    // HuggingFace pode retornar [[...]] ou [...] dependendo da versão — normalizamos aqui
    let queryVector = embData
    if (Array.isArray(embData) && Array.isArray(embData[0])) {
      queryVector = embData[0]
    }

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      throw new Error("Não foi possível gerar o vetor para a sua busca.")
    }

    // ETAPA 2: Busca semântica no banco de dados
    // A função match_perfumes compara o vetor da busca com os vetores dos perfumes
    // e retorna os 5 mais similares com similaridade acima de 0.1
    const { data: perfumes, error: rpcError } = await supabase.rpc('match_perfumes', {
      query_embedding: queryVector,
      match_threshold: 0.1,
      match_count: 5
    })

    if (rpcError) throw new Error(`Erro na busca do banco: ${rpcError.message}`)

    // Formata a lista de perfumes para enviar ao Gemini
    const listaPerfumes = perfumes.map((p: any, i: number) => 
      `${i+1}. ${p.nome} (${p.marca}) - Notas: ${p.notas} - Acordes: ${p.accords}`
    ).join('\n')

    // ETAPA 3: Gera uma recomendação elegante usando o Gemini como sommelier
    const prompt = `Você é um sommelier de perfumes. O cliente pediu: "${userQuery}"

Perfumes encontrados:
${listaPerfumes}

Recomende em 2 frases curtas e elegantes em português, mencionando os nomes dos perfumes.`

    const chatResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.8,   // Criatividade da resposta (0 = conservador, 1 = criativo)
            maxOutputTokens: 3000,
          }
        })
      }
    )

    const chatData = await chatResponse.json()
    console.log("Gemini response:", JSON.stringify(chatData).slice(0, 300))

    // Pega o texto da resposta ou usa um fallback genérico
    const recomendacao = chatData.candidates?.[0]?.content?.parts?.[0]?.text 
      || "Encontrei ótimas opções para você!"

    // Retorna a recomendação e os dados dos perfumes para o frontend
    return new Response(
      JSON.stringify({ sucesso: true, recomendacao, dados: perfumes }),
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