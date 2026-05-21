import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { extractFileKey, extractNodeId, groupFramesByPrefix, buildUserMessage, extractSpecContent, FigmaNode } from "@/lib/figma";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const BASE_RULES = `
[공통 절대 규칙]
1. 제공된 자료에 있는 내용만 작성합니다. 확인되지 않은 정책, 수치, 동작은 절대 임의로 작성하지 않습니다.
2. 디스크립션에 언급된 모든 입력 필드는 빠짐없이 포함합니다. 단순화나 요약을 위해 생략하지 않습니다.
   - 메인 항목에 종속된 조건 필드(최솟값, 최댓값, 할인 조건 세부값, 수량 제한 등)가 디스크립션에 있으면 반드시 별도 항목으로 작성합니다.
   - "기술 스펙" 또는 "개발 메모"로 판단되더라도 운영자가 직접 입력하는 필드라면 반드시 포함합니다.
3. 구체적 수치(개수 제한, 최솟값, 최댓값, 기간, 금액 등)는 화면별 설명과 스펙/정책 자료 **모두**에서 확인합니다.
   - 어느 한쪽에라도 구체적 수치가 명시되어 있으면 반드시 해당 수치를 포함합니다.
   - "제한이 있다", "조건이 있다"처럼 존재만 언급하는 표현은 금지입니다. 자료 어디에도 수치가 없을 때만 "검수 필요 항목"에 기록합니다.
4. 입력 자료에 대한 메타 설명을 추가하지 않습니다. ("파악하기 어렵습니다", "정보가 부족합니다" 등 금지)
5. 출력물은 반드시 운영 가이드 형식이어야 합니다. 요약 정리, 분류표, 설명문 형태로 작성하지 않습니다.`;

const GUIDE_STRUCTURE_ADMIN = `
## 출력 형식

각 기능은 아래 구조로 작성합니다. 확인된 작업 유형만 섹션으로 작성하고, 없는 작업은 섹션을 만들지 않습니다.

### 1. [대기능명]

> ➡️ 이 기능을 언제, 어떤 전제 조건에서 사용하는지 한두 문장으로 설명합니다.

📌 위치: 메뉴 > 하위메뉴

---

#### [대기능명] > [화면 섹션명]

[이미지: 해당 섹션이 어떤 화면인지 한 줄 설명]

① **항목명**
   - 이 항목의 역할 설명
   - 입력 가능한 값의 범위, 제한 조건
   - 예시 (정책 문서에 있는 경우)

② **항목명**
   - ...

> ⚠️ 이 섹션에서 특히 주의할 사항 — 이유 한 줄

---

### FAQ (운영 중 자주 묻는 질문)
❶ 질문
답변

❷ 질문
답변

---

### 검수 필요 항목
자료에서 확인되지 않아 본문에 작성하지 못한 내용을 이 표로 정리합니다.
| 항목 | 확인이 필요한 이유 | 확인 대상자 |
|---|---|---|

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
1. 제공된 자료에 명시된 내용만 작성합니다. 자료에 없는 항목은 그럴듯해 보여도 절대 추가하지 않습니다. 불확실한 항목은 본문에서 제외하고 반드시 "검수 필요 항목" 표에만 기록합니다.
2. 문장은 짧고 명확하게 씁니다. 전문 용어는 괄호 안에 풀어서 설명합니다.
3. 주의사항에는 이유를 한 줄 덧붙입니다.
4. 중복되는 내용은 제거합니다.
5. 번호는 문서 전체에서 연속됩니다. 섹션이 바뀌어도 번호를 리셋하지 않습니다.
6. 조회 전용 기능은 입력 항목, 체크리스트, 저장 후 결과, 주의사항 섹션을 모두 생략합니다.
7. 입력 항목을 표로 정리하지 않습니다. 각 항목을 ①②③ 번호로 나열하고, 값의 범위·제한 조건·정책 규칙·예시를 들여쓰기 항목(-)으로 기술합니다.
8. 특정 조건에서만 나타나는 항목(조건부 필수)은 조건을 명시합니다. 예: "[정액 할인] 선택 시 필수"
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

export const maxDuration = 120;

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

    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest"];

    // admin: 2단계 호출 — 1단계에서 필드 목록 추출 후 2단계에서 가이드 생성
    let finalUserMessage = userMessage;
    if (audience === "admin") {
      const extractionPrompt = `아래 디스크립션에서 운영자가 직접 입력하거나 선택하는 모든 필드명을 추출하세요.
조건부 하위 항목(최솟값, 최댓값, 할인 조건 세부값, 수량 제한 등)도 빠짐없이 포함합니다.
필드명만 쉼표로 구분하여 한 줄로 출력합니다. 설명이나 다른 텍스트는 추가하지 않습니다.

${userMessage}`;

      let fieldList = "";
      for (const modelName of models) {
        try {
          const extractModel = genAI.getGenerativeModel({ model: modelName });
          const extractResult = await extractModel.generateContent(extractionPrompt);
          fieldList = extractResult.response.text().trim();
          break;
        } catch (e: unknown) {
          const status = (e as { status?: number }).status;
          if (status === 503 || status === 429) continue;
          throw e;
        }
      }

      if (fieldList) {
        finalUserMessage = `${userMessage}\n\n[①②③ 항목으로 반드시 포함해야 할 필드 목록]\n${fieldList}\n위 필드들은 하나도 빠짐없이 ①②③ 번호 항목으로 독립 기재되어야 합니다.`;
      }
    }

    // 가이드 생성
    let guide = "";
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: systemPrompt,
        });
        const result = await model.generateContent(finalUserMessage);
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
