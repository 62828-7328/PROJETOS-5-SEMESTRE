import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0"
const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const supabase = createClient(supabaseUrl, supabaseServiceKey)
const genAI = new GoogleGenerativeAI(Deno.env.get("GEMINI_API_KEY")!)

serve(async (req) => {
  try {       
    const { userQuery } = await req.json()
    if (!userQuery) {
   return new Response(JSON.stringify({ error: "userQuery é obrigatório" }), { 
        status: 400,
        headers: { "Content-Type": "application/json" } 
      })}
    // Gerar embedding
    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" })
    const embeddingResult = await embeddingModel.embedContent(userQuery)
    const queryEmbedding = embeddingResult.embedding.values

    // Busca vetorial
    const { data: perfumes } = await supabase
      .from('perfumes')
      .select('nome, marca, notas_principais, familia_olfativa, preco_aprox_br, onde_comprar')
      .rpc('match_perfumes', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 6
   })
    if (!perfumes || perfumes.length === 0) {
      return new Response(
        JSON.stringify({ 
          recomendacao: "Ainda não tenho perfumes cadastrados no banco. Assim que eu importar o dataset, vou poder te recomendar perfumes reais!" 
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({ 
        recomendacao: "Encontrei alguns perfumes parecidos, mas ainda não tenho dados suficientes para dar uma recomendação completa.",
        perfumes_encontrados: perfumes.length 
      }),
    { headers: { "Content-Type": "application/json" } }
    )

  } catch (error) {
 console.error(error)
    return new Response(
     JSON.stringify({ error: "Erro interno na função" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
   )
 } })