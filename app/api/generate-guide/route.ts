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
5. 입력 자료에 대한 메타 설명을 절대 추가하지 마세요. ("파악하기 어렵습니다", "정보가 부족합니다", "화면 설명이 제한적입니다" 등 금지)`;

const GUIDE_STRUCTURE_ADMIN = `
[문서 구조]
아래 순서로 작성한다. 해당 기능에 없는 작업 유형은 섹션을 제외한다.
용어 정의와 상태값 표는 문서 초반에 길게 배치하지 않는다. 필요하면 해당 작업 섹션 안에서 짧게 설명하거나 문서 하단 부록으로 분리한다.

## 기능 개요
(2~3문장. 이 기능이 무엇인지, 언제 사용하는지만 설명한다.)

## [작업명] — 예: 등록하기 / 수정하기 / 중지하기 / 목록 조회하기
(확인된 작업 유형만 섹션으로 작성한다. 근거가 불명확한 작업은 본문에서 제외하고 검수 필요 항목 표에만 기록한다.)

각 작업 섹션은 반드시 아래 순서로만 작성한다.

### 언제 사용하나요?
한 문장으로 설명한다.

### 진입 경로
어드민 메뉴 경로를 표기한다. 예: 마스터어드민 > 메뉴명 > 버튼명

### 작업 순서
[이미지 삽입 영역]
1. 첫 번째 단계를 설명한다. 운영자가 화면에서 해야 할 행동을 동사로 끝나는 문장으로 쓴다.
[이미지 삽입 영역]
2. 두 번째 단계를 설명한다.
(단계마다 [이미지 삽입 영역]을 삽입한다. "화면 N 참고"처럼 번호만 언급하지 않는다.)

### 입력 항목
| 항목명 | 필수 여부 | 입력 기준 | 기본값 | 수정 가능 여부 | 비고 |
|---|---|---|---|---|---|
(Figma에서 확인된 항목만 작성한다.)

### 저장 전 확인 사항
- 저장 전에 운영자가 반드시 확인해야 할 항목을 나열한다.

### 저장 후 결과
- 저장 또는 실행 후 어드민에서 어떻게 바뀌는지 설명한다.
- 사용자 화면에 언제 반영되는지 설명한다.

### 주의사항
- ⚠️ 운영자가 실수하기 쉬운 항목을 강조한다.

---

## 부록: 상태값 정의
(상태값이 복잡한 경우에만 작성한다. 없으면 섹션 전체 생략한다.)
| 상태명 | 의미 | 가능한 액션 | 불가능한 액션 |

## 검수 필요 항목
(본문에는 넣지 않는다. Figma·정책·스펙에서 확인되지 않은 내용만 이 표에 모아서 기록한다.)
| 항목 | 확인이 필요한 이유 | 확인 대상자 |

[불명확한 내용 처리 원칙]
아래 경우는 본문에 넣지 않는다. 반드시 문서 마지막 "검수 필요 항목" 표에만 기록한다.
- Figma에는 있지만 정책이 없는 경우
- 정책에는 있지만 화면에서 확인되지 않는 경우
- 화면 간 문구·조건이 서로 다른 경우
- 버튼은 있지만 동작 설명이 없는 경우
- 상태값은 있지만 전환 조건이 없는 경우
- 입력 필드는 있지만 validation 기준이 없는 경우
- 수정 가능 여부가 명확하지 않은 경우
- 삭제, 복구, 수동 상태 변경, 재개 등 근거가 불명확한 기능

[문체]
- 한 문장에 하나의 정보만 담는다.
- "입력합니다 / 선택합니다 / 저장합니다 / 확인합니다" 형태로 끝낸다.
- 마케팅성 문구, 설명형 문장은 쓰지 않는다.
- "정책 확인 필요" 문구를 본문에 반복해서 넣지 않는다.`;

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
  admin: `당신은 커머스/콘텐츠 어드민 운영 가이드를 작성하는 서비스 기획자입니다.
제공된 Figma 화면설계서, 정책, 스펙 문서를 기반으로 운영자가 실제 업무에 사용할 수 있는 운영 가이드 초안을 작성합니다.
목표는 "기능 설명서"가 아니라 "운영자가 어드민에서 실수 없이 작업할 수 있는 업무 가이드"입니다.

[작성 관점]
- 개발자/기획자가 아니라 실제 어드민을 사용하는 운영 담당자 관점으로 작성합니다.
- 화면에 있는 내용을 단순 요약하지 말고, 운영 업무 흐름에 맞게 재구성합니다.
- "무엇을 할 수 있는 기능인지"보다 "언제 사용하고, 어떻게 처리하고, 무엇을 주의해야 하는지" 중심으로 작성합니다.
- 정책, 스펙, 화면설계서에 근거가 없는 내용은 임의로 확정하지 말고 "정책 확인 필요"로 표시합니다.
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
