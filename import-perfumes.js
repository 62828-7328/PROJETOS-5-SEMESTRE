import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import csv from 'csv-parser'
import dotenv from 'dotenv'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function atualizarPaises() {

  const perfumes = []
  fs.createReadStream('fra_cleaned.csv')
    .pipe(csv({ separator: ';' }))
    .on('data', (row) => {
    const cleaned = {}
    for (const key of Object.keys(row)) {

      cleaned[key.trim()] = typeof row[key] === 'string' ? row[key].trim() : row[key]
      }
      perfumes.push(cleaned)
    })
    .on('end', async () => {
      console.log(`📦 CSV carregado: ${perfumes.length} perfumes totais.`)

      let atualizados = 0
      let erros = 0

      for (let i = 0; i < perfumes.length; i++) {

        const p = perfumes[i]
        const { error } = await supabase
          .from('perfumes')
        .update({ pais: p.Country || '' })
          .eq('nome', p.Perfume)
         .eq('marca', p.Brand)
        if (error) {
          erros++
        } else {
         atualizados++
        if (i % 500 === 0) console.log(`✅ [${i}/${perfumes.length}] ${p.Perfume}`)
        }
      }

    console.log(`\n🏁 Concluído! ${atualizados} atualizados, ${erros} erros.`)
    }) }
atualizarPaises()