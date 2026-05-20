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
[문서 기본 구조]
아래 순서로 작성하되, 해당 기능에 없는 섹션은 제외하고 "해당 기능 없음"으로 명시한다.

## 기능 개요
## 운영 전 확인 사항
## 주요 용어 정의
## 상태값 정의
## 권한 및 접근 경로
## 작업 유형별 운영 방법
  ### 등록/생성
  ### 수정
  ### 삭제
  ### 중지/비노출
  ### 재개/노출
  ### 목록 조회
  ### 상세 조회
## 입력 항목 정의
## 상태별 가능/불가 액션
## 노출/반영 기준
## 사용자 화면 또는 서비스 영향
## 예외 케이스 및 대응 방법
## 운영 시 주의사항
## FAQ
## 정책 확인 필요 항목

[각 작업 유형 작성 형식]
각 작업 유형은 아래 항목을 포함해 작성한다.
- 사용 목적
- 접근 경로
- 처리 절차 (1. → 2. → 3. 순서)
- 입력/선택 항목
- 저장/실행 후 결과
- 서비스 반영 기준
- 수정 가능 여부
- 주의사항
- 관련 예외 케이스

[표 형식 필수 항목]
아래 내용은 반드시 표(markdown table)로 정리한다.
- 입력 항목: 항목명 / 필수 여부 / 입력 기준 / 기본값 / 수정 가능 여부 / 비고
- 상태값: 상태명 / 의미 / 진입 조건 / 가능한 액션 / 불가능한 액션
- 작업 유형: 작업명 / 처리 결과 / 서비스 영향
- 예외 케이스: 케이스 / 발생 조건 / 영향 범위 / 운영 대응 방법
- 정책 확인 필요 항목: 항목 / 확인이 필요한 이유 / 확인 대상자 예시

[Figma 분석 시 반드시 추출할 항목]
화면명, 접근 경로, 버튼명, 입력 필드명, 필수/선택 여부, 기본값, placeholder,
validation 조건, 에러 메시지, 안내 문구, 툴팁, 상태값, 노출 조건, 비노출 조건,
활성화/비활성화 조건, 저장 후 동작, 수정 시 제한 사항, 삭제/중지/비노출 시 영향,
사용자 화면 반영 여부, 목록/상세 화면 표시 항목, 검색/필터 조건,
CSV 업로드/다운로드 기준, 이미지 업로드 기준, 정렬 기준, 예약/기간 설정 기준, 권한별 접근 가능 여부

[운영자가 헷갈리기 쉬운 항목 — 별도 강조 필수]
- 생성 후 수정 가능한 항목과 불가능한 항목
- 즉시 반영되는 항목과 예약/조건에 따라 반영되는 항목
- 어드민에 저장되지만 사용자 화면에 노출되지 않는 조건
- 삭제와 비노출/중지의 차이
- 기간 시작 전/진행 중/종료 후 상태 차이
- 기존 사용자 또는 기존 데이터에 소급 적용 여부
- 저장 실패/업로드 실패/검수 실패 시 운영자가 해야 할 일
- 운영자가 실수했을 때 되돌릴 수 있는지 여부

[기능 유형별 추가 확인 항목]
상품 등록: 상품명/판매가/옵션가/재고/판매 상태/배송 정책/이미지 기준, 판매 시작·종료일, 옵션 조합 생성 기준, 품절 처리 기준, 판매 종료·삭제 시 사용자 화면 영향, 주문 발생 후 수정 제한 항목
배너 등록: 이미지 규격, PC/MO 분리 여부, 랜딩 URL, 노출 위치/기간/우선순위, 활성·비활성 상태, 예약 노출 기준, 종료 후 처리 방식
전시 화면 관리: 전시 영역명, 콘텐츠/상품 연결 방식, 정렬 방식, 노출 조건/기간, 미리보기 가능 여부, 저장 후 반영 시점, 기존 전시 데이터 영향
쿠폰/프로모션: 혜택 유형, 할인 방식, 발급 조건/수량, 사용 조건/적용 대상/유효 기간, 중지·종료 시 기존 발급 건 영향, 주문 취소·환불 시 쿠폰 복구 여부

[불명확한 내용 처리]
아래 경우는 임의로 확정하지 말고 본문에 "정책 확인 필요"로 표시하고, 문서 마지막 표에 별도 정리한다.
- Figma에는 있지만 정책이 없는 경우
- 정책에는 있지만 화면에서 확인되지 않는 경우
- 화면 간 문구·조건이 서로 다른 경우
- 버튼은 있지만 동작 설명이 없는 경우
- 상태값은 있지만 전환 조건이 없는 경우
- 입력 필드는 있지만 validation 기준이 없는 경우
- 수정 가능 여부가 명확하지 않은 경우
- 기존 데이터에 소급 적용 여부가 불명확한 경우

[문체]
- 짧고 명확하게 작성한다.
- 운영자가 바로 이해할 수 있는 표현을 사용한다.
- 마케팅성 문구는 제거한다.
- 확정된 정책은 단정적으로 쓴다. ("가능합니다 / 불가능합니다 / 처리됩니다 / 노출됩니다 / 노출되지 않습니다")
- 확정되지 않은 정책은 "정책 확인 필요"로 남긴다.

[최종 검수 체크리스트]
문서 작성 후 아래 항목을 반드시 점검한다.
- 운영자가 이 문서만 보고 실제 작업을 수행할 수 있는지
- 입력값 기준이 빠진 항목은 없는지
- 상태값과 액션이 연결되어 있는지
- 사용자 화면에 미치는 영향이 설명되어 있는지
- 정책 충돌 또는 누락 항목이 표시되어 있는지
- Figma에 없는 내용을 임의로 추가하지 않았는지`;

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
