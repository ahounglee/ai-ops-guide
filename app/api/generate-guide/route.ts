import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractFileKey, extractNodeId, groupFramesByPrefix, buildUserMessage, FigmaNode } from "@/lib/figma";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const BASE_RULES = `
[절대 규칙 — 반드시 지켜야 합니다]

1. 디스크립션에 있는 내용만 사용합니다. 단 한 줄도 빠뜨리지 마세요.
2. 디스크립션에 없는 내용은 단 한 줄도 추가하지 마세요. "좋아요", "댓글", "공유" 등 디스크립션에 언급되지 않은 기능을 절대 추가하지 마세요.
3. 디스크립션의 섹션 구조를 그대로 유지하세요. 예를 들어 "1. 메인 배너 구좌", "아티스트 구좌", "상품 구좌", "자동 로직 구좌"처럼 별도 섹션으로 나뉜 경우, 각각을 독립적인 ### 소제목으로 분리하여 작성하세요. 절대 합치지 마세요.

[작성 형식]

## [화면명]

화면 전체에 대한 개요를 1~2문장으로 작성합니다.

### [섹션명]

섹션 설명

**노출 조건** (있는 경우)
- 조건1
- 조건2

**[동작]** 동작 설명
**[케이스]** 케이스 설명 (반드시 어떤 상황·어떤 요소인지 주어 명시)
**[디자인/노출]** 디자인 규칙

[문체]
- 단편 메모 → 완성 문장: "배너 클릭 시, 이동" → "배너를 클릭하면 이동합니다."
- 미노출 → "표시되지 않습니다", 랜딩 URL → "연결된 페이지 주소"
- 어드민 → "관리자 페이지(어드민)"
- 문장 끝: "~합니다", "~수 있습니다", "~됩니다"
- **[케이스]** 작성 시 주어 명확히: "비회원이 마이페이지 아이콘을 클릭하면 로그인 화면으로 이동합니다."`;

const SYSTEM_PROMPTS: Record<string, string> = {
  ops: `당신은 서비스 운영팀을 위한 운영 매뉴얼 작성 전문가입니다.
IT 비전문가인 운영 담당자가 읽고 바로 업무에 활용할 수 있도록 작성합니다.
어드민 설정 방법, 시스템 동작 원리, 에러 케이스 처리 방법을 중심으로 서술하세요.
운영자가 실무에서 직접 조작하거나 확인해야 하는 내용을 명확하게 전달하세요.
${BASE_RULES}`,

  md: `당신은 MD팀(상품기획·콘텐츠 관리 담당자)을 위한 운영 가이드 작성 전문가입니다.
상품·배너·카테고리 등록 및 관리, 노출 조건 설정, 콘텐츠 운영 방법을 중심으로 서술하세요.
기술적 시스템 설명보다는 "어떻게 등록하고 관리하는가"에 초점을 맞추세요.
MD 담당자가 어드민에서 직접 수행해야 하는 작업 흐름이 명확히 드러나도록 작성하세요.
${BASE_RULES}`,

  user: `당신은 서비스 사용자를 위한 이용 가이드 작성 전문가입니다.
서비스를 처음 사용하는 일반 고객이 읽고 바로 이해할 수 있도록 작성합니다.
기술 용어, 어드민, 시스템 내부 동작은 언급하지 마세요.
사용자가 화면에서 볼 수 있는 요소와 직접 할 수 있는 행동만 설명하세요.
"~하실 수 있습니다", "~을 눌러보세요" 등 친근하고 안내하는 문체를 사용하세요.
[디자인/노출] 태그가 붙은 내용은 사용자 가이드에 불필요하므로 제외하세요.
${BASE_RULES}`,
};

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { figmaUrl, audience = "ops" } = await req.json();

    if (!figmaUrl) {
      return NextResponse.json({ error: "Figma URL을 입력해주세요." }, { status: 400 });
    }

    const systemPrompt = SYSTEM_PROMPTS[audience] ?? SYSTEM_PROMPTS.ops;

    const fileKey = extractFileKey(figmaUrl);
    if (!fileKey) {
      return NextResponse.json(
        { error: "올바른 Figma URL을 입력해주세요. (figma.com/design/... 형식)" },
        { status: 400 }
      );
    }

    // Figma API 호출 — node-id가 있으면 /nodes, 없으면 /files
    const nodeId = extractNodeId(figmaUrl);
    const figmaApiUrl = nodeId
      ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`
      : `https://api.figma.com/v1/files/${fileKey}`;

    const figmaRes = await fetch(figmaApiUrl, {
      headers: { "X-Figma-Token": process.env.FIGMA_ACCESS_TOKEN! },
    });

    if (figmaRes.status === 401 || figmaRes.status === 403) {
      return NextResponse.json(
        { error: "Figma 인증에 실패했습니다. 서버 환경변수(FIGMA_ACCESS_TOKEN)를 확인해주세요." },
        { status: 500 }
      );
    }

    if (!figmaRes.ok) {
      return NextResponse.json(
        { error: "Figma 파일을 찾을 수 없습니다. URL과 권한을 확인해주세요." },
        { status: 500 }
      );
    }

    const figmaData = await figmaRes.json();

    let pageChildren: FigmaNode[];
    if (nodeId) {
      const nodeIdColon = nodeId;
      const nodeDoc = figmaData.nodes?.[nodeIdColon]?.document;
      pageChildren = nodeDoc?.children ?? [];
    } else {
      pageChildren = figmaData.document?.children?.[0]?.children ?? [];
    }

    if (!pageChildren.length) {
      return NextResponse.json(
        { error: "화면이 감지되지 않았습니다. URL의 node-id가 올바른지 확인해주세요." },
        { status: 400 }
      );
    }

    const pairs = groupFramesByPrefix(pageChildren);

    if (pairs.length === 0) {
      return NextResponse.json(
        { error: "'화면디스크립션'이 포함된 프레임을 찾지 못했습니다. Figma 파일의 프레임 이름을 확인해주세요." },
        { status: 400 }
      );
    }

    const userMessage = buildUserMessage(pairs);

    // Gemini API 호출 — 503 시 fallback 모델로 재시도
    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];
    let guide = "";
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
        });
        const result = await model.generateContent(userMessage);
        guide = result.response.text();
        break;
      } catch (e: unknown) {
        const status = (e as { status?: number }).status;
        if (status === 503 || status === 429) continue;
        throw e;
      }
    }
    if (!guide) throw new Error("모든 모델 호출 실패");

    return NextResponse.json({ guide, screenCount: pairs.length });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "가이드 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }
}
