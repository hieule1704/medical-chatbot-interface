/**
 * lib/ragService.ts — RAG Service v3.1
 *
 * Thay đổi so với v3:
 * - Thêm export formatRAGContext() — dùng bởi chat/route.ts để inject
 *   tài liệu vào USER MESSAGE thay vì override system prompt
 * - buildSystemPrompt() giữ lại cho backward compat nhưng không dùng nữa
 * - Query embedding text vẫn dùng preprocessQuery, KHÔNG nhúng disease prefix
 *   (prefix chỉ dùng khi ingest để cải thiện vector quality)
 */

import { ChromaClient } from 'chromadb';

const client          = new ChromaClient({ host: 'localhost', port: 8001 });
const COLLECTION_NAME = 'medical_ent_final'; // Sửa lại sau mỗi lần test để không xóa nhầm collection đang dùng
const EMBEDDING_API   = 'http://localhost:8002/embed';

const THRESHOLD_FILTERED = 0.65; // Khoảng cách tối đa để coi là "liên quan" khi đã detect được bệnh cụ thể → giữ threshold cao để lấy nhiều chunk hơn, bù lại bằng filter disease_name để tránh lạc đề
const THRESHOLD_FULL     = 0.40; // ← chặt hơn cho semantic: chỉ lấy chunk THỰC SỰ liên quan, tránh lấy nhiều chunk lạc đề khi không detect được bệnh cụ thể nào

// ─── Disease Registry ─────────────────────────────────────────────────────────
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

// ─── Types ───────────────────────────────────────────────────────────────────
export interface RAGChunk {
  content     : string;
  disease_name: string;
  section     : string;
  keywords    : string;
  distance    : number;
}

export interface RAGDebugInfo {
  originalQuery   : string;
  processedQuery  : string;
  retrievalMode   : 'hybrid_filtered' | 'semantic_full';
  detectedDisease : string | null;
  threshold       : number;
  candidates      : Array<{ disease_name: string; section: string; distance: number; passed: boolean }>;
  passedCount     : number;
  elapsedMs       : number;
}

export interface RAGResult {
  chunks    : RAGChunk[];
  hasContext: boolean;
  debug     : RAGDebugInfo;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectDisease(query: string): { canonical: string; normalized: string } | null {
  const nq = normalize(query);

  for (const [alias, canonical] of Object.entries(DISEASE_ALIAS)) {
    if (nq.includes(normalize(alias))) {
      return { canonical, normalized: normalize(alias) };
    }
  }

  const sorted = [...KNOWN_DISEASES].sort((a, b) => b.length - a.length);
  for (const disease of sorted) {
    if (nq.includes(normalize(disease))) {
      const canonical =
        Object.values(DISEASE_ALIAS).find(v => normalize(v) === normalize(disease)) ??
        disease.replace(/\b\w/g, c => c.toUpperCase());
      return { canonical, normalized: normalize(disease) };
    }
  }
  return null;
}

function preprocessQuery(raw: string): string {
  let q = raw;
  [
    /bác sĩ ơi[,\s]*/gi,
    /thưa bác sĩ[,\s]*/gi,
    /cho tôi hỏi[,\s]*/gi,
    /bạn ơi[,\s]*/gi,
    /xin hỏi[,\s]*/gi,
    /bác sĩ hãy tư vấn[^,.?]*/gi,
    /hãy tư vấn giúp tôi[^,.?]*/gi,
  ].forEach(f => { q = q.replace(f, ''); });

  [
    /tôi là (nam|nữ)[^\.,]*/gi,
    /năm nay \d+ tuổi/gi,
    /tôi \d+ tuổi/gi,
    /\d+ tuổi[,\s]*/gi,
  ].forEach(p => { q = q.replace(p, ''); });

  q = q.replace(/vừa được (chẩn đoán|xác định) là\s*/gi, '');
  q = q.replace(/^(tôi\s+)?(bị|đang bị|mắc)\s*/i, '');
  q = q.replace(/\s{2,}/g, ' ').trim().replace(/^[,.\s]+|[,.\s]+$/g, '');

  return q.length < 8 ? raw.trim() : q;
}

async function getEmbedding(text: string): Promise<number[]> {
  const res = await fetch(EMBEDDING_API, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ texts: [text] }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}`);
  return (await res.json()).embeddings[0] as number[];
}

// ─── Main Retrieval ───────────────────────────────────────────────────────────
export async function retrieveContext(
  question: string,
  topK = 3, // Số lượng chunk tối đa trả về (sau khi lọc theo threshold) ← tối đa 3 chunks — đủ context, không overwhelm model
): Promise<RAGResult> {
  const t0             = Date.now();
  const processedQuery = preprocessQuery(question);
  const detectedDisease = detectDisease(question + ' ' + processedQuery);

  const makeEmpty = (): RAGResult => ({
    chunks    : [],
    hasContext: false,
    debug     : {
      originalQuery  : question,
      processedQuery,
      retrievalMode  : 'semantic_full',
      detectedDisease: detectedDisease?.canonical ?? null,
      threshold      : THRESHOLD_FULL,
      candidates     : [],
      passedCount    : 0,
      elapsedMs      : Date.now() - t0,
    },
  });

  try {
    const collection     = await client.getCollection({ name: COLLECTION_NAME });
    const queryEmbedding = await getEmbedding(processedQuery);

    let results   : Awaited<ReturnType<typeof collection.query>>;
    let mode      : RAGDebugInfo['retrievalMode'];
    let threshold : number;

    if (detectedDisease) {
      mode      = 'hybrid_filtered';
      threshold = THRESHOLD_FILTERED;

      results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults       : topK,
        include        : ['documents', 'metadatas', 'distances'] as any,
        where          : { disease_name: detectedDisease.canonical },
      });

      if ((results.documents?.[0]?.length ?? 0) === 0) {
        console.log(`[RAG] Filter "${detectedDisease.canonical}" → 0 hits, fallback`);
        mode      = 'semantic_full';
        threshold = THRESHOLD_FULL;
        results   = await collection.query({
          queryEmbeddings: [queryEmbedding],
          nResults       : topK,
          include        : ['documents', 'metadatas', 'distances'] as any,
        });
      }
    } else {
      mode      = 'semantic_full';
      threshold = THRESHOLD_FULL;
      results   = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults       : topK,
        include        : ['documents', 'metadatas', 'distances'] as any,
      });
    }

    const docs      = results.documents?.[0] ?? [];
    const metas     = results.metadatas?.[0]  ?? [];
    const distances = results.distances?.[0]  ?? [];

    const chunks  : RAGChunk[]                 = [];
    const dbgList : RAGDebugInfo['candidates'] = [];

    for (let i = 0; i < docs.length; i++) {
      const distance = distances[i] ?? 999;
      const meta     = (metas[i] ?? {}) as Record<string, string>;
      const passed   = distance < threshold;

      dbgList.push({ disease_name: meta.disease_name ?? '', section: meta.section ?? '', distance, passed });

      if (passed) {
        chunks.push({
          // ChromaDB document field lưu enriched text (prefix + content)
          // Lấy phần content thực sự bằng cách bỏ prefix "Bệnh: X - Y.\nNội dung: "
          content     : extractContent(docs[i] ?? ''),
          disease_name: meta.disease_name ?? '',
          section     : meta.section      ?? '',
          keywords    : meta.keywords     ?? '',
          distance,
        });
      }
    }

    chunks.sort((a, b) => a.distance - b.distance);

    console.log(
      `[RAG] mode=${mode} | disease="${detectedDisease?.canonical ?? '-'}" | ${chunks.length}/${docs.length} passed | ${Date.now() - t0}ms`
    );

    return {
      chunks,
      hasContext: chunks.length > 0,
      debug: {
        originalQuery  : question,
        processedQuery,
        retrievalMode  : mode,
        detectedDisease: detectedDisease?.canonical ?? null,
        threshold,
        candidates     : dbgList,
        passedCount    : chunks.length,
        elapsedMs      : Date.now() - t0,
      },
    };
  } catch (err) {
    console.error('[RAG] retrieveContext error:', err);
    return makeEmpty();
  }
}

/**
 * Strip enriched prefix từ document text được lưu trong ChromaDB.
 * Format khi ingest: "Bệnh: X - Y.\nNội dung: <actual content>"
 * Nếu không có prefix, trả về nguyên text.
 */
function extractContent(raw: string): string {
  const marker = '\nNội dung: ';
  const idx = raw.indexOf(marker);
  return idx !== -1 ? raw.slice(idx + marker.length) : raw;
}

/**
 * Format RAG chunks thành block text để inject vào user message.
 * Dùng bởi chat/route.ts — KHÔNG dùng làm system prompt.
 *
 * Viết rõ ràng để model hiểu đây là "tài liệu được cung cấp"
 * nhưng KHÔNG xung đột với system prompt của LM Studio.
 */
// export function formatRAGContext(ragResult: RAGResult): string { // Cách này có header rõ ràng nhưng LM Studio không hiểu là "tài liệu tham khảo", mà lại nghĩ đây là instruction → model bỏ qua hoặc chỉ dùng 1 đoạn đầu
//   if (!ragResult.hasContext) return '';

//   const contextBlock = ragResult.chunks
//     .map((c, i) =>
//       `[Tài liệu ${i + 1}] ${c.disease_name} — ${c.section}\n${c.content}` // Để nguyên content đã được enrich khi ingest, bao gồm cả phần keywords nếu có
//     )
//     .join('\n\n---\n\n');

//   return (
//     '【THÔNG TIN TỪ CƠ SỞ DỮ LIỆU Y KHOA NỘI BỘ】\n' +
//     'Dưới đây là các đoạn tài liệu y khoa liên quan được trích từ Hướng dẫn Bộ Y Tế. ' +
//     'Hãy ưu tiên sử dụng thông tin này khi trả lời:\n\n' +
//     contextBlock +
//     '\n\n【HẾT TÀI LIỆU NỘI BỘ】'
//   );
// }

export function formatRAGContext(ragResult: RAGResult): string {
  const chunks = ragResult.chunks;
 
  // Format ngắn gọn, không có instruction, không có header đặc biệt
  const contextLines = chunks.map(c =>
    `[${c.disease_name} / ${c.section}]\n${c.content}`
  ).join('\n\n');
 
  // Instruction nhúng trực tiếp vào câu hỏi, không phải header riêng
  return `Dưới đây là thông tin y khoa tham khảo:
 
${contextLines}
 
Dựa trên thông tin trên, hãy trả lời câu hỏi sau của bệnh nhân (chỉ trả lời một lần, không lặp lại):`;
}

/**
 * @deprecated Không dùng nữa — system prompt do LM Studio quản lý.
 * Giữ lại để không break nếu có file import cũ.
 */
export function buildSystemPrompt(ragResult: RAGResult): string {
  return formatRAGContext(ragResult);
}