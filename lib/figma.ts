export interface ScreenPair {
  name: string;
  texts: string[];
  nodeId?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
}

function extractTextFromNode(node: FigmaNode): string[] {
  if (node.type === "TEXT") {
    return node.characters ? [node.characters] : [];
  }
  if (!node.children) return [];
  return node.children.flatMap(extractTextFromNode);
}

function extractFirstText(node: FigmaNode): string {
  if (node.type === "TEXT" && node.characters) {
    return node.characters.split("\n")[0].trim();
  }
  for (const child of node.children ?? []) {
    const t = extractFirstText(child);
    if (t) return t;
  }
  return "";
}

function isMobileFrame(node: FigmaNode): boolean {
  const w = node.absoluteBoundingBox?.width ?? 0;
  const h = node.absoluteBoundingBox?.height ?? 0;
  return w >= 300 && w <= 430 && h > 400;
}

function isScreenNameFrame(node: FigmaNode): boolean {
  // "화면명"은 이름 텍스트 박스 — 화면 이미지로 쓰면 안 됨
  return node.name.includes("화면명");
}

// 패턴 A: GROUP 안에 화면 프레임 + 디스크립션 프레임이 함께 있는 구조 (스크린샷 방식)
function parseGroupStructure(children: FigmaNode[]): ScreenPair[] {
  const pairs: ScreenPair[] = [];

  const groups = children.filter(
    (c) => c.type === "GROUP" || (c.type === "FRAME" && c.children && c.children.some((ch) => ch.name.includes("디스크립션")))
  );

  for (const group of groups) {
    const subs = group.children ?? [];
    const descFrame = subs.find((c) => c.name.includes("디스크립션"));
    if (!descFrame) continue;

    // 화면명·디스크립션 제외한 실제 화면 프레임 찾기
    const screenFrame =
      subs.find((c) => !c.name.includes("디스크립션") && !isScreenNameFrame(c) && isMobileFrame(c)) ??
      subs.find((c) => !c.name.includes("디스크립션") && !isScreenNameFrame(c));

    const texts = extractTextFromNode(descFrame).filter((t) => t.trim());
    const screenName = extractFirstText(descFrame) || group.name;

    pairs.push({
      name: screenName,
      texts: texts.filter((t) => t !== screenName),
      nodeId: screenFrame?.id,
    });
  }

  return pairs;
}

// 패턴 B: 캔버스 최상위에 디스크립션 프레임들이 나열된 flat 구조
function parseFlatStructure(children: FigmaNode[]): ScreenPair[] {
  const descFrames = children.filter((f) => f.name.includes("디스크립션"));

  // 화면디스크립션 + 화면명 쌍 방식 (구버전)
  const hasOldPattern = children.some((f) => f.name.includes("화면디스크립션"));
  if (hasOldPattern) {
    return descFrames
      .filter((f) => f.name.includes("화면디스크립션"))
      .map((descFrame) => {
        const prefix = descFrame.name.replace("화면디스크립션", "").trim();
        const nameFrame = children.find(
          (f) => f.name.includes("화면명") && f.name.startsWith(prefix)
        );
        const screenName = nameFrame
          ? extractTextFromNode(nameFrame).join(" ").trim() || nameFrame.name
          : descFrame.name;
        const screenFrame = children.find(
          (f) => !f.name.includes("디스크립션") && !f.name.includes("화면명") && f.name.startsWith(prefix)
        );
        return {
          name: screenName,
          texts: extractTextFromNode(descFrame).filter((t) => t.trim()),
          nodeId: screenFrame?.id ?? descFrame.id,
        };
      });
  }

  // 디스크립션 프레임 — 첫 번째 텍스트가 화면명
  const nonDesc = children.filter(
    (f) => !f.name.includes("디스크립션") && !isScreenNameFrame(f)
  );
  return descFrames.map((descFrame) => {
    const texts = extractTextFromNode(descFrame).filter((t) => t.trim());
    const screenName = texts[0] || descFrame.name;

    // 1) 이름 정확 매칭 → 2) 부분 매칭 → 3) 바로 앞 비-디스크립션/비-화면명 프레임
    const screenFrame =
      nonDesc.find((f) => f.name === screenName) ??
      nonDesc.find((f) => screenName.includes(f.name) || f.name.includes(screenName)) ??
      (() => {
        const idx = children.indexOf(descFrame);
        for (let j = idx - 1; j >= 0; j--) {
          if (!children[j].name.includes("디스크립션") && !isScreenNameFrame(children[j])) return children[j];
        }
        return undefined;
      })();

    return {
      name: screenName,
      texts: texts.slice(1),
      nodeId: screenFrame?.id ?? descFrame.id,
    };
  });
}

export function groupFramesByPrefix(children: FigmaNode[]): ScreenPair[] {
  // GROUP 구조가 있으면 패턴 A 사용
  const hasGroups = children.some(
    (c) => c.type === "GROUP" || (c.type === "FRAME" && c.children?.some((ch) => ch.name.includes("디스크립션")))
  );
  const result = hasGroups ? parseGroupStructure(children) : parseFlatStructure(children);
  return result;
}

export function extractSpecContent(children: FigmaNode[]): string {
  const specFrames = children.filter(
    (f) => f.name.includes("스펙") || f.name.includes("정책")
  );
  const texts = specFrames.flatMap((f) => extractTextFromNode(f)).filter((t) => t.trim());
  return texts.join("\n");
}

export function buildUserMessage(pairs: ScreenPair[], specContent?: string): string {
  const screenPart = pairs
    .map((pair, i) => `화면 ${i + 1}: ${pair.name}\n${pair.texts.join("\n")}`)
    .join("\n\n---\n\n");

  if (specContent) {
    return `[기능 정의 / 스펙 / 정책]\n${specContent}\n\n===\n\n[화면별 설명]\n${screenPart}`;
  }
  return screenPart;
}

export function extractFileKey(url: string): string | null {
  const match = url.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

export function extractNodeId(url: string): string | null {
  const match = url.match(/node-id=([^&]+)/);
  return match ? match[1].replace(/-/g, ":") : null;
}
