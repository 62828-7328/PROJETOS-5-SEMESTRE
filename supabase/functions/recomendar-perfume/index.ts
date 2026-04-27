import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { userQuery } = await req.json()
    const geminiKey = Deno.env.get("GEMINI_API_KEY")!
    const hfToken = Deno.env.get("HUGGINGFACE_TOKEN")!
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. GERA O EMBEDDING VIA HUGGINGFACE
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
    console.log("HuggingFace status:", embResponse.status)

    let queryVector = embData
    if (Array.isArray(embData) && Array.isArray(embData[0])) {
      queryVector = embData[0]
    }

    if (!Array.isArray(queryVector) || queryVector.length === 0) {
      console.error("Vetor inválido:", JSON.stringify(embData).slice(0, 200))
      throw new Error("Não foi possível gerar o vetor para a sua busca.")
    }

    console.log("Vetor gerado, dimensões:", queryVector.length)

    // 2. BUSCA SEMÂNTICA NO BANCO DE DADOS
    const { data: perfumes, error: rpcError } = await supabase.rpc('match_perfumes', {
      query_embedding: queryVector,
      match_threshold: 0.1,
      match_count: 5
    })

    if (rpcError) {
      console.error("Erro RPC:", rpcError)
      throw new Error(`Erro na busca do banco: ${rpcError.message}`)
    }

    console.log("Perfumes encontrados:", perfumes?.length)

    // 3. RESPOSTA DO SOMMELIER
    const chatResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ 
            parts: [{ 
              text: `Você é um sommelier de perfumes especialista. 
              Com base nos perfumes encontrados no banco: ${JSON.stringify(perfumes)}, 
              responda de forma elegante e técnica à pergunta do cliente: "${userQuery}". 
              Se não houver dados, dê uma dica geral de perfumaria.` 
            }] 
          }]
        })
      }
    )

    const chatData = await chatResponse.json()
    const recomendacao = chatData.candidates?.[0]?.content?.parts?.[0]?.text || "Aqui estão algumas opções para você."

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