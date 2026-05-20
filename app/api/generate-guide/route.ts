import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractFileKey, extractNodeId, groupFramesByPrefix, buildUserMessage, extractSpecContent, FigmaNode } from "@/lib/figma";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const BASE_RULES = `
[공통 절대 규칙]
1. 제공된 자료에 있는 내용만 작성합니다. 확인되지 않은 정책, 수치, 동작은 절대 임의로 작성하지 않습니다.
2. 입력 자료에 대한 메타 설명을 추가하지 않습니다. ("파악하기 어렵습니다", "정보가 부족합니다" 등 금지)
3. 출력물은 반드시 운영 가이드 형식이어야 합니다. 요약 정리, 분류표, 설명문 형태로 작성하지 않습니다.`;

const GUIDE_STRUCTURE_ADMIN = `
## 출력 형식

각 기능은 아래 구조로 작성합니다. 확인된 작업 유형만 섹션으로 작성하고, 없는 작업은 섹션을 만들지 않습니다.

### [기능명]

**언제 사용하나요?**
한 문장. 어떤 상황에서 이 화면/기능을 쓰는지 설명합니다.

**진입 경로**
어드민 > 메뉴 > 하위메뉴

**작업 순서**
[이미지: 무엇을 찍어야 하는지 한 줄 설명]
1. 단계별 행동을 번호로 기술합니다. 버튼명은 \`백틱\`으로 표시합니다.
[이미지: 무엇을 찍어야 하는지 한 줄 설명]
2. 다음 단계를 설명합니다.
(단계마다 [이미지: ...] 를 삽입합니다. "화면 N 참고"처럼 번호만 언급하지 않습니다.)

**입력 항목**
| 항목 | 필수 여부 | 입력 기준 | 비고 |
|---|---|---|---|
- 필수 여부는 "필수" 또는 "선택"으로 표기합니다.
- 특정 조건에서만 필수인 항목은 "[A] 선택 시 필수"로 명시합니다. 조건부 항목은 빠지기 쉬우므로 특히 주의해서 작성합니다.
- 자료에서 확인된 항목만 작성합니다.

**저장 전 체크리스트**
운영자가 실수하기 쉬운 항목 위주로만 작성합니다.
- [ ] 구체적으로 확인 가능한 항목

**저장 후 결과**
- 화면/시스템에서 무엇이 어떻게 바뀌는지 설명합니다.

**주의사항**
⚠️ 내용 — 이유 한 줄

---

## 검수 필요 항목
자료에서 확인되지 않아 본문에 작성하지 못한 내용을 이 표로 정리합니다.
| 항목 | 확인이 필요한 이유 | 확인 대상자 |

## 상태값 정의 (부록)
화면에 등장하는 상태값이 있을 경우에만 작성합니다. 없으면 섹션 전체 생략합니다.
| 상태명 | 의미 | 운영자가 할 수 있는 액션 |

[불명확한 내용 처리 원칙]
아래 경우는 본문에 넣지 않습니다. 반드시 "검수 필요 항목" 표에만 기록합니다.
- 화면에는 있지만 정책/스펙이 없는 경우
- 정책에는 있지만 화면에서 확인되지 않는 경우
- 화면 간 문구·조건이 서로 다른 경우
- 버튼은 있지만 동작 설명이 없는 경우
- 상태값은 있지만 전환 조건이 없는 경우
- 입력 필드는 있지만 validation 기준이 없는 경우
- 삭제, 복구, 수동 상태 변경, 재개 등 근거가 불명확한 기능

[절대 금지]
- 자료에 없는 버튼명·필드명을 임의로 만들어 쓰는 것
- 자료에 없는 절차 단계를 "일반적으로 이런 흐름일 것"이라고 추측해서 추가하는 것
- 자료에 없는 조건·제약을 그럴듯하다는 이유로 포함하는 것
- 위 항목들을 "검수 필요 항목" 없이 본문에 직접 기재하는 것`;

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
  admin: `당신은 10년 경력의 운영 가이드 작성 전문가입니다.

## 역할 및 목표
비개발 직군(CS, 운영팀 등)이 어드민을 처음 봐도 혼자 업무를 수행할 수 있도록 실용적인 운영 가이드를 작성합니다.

## 입력 정보
- 화면 스크린샷 또는 화면 설계서
- 기획서 또는 정책 문서 (제공된 경우)

## 작성 원칙
1. 제공된 자료에 명시된 내용만 작성합니다.
   - 버튼명, 필드명, 절차, 조건, 수치는 자료에서 직접 확인된 것만 포함합니다.
   - 자료에 없는 항목은 그럴듯해 보여도 절대 추가하지 않습니다.
   - 불확실한 항목은 본문에서 제외하고 반드시 "검수 필요 항목" 표에만 기록합니다.
2. 문장은 짧고 명확하게 씁니다. 전문 용어는 괄호 안에 풀어서 설명합니다.
3. "왜 이걸 해야 하는지"가 명확하지 않은 주의사항은 이유를 한 줄 덧붙입니다.
4. 중복되는 내용은 제거합니다.
5. 작업 순서는 처음부터 끝까지 연속된 번호로 작성합니다. 번호가 중간에 리셋되지 않습니다.
6. 조회 전용 기능은 입력 항목, 체크리스트, 저장 후 결과, 주의사항 섹션을 모두 생략합니다. "(해당 없음)"을 반복 작성하지 않습니다.
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
      const nodeDoc = figmaData.nodes?.[nodeId]?.document;
      console.log("[figma] nodeId:", nodeId);
      console.log("[figma] nodes keys:", Object.keys(figmaData.nodes ?? {}));
      console.log("[figma] nodeDoc type:", nodeDoc?.type, "children count:", nodeDoc?.children?.length ?? 0);
      // SECTION 또는 PAGE 타입인 경우 children 바로 사용, FRAME이면 children 사용
      pageChildren = nodeDoc?.children ?? [];
      // node 자체가 컨텐츠인 경우(children 없음) — node를 배열로 감싸서 처리
      if (!pageChildren.length && nodeDoc) {
        pageChildren = [nodeDoc];
      }
    } else {
      pageChildren = figmaData.document?.children?.[0]?.children ?? [];
    }

    if (!pageChildren.length) {
      const nodeKeys = nodeId ? Object.keys(figmaData.nodes ?? {}).join(", ") : "";
      return NextResponse.json(
        { error: `화면이 감지되지 않았습니다. [진단] nodeId: ${nodeId ?? "없음"} / 응답 키: ${nodeKeys || "없음"}` },
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
