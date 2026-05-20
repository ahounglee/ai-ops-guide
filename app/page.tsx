"use client";

import { useState } from "react";

const AUDIENCE_OPTIONS = [
  { value: "admin", label: "운영/MD", desc: "어드민 세팅·생성·관리 방법" },
  { value: "user", label: "사용자", desc: "서비스 이용 방법 안내" },
];

export default function Home() {
  const [url, setUrl] = useState("");
  const [audience, setAudience] = useState("admin");
  const [guide, setGuide] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [screenCount, setScreenCount] = useState(0);
  const [generatedAudience, setGeneratedAudience] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setGuide("");

    try {
      const res = await fetch("/api/generate-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl: url, audience }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "오류가 발생했습니다.");
        return;
      }

      setGuide(data.guide);
      setScreenCount(data.screenCount);
      setGeneratedAudience(audience);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(guide);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    const label = AUDIENCE_OPTIONS.find((o) => o.value === generatedAudience)?.label ?? "";
    const blob = new Blob([guide], { type: "text/markdown;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `운영가이드_${label}.md`;
    a.click();
    URL.revokeObjectURL(downloadUrl);
  }

  const selectedOption = AUDIENCE_OPTIONS.find((o) => o.value === audience);

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">운영 가이드 자동 생성</h1>
          <p className="mt-1 text-sm text-gray-500">
            Figma 화면설계서 URL을 입력하면 대상별 가이드 초안을 생성합니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mb-6 space-y-3">
          {/* 대상 선택 */}
          <div>
            <p className="mb-2 text-xs font-medium text-gray-600">가이드 대상</p>
            <div className="flex gap-2">
              {AUDIENCE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAudience(opt.value)}
                  disabled={loading}
                  className={`flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                    audience === opt.value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* URL 입력 */}
          <div className="flex gap-3">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.figma.com/design/..."
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "생성 중..." : "가이드 생성"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400">
            {selectedOption?.label} 가이드 생성 중...
          </div>
        )}

        {guide && (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <span className="text-sm text-gray-500">
                화면 {screenCount}개 · {AUDIENCE_OPTIONS.find((o) => o.value === generatedAudience)?.label} 가이드 초안
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleDownload}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  노션용 다운로드
                </button>
                <button
                  onClick={handleCopy}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {copied ? "복사됨 ✓" : "전체 복사"}
                </button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap p-4 text-sm text-gray-800 font-sans leading-relaxed overflow-auto max-h-[60vh]">
              {guide}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
