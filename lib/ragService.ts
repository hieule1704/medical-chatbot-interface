/**
 * lib/ragService.ts — RAG Service v3 (Hybrid Retrieval)
 *
 * Thay đổi so với v2.1:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  HYBRID RETRIEVAL = Keyword Filter  +  Semantic Search          │
 * │                                                                 │
 * │  Bước 1: Nếu query chứa tên bệnh khớp metadata disease_name    │
 * │           → filter ChromaDB theo disease_name (exact match)    │
 * │           → chỉ semantic search trong tập con đó               │
 * │                                                                 │
 * │  Bước 2: Nếu không khớp tên bệnh cụ thể                        │
 * │           → semantic search toàn collection như cũ              │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Lý do: MiniLM không phân biệt tên bệnh cụ thể, chỉ thấy domain
 * "bệnh tai mũi họng" chung. Keyword filter giải quyết triệt để.
 *
 * Keyword trong báo cáo: "Two-stage Hybrid Retrieval"
 */

import { ChromaClient } from 'chromadb';

const client = new ChromaClient({ host: 'localhost', port: 8001 });
const COLLECTION_NAME = 'medical_ent'; // phải trùng với tên collection khi build RAG
const EMBEDDING_API   = 'http://localhost:8002/embed';

// Threshold khác nhau cho 2 mode:
// - Khi có filter tên bệnh (tập con nhỏ, precision cao): nới rộng hơn
// - Khi semantic search toàn bộ (risk noise cao): giữ chặt
const THRESHOLD_FILTERED  = 0.65;   // có disease_name filter
const THRESHOLD_FULL      = 0.45;   // semantic search toàn collection

// ─── Danh sách tên bệnh trong collection ──────────────────────────────────
// Dùng để match keyword trong query. Lấy từ rag_ent_knowledge.json.
// Nếu thêm bệnh mới vào data, thêm vào đây luôn.
const KNOWN_DISEASES: string[] = [
  'liệt dây thần kinh vii ngoại biên',
  'liệt dây thần kinh 7',
  'liệt mặt',
  'nghe kém ở trẻ em',
  'điếc đột ngột',
  'xốp xơ tai',
  'bệnh tai ngoài',
  'viêm tai giữa cấp tính trẻ em',
  'viêm tai giữa mạn tính',
  'viêm tai giữa mạn trẻ em',
  'viêm tai ứ dịch ở trẻ em',
  'viêm xương chũm cấp tính trẻ em',
  'bệnh ménière',
  'mê đay ménière',
  'vỡ xương đá',
  'ngạt mũi',
  'bệnh polyp mũi',
  'polyp mũi',
  'viêm mũi dị ứng',
  'viêm xoang cấp tính',
  'viêm xoang mạn tính',
  'papilloma mũi xoang',
  'papilloma',
  'ung thư vòm mũi họng',
  'ung thư thanh quản',
  'ung thư hạ họng',
  'viêm amidan cấp',
  'viêm họng cấp tính',
  'viêm phù nề thanh thiệt cấp tính',
  'viêm thanh quản cấp tính',
  'mềm sụn thanh quản',
  'lao thanh quản',
  'trào ngược dạ dày thực quản',
  'nang và rò túi mang iv',
  'rò xoang lê',
];

// Map alias → tên chuẩn trong disease_name của ChromaDB metadata
const DISEASE_ALIAS: Record<string, string> = {
  'liệt dây thần kinh 7'   : 'Liệt dây thần kinh VII ngoại biên',
  'liệt mặt'               : 'Liệt dây thần kinh VII ngoại biên',
  'liệt dây thần kinh vii' : 'Liệt dây thần kinh VII ngoại biên',
  'xốp xơ tai'             : 'Xốp xơ tai',
  'xop xo tai'             : 'Xốp xơ tai',
  'mê đay ménière'         : 'Bệnh ménière',
  'meniere'                : 'Bệnh ménière',
  'polyp mũi'              : 'Bệnh polyp mũi',
  'rò xoang lê'            : 'Nang và rò túi mang IV (rò xoang lê)',
  'papilloma'              : 'Papilloma (u nhú) mũi xoang',
};

export interface RAGChunk {
  content: string;
  disease_name: string;
  section: string;
  keywords: string;
  distance: number;
}

export interface RAGDebugInfo {
  originalQuery    : string;
  processedQuery   : string;
  retrievalMode    : 'hybrid_filtered' | 'semantic_full';
  detectedDisease  : string | null;
  threshold        : number;
  candidates       : Array<{
    disease_name : string;
    section      : string;
    distance     : number;
    passed       : boolean;
  }>;
  passedCount  : number;
  elapsedMs    : number;
}

export interface RAGResult {
  chunks     : RAGChunk[];
  hasContext : boolean;
  debug      : RAGDebugInfo;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tìm tên bệnh trong query.
 * Trả về { canonical, normalized } nếu khớp, null nếu không.
 */
function detectDisease(query: string): { canonical: string; normalized: string } | null {
  const nq = normalize(query);

  // Thử alias trước (exact match after normalize)
  for (const [alias, canonical] of Object.entries(DISEASE_ALIAS)) {
    if (nq.includes(normalize(alias))) {
      return { canonical, normalized: normalize(alias) };
    }
  }

  // Thử danh sách tên chuẩn
  // Sort by length descending để match tên dài trước (tránh match "viêm tai" khi muốn "viêm tai giữa")
  const sorted = [...KNOWN_DISEASES].sort((a, b) => b.length - a.length);
  for (const disease of sorted) {
    if (nq.includes(normalize(disease))) {
      // Tìm canonical từ alias map, hoặc dùng title-case từ KNOWN_DISEASES
      const canonical = Object.values(DISEASE_ALIAS).find(
        v => normalize(v) === normalize(disease)
      ) ?? toTitleCase(disease);
      return { canonical, normalized: normalize(disease) };
    }
  }

  return null;
}

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function preprocessQuery(raw: string): string {
  let q = raw;
  const fillers = [
    /bác sĩ ơi[,\s]*/gi,
    /thưa bác sĩ[,\s]*/gi,
    /cho tôi hỏi[,\s]*/gi,
    /bạn ơi[,\s]*/gi,
    /xin hỏi[,\s]*/gi,
    /bác sĩ hãy tư vấn[^,.?]*/gi,
    /hãy tư vấn giúp tôi[^,.?]*/gi,
  ];
  fillers.forEach(f => { q = q.replace(f, ''); });

  const personalInfo = [
    /tôi là (nam|nữ)[^\.,]*/gi,
    /năm nay \d+ tuổi/gi,
    /tôi \d+ tuổi/gi,
    /\d+ tuổi[,\s]*/gi,
  ];
  personalInfo.forEach(p => { q = q.replace(p, ''); });

  q = q.replace(/vừa được (chẩn đoán|xác định) là\s*/gi, '');
  q = q.replace(/^(tôi\s+)?(bị|đang bị|mắc)\s*/i, '');
  q = q.replace(/\s{2,}/g, ' ').trim().replace(/^[,.\s]+|[,.\s]+$/g, '');

  return q.length < 8 ? raw.trim() : q;
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(EMBEDDING_API, {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify({ texts: [text] }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}`);
  return (await res.json()).embeddings[0] as number[];
}

// ── Main Retrieval Function ────────────────────────────────────────────────

export async function retrieveContext(
  question : string,
  topK     = 5,
): Promise<RAGResult> {
  const t0             = Date.now();
  const processedQuery = preprocessQuery(question);
  const detectedDisease = detectDisease(question + ' ' + processedQuery);

  const makeEmpty = (): RAGResult => ({
    chunks     : [],
    hasContext : false,
    debug      : {
      originalQuery   : question,
      processedQuery,
      retrievalMode   : 'semantic_full',
      detectedDisease : detectedDisease?.canonical ?? null,
      threshold       : THRESHOLD_FULL,
      candidates      : [],
      passedCount     : 0,
      elapsedMs       : Date.now() - t0,
    },
  });

  try {
    const collection     = await client.getCollection({ name: COLLECTION_NAME });
    const queryEmbedding = await getEmbedding(processedQuery);

    let results: Awaited<ReturnType<typeof collection.query>>;
    let retrievalMode : RAGDebugInfo['retrievalMode'];
    let threshold     : number;

    if (detectedDisease) {
      // ── MODE 1: Hybrid — filter disease_name, rồi semantic search ────
      retrievalMode = 'hybrid_filtered';
      threshold     = THRESHOLD_FILTERED;

      results = await collection.query({
        queryEmbeddings : [queryEmbedding],
        nResults        : topK,
        include         : ['documents', 'metadatas', 'distances'] as any,
        where           : { disease_name: detectedDisease.canonical },
      });

      // Nếu filter quá chặt không có kết quả → fallback semantic_full
      const hitCount = results.documents?.[0]?.length ?? 0;
      if (hitCount === 0) {
        console.log(`[RAG] Filter "${detectedDisease.canonical}" → 0 hits, fallback to semantic_full`);
        retrievalMode = 'semantic_full';
        threshold     = THRESHOLD_FULL;
        results       = await collection.query({
          queryEmbeddings : [queryEmbedding],
          nResults        : topK,
          include         : ['documents', 'metadatas', 'distances'] as any,
        });
      }
    } else {
      // ── MODE 2: Semantic search toàn collection ───────────────────────
      retrievalMode = 'semantic_full';
      threshold     = THRESHOLD_FULL;

      results = await collection.query({
        queryEmbeddings : [queryEmbedding],
        nResults        : topK,
        include         : ['documents', 'metadatas', 'distances'] as any,
      });
    }

    const docs      = results.documents?.[0] ?? [];
    const metas     = results.metadatas?.[0] ?? [];
    const distances = results.distances?.[0] ?? [];

    const chunks       : RAGChunk[]                    = [];
    const candidateDbg : RAGDebugInfo['candidates']    = [];

    for (let i = 0; i < docs.length; i++) {
      const distance = distances[i] ?? 999;
      const meta     = (metas[i] ?? {}) as Record<string, string>;
      const passed   = distance < threshold;

      candidateDbg.push({
        disease_name : meta.disease_name ?? '',
        section      : meta.section      ?? '',
        distance,
        passed,
      });

      if (passed) {
        chunks.push({
          content      : docs[i]              ?? '',
          disease_name : meta.disease_name    ?? '',
          section      : meta.section         ?? '',
          keywords     : meta.keywords        ?? '',
          distance,
        });
      }
    }

    chunks.sort((a, b) => a.distance - b.distance);
    const elapsed = Date.now() - t0;

    console.log(
      `[RAG] mode=${retrievalMode} | disease="${detectedDisease?.canonical ?? '-'}" ` +
      `| ${chunks.length}/${docs.length} passed | ${elapsed}ms`
    );

    return {
      chunks,
      hasContext : chunks.length > 0,
      debug      : {
        originalQuery   : question,
        processedQuery,
        retrievalMode,
        detectedDisease : detectedDisease?.canonical ?? null,
        threshold,
        candidates      : candidateDbg,
        passedCount     : chunks.length,
        elapsedMs       : elapsed,
      },
    };
  } catch (err) {
    console.error('[RAG] retrieveContext error:', err);
    return makeEmpty();
  }
}

// ── System Prompt Builder ──────────────────────────────────────────────────

export function buildSystemPrompt(ragResult: RAGResult): string {
  const BASE =
    'Bạn là trợ lý y tế AI chuyên nghiệp về Tai Mũi Họng. ' +
    'Cung cấp thông tin sức khỏe chính xác bằng tiếng Việt. ' +
    'KHÔNG chẩn đoán thay bác sĩ. Luôn khuyến nghị thăm khám khi cần thiết.';

  if (!ragResult.hasContext) {
    return (
      BASE +
      '\n\nLưu ý: Câu hỏi này không nằm trong cơ sở dữ liệu nội bộ. ' +
      'Hãy trả lời dựa trên kiến thức chung của bạn và ghi rõ rằng ' +
      'thông tin không được trích từ hướng dẫn chuyên khoa nội bộ.'
    );
  }

  const contextBlock = ragResult.chunks
    .map(
      (c, i) =>
        `[Tài liệu ${i + 1}] ${c.disease_name} — ${c.section}\n${c.content}`
    )
    .join('\n\n---\n\n');

  return (
    'Bạn là bác sĩ tư vấn AI chuyên khoa Tai Mũi Họng. ' +
    'Dựa vào CÁC TÀI LIỆU Y KHOA nội bộ bên dưới (trích từ Hướng dẫn Bộ Y Tế), ' +
    'hãy trả lời câu hỏi chính xác, rõ ràng. ' +
    'Nếu không có trong tài liệu, nói rõ và khuyên thăm khám.\n\n' +
    '═══ TÀI LIỆU THAM KHẢO NỘI BỘ ═══\n\n' +
    contextBlock +
    '\n\n═══════════════════════════════'
  );
}