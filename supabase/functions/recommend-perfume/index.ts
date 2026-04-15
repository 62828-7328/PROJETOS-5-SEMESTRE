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

    if (!userQuery || userQuery.trim() === "") {
      return new Response(
        JSON.stringify({ error: "A descrição não pode estar vazia" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Gerar embedding da query do usuário
    const embeddingModel = genAI.getGenerativeModel({ model: "embedding-001" })
    const embeddingResult = await embeddingModel.embedContent(userQuery)
    const queryEmbedding = embeddingResult.embedding.values

    // Buscar perfumes mais parecidos
    const { data: perfumes, error } = await supabase
      .from('perfumes')
      .select('id, nome, marca, notas_principais, accords, familia_olfativa, genero, preco_aprox_br, onde_comprar')
      .rpc('match_perfumes', {
        query_embedding: queryEmbedding,
        match_threshold: 0.75,
        match_count: 8
      })

    if (error) throw error

    if (!perfumes || perfumes.length === 0) {
      return new Response(
        JSON.stringify({ 
          recomendacao: "Não encontrei perfumes que combinam bem com sua descrição no momento. Tente descrever melhor (ex: perfume fresco para calor, doce gourmand, amadeirado masculino, árabe barato...)." 
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    // Gerar recomendação final com Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })

    const prompt = `
Você é um especialista em perfumes brasileiro, descontraído e sincero.

Usuário pediu: "${userQuery}"

Perfumes encontrados mais parecidos:

${perfumes.map((p: any, i: number) => 
  `${i+1}. ${p.nome} (${p.marca}) — ${p.notas_principais || ''} — ${p.familia_olfativa || ''} — Preço aprox: ${p.preco_aprox_br || '—'}`
).join('\n')}

Recomende de 2 a 4 perfumes dessa lista.
Explique de forma natural por que cada um combina.
Fale em português brasileiro, tom amigável.
Não invente nada que não esteja na lista.
`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    return new Response(
      JSON.stringify({ 
        recomendacao: responseText,
        encontrados: perfumes.length
      }),
      { headers: { "Content-Type": "application/json" } }
    )

  } catch (error: any) {
    console.error(error)
    return new Response(
      JSON.stringify({ error: "Erro ao processar a recomendação. Tente novamente." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
})