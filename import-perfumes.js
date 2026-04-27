import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import csv from 'csv-parser'
import dotenv from 'dotenv'
import { pipeline } from '@xenova/transformers'

dotenv.config()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

let embedder = null

async function getEmbedding(text) {
    if (!embedder) {
        console.log("⏳ Carregando modelo de embedding (só na primeira vez)...")
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')
        console.log("✅ Modelo carregado!")
    }

    const output = await embedder(text, { pooling: 'mean', normalize: true })
    return Array.from(output.data)
}

async function importarPerfumes() {
    const { count, error: countError } = await supabase
        .from('perfumes')
        .select('*', { count: 'exact', head: true })

    if (countError) {
        console.error("❌ Erro ao conectar com Supabase:", countError.message)
        return
    }

    let skip = count || 0
    console.log(`📊 Banco atual: ${skip} perfumes. Retomando a partir do próximo...`)

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

            for (let i = skip; i < perfumes.length; i++) {
                const p = perfumes[i]

                const content = [
                    `Perfume: ${p.Perfume || ''}`,
                    `Marca: ${p.Brand || ''}`,
                    `País: ${p.Country || ''}`,
                    `Gênero: ${p.Gender || ''}`,
                    `Notas de topo: ${p.Top || ''}`,
                    `Notas de coração: ${p.Middle || ''}`,
                    `Notas de base: ${p.Base || ''}`,
                    `Acordes: ${[p.mainaccord1, p.mainaccord2, p.mainaccord3].filter(Boolean).join(', ')}`,
                ].join(' | ')

                try {
                    const embedding = await getEmbedding(content)

                    const { error } = await supabase.from('perfumes').insert({
                        nome: p.Perfume,
                        marca: p.Brand,
                        notas: `${p.Top || ''} | ${p.Middle || ''} | ${p.Base || ''}`,
                        accords: [p.mainaccord1, p.mainaccord2, p.mainaccord3, p.mainaccord4, p.mainaccord5]
                            .filter(Boolean)
                            .join(', '),
                        genero: p.Gender,
                        embedding: embedding
                    })

                    if (error) {
                        console.error(`❌ Erro no Supabase no índice ${i} (${p.Perfume}): ${error.message}`)
                    } else {
                        if (i % 50 === 0) console.log(`✅ [${i}/${perfumes.length}] OK: ${p.Perfume}`)
                    }

                } catch (err) {
                    console.error(`💥 Falha no índice ${i} (${p.Perfume}):`, err.message)
                    await new Promise(r => setTimeout(r, 1000))
                }
            }
            console.log("\n🏁 Importação Finalizada!")
        })
}

importarPerfumes()