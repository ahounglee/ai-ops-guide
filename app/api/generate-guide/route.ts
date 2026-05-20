import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractFileKey, extractNodeId, groupFramesByPrefix, buildUserMessage, extractSpecContent, FigmaNode } from "@/lib/figma";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const BASE_RULES = `
[절대 규칙 — 반드시 지켜야 합니다]

1. 디스크립션은 가이드 작성의 소스입니다. 운영에 필요한 내용을 선별해서 사용하세요. 기능 구현용 기술 스펙, 개발 메모는 생략할 수 있습니다.
2. 디스크립션에 없는 내용은 추가하지 마세요. 실제로 존재하지 않는 기능을 임의로 만들어내지 마세요.
3. 섹션 구조는 가이드 맥락에 맞게 재구성할 수 있습니다. 같은 주제라면 합쳐도 되고, 설명 흐름상 순서를 바꿔도 됩니다.
4. 출력물은 반드시 운영 가이드 형식이어야 합니다. 요약 정리, 분류표, 설명문 형태로 작성하지 마세요.
5. 입력 자료에 대한 메타 설명을 절대 추가하지 마세요. ("파악하기 어렵습니다", "정보가 부족합니다", "화면 설명이 제한적입니다" 등 금지)

[변환 원칙 — 메모를 운영가이드로 변환하는 방법]

- 단편 메모 → 완성된 행동 지침: "배너 클릭 시 이동" → "배너를 클릭하면 연결된 랜딩 페이지로 이동합니다."
- 행동 주체를 항상 명시: "클릭 시" → "운영자가 클릭하면" / "사용자가 클릭하면"
- 필수 항목: "필수 입력 항목입니다." 로 명시. 미입력 시 동작도 함께 설명합니다.
- 조건부 노출/동작: "~을 선택한 경우에만 노출됩니다", "~상태인 경우에만 수정할 수 있습니다"
- 예시 제공: 수치·조건이 있으면 "예시) ~" 형태로 구체적인 예를 들어주세요.
- ⚠️ 주의사항: 중요한 제약·경고는 별도 줄에 "⚠️ ~" 형태로 강조하세요.
- 상태별 동작이 있으면 상태마다 가능한 작업과 불가한 작업을 명확히 구분하세요.
- 미노출 → "화면에 표시되지 않습니다", 랜딩 URL → "연결된 페이지 주소"
- 어드민 → "관리자 페이지(어드민)"
- 문장 끝: "~합니다", "~수 있습니다", "~됩니다"

[작성 형식]

## [화면명 또는 작업명]

개요 1~2문장

### [섹션/항목명]

항목 설명
- 필수 여부, 입력 조건, 범위
- 조건부 동작 ("~을 선택한 경우에만 ~합니다")
- 예시) ~
- ⚠️ 주의사항 (있는 경우)

**[동작]** 동작 설명
**[케이스]** 케이스 설명 (어떤 상황·주체인지 명시)
**[디자인/노출]** 디자인 규칙`;

const GUIDE_STRUCTURE_ADMIN = `
[가이드 구성 순서]

## 기능 개요
- 이 기능이 무엇인지, 어떤 종류·유형이 있는지 간결하게 정의합니다. (5줄 이내)
- 어드민 접근 경로를 명시합니다. (예: 위치: 마스터어드민 > Store > Coupon)
- [기능 정의 / 스펙 / 정책] 자료가 있으면 해당 내용을 기반으로 작성합니다.

## 운영 가이드
어드민에서 이 기능을 세팅하고 운영하는 방법을 작업 단위(~하기)로 나누어 설명합니다.
(예: 쿠폰 생성하기 / 쿠폰 수정하기 / 쿠폰 조회하기)

각 작업 섹션에서 반드시 포함할 내용:
- 단계별 수행 방법 (1. → 2. → 3. 순서로)
- 각 입력 항목: 항목명, 필수 여부, 입력 조건, 허용 범위
- 미입력 시 동작 (해당되는 경우)
- 조건부 노출: "~을 선택한 경우에만 노출됩니다"
- 상태별 가능/불가한 작업 (해당되는 경우)
- 예시) 구체적인 예시
- ⚠️ 유의사항: 잘못 설정했을 때 발생하는 문제, 놓치기 쉬운 주의점

## FAQ
운영 중 자주 발생하는 질문이 있으면 Q&A 형태로 작성합니다. 없으면 생략합니다.`;

const GUIDE_STRUCTURE_USER = `
[가이드 구성 순서]

## [기능명]이란?
- 이 기능이 무엇인지, 사용자에게 어떤 혜택·가치를 주는지 친근하게 설명합니다.
- 종류·유형이 있다면 각각 간략히 설명합니다.

## 이용 방법
사용자가 이 기능을 이용하는 방법을 단계별로 설명합니다.
- 획득·다운로드 방법 (해당되는 경우)
- 사용 방법
- 소멸·만료 조건 (해당되는 경우)
- 이용 제한 사항 (해당되는 경우)`;

const SYSTEM_PROMPTS: Record<string, string> = {
  admin: `당신은 운영팀·MD팀을 위한 어드민 운영 가이드 작성 전문가입니다.
어드민에서 기능을 직접 세팅하고 운영하는 담당자가 읽고 바로 실무에 활용할 수 있도록 작성합니다.
${GUIDE_STRUCTURE_ADMIN}
${BASE_RULES}`,

  user: `당신은 서비스 사용자를 위한 이용 가이드 작성 전문가입니다.
앱·서비스를 이용하는 일반 고객이 읽고 바로 이해할 수 있도록 작성합니다.
기술 용어, 어드민, 시스템 내부 동작은 언급하지 마세요.
사용자가 화면에서 직접 보고 할 수 있는 것만 설명하세요.
"~하실 수 있습니다", "~해보세요" 등 친근하고 안내하는 문체를 사용하세요.
[디자인/노출] 태그가 붙은 내용은 제외하세요.
${GUIDE_STRUCTURE_USER}
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

    const specContent = extractSpecContent(pageChildren);
    const userMessage = buildUserMessage(pairs, specContent || undefined);

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
