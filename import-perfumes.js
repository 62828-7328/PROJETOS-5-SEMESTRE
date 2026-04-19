import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs'
import csv from 'csv-parser'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const geminiApiKey = process.env.GEMINI_API_KEY

if (!supabaseUrl || !supabaseServiceKey || !geminiApiKey) {
  console.error("❌ Erro: Verifique se o arquivo .env está correto com as chaves")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const genAI = new GoogleGenerativeAI(geminiApiKey)

async function importarPerfumes() {
  console.log('🚀 Iniciando importação do fra_cleaned.csv...')

  const perfumes = []

  fs.createReadStream('fra_cleaned.csv')
    .pipe(csv())
    .on('data', (row) => {
      const content = [
        row.name,
        row.brand,
        row.notes,
        row.accords,
        row.description || ''
      ].filter(Boolean).join(' ').trim()

      if (content.length > 20) {
        perfumes.push({
          nome: row.name || 'Sem nome',
          marca: row.brand || 'Desconhecida',
          notas_principais: row.notes || null,
          accords: row.accords || null,
          familia_olfativa: row.main_accords || null,
          genero: row.gender || 'unissex',
          content: content,
          preco_aprox_br: null,
          onde_comprar: null,
          popular_no_brasil: false
        })
      }
    })
    .on('end', async () => {
      console.log(`✅ CSV lido com ${perfumes.length} perfumes.`)

      // Importar apenas os primeiros 400 para teste (para não demorar muito)
      const lote = perfumes.slice(0, 400)

      console.log(`Importando ${lote.length} perfumes...`)

      for (let i = 0; i < lote.length; i++) {
        const p = lote[i]

        try {
          const model = genAI.getGenerativeModel({ model: "embedding-001" })
          const result = await model.embedContent(p.content)
          const embedding = result.embedding.values

          const { error } = await supabase
            .from('perfumes')
            .insert({
              nome: p.nome,
              marca: p.marca,
              notas_principais: p.notas_principais,
              accords: p.accords,
              familia_olfativa: p.familia_olfativa,
              genero: p.genero,
              content: p.content,
              embedding: embedding
            })

          if (error) {
            console.error(`❌ Erro ${i+1}: ${p.nome} - ${error.message}`)
          } else {
            console.log(`✅ ${i+1}/${lote.length} - ${p.nome} (${p.marca})`)
          }

          // Pequeno delay para não exceder limite do Gemini
          await new Promise(r => setTimeout(r, 300))

        } catch (err) {
          console.error(`Falha no perfume ${p.nome}:`, err.message)
        }
      }

      console.log('\n🎉 Importação concluída!')
      console.log('Agora você pode testar sua Edge Function.')
    })
}

importarPerfumes()