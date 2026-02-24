# VibeFrame 기능 테스트 (Landing Page 기준)

> 랜딩페이지에 소개된 핵심 기능들을 직접 검증합니다.  
> **사전 조건**: `QUICK_TEST.md`를 먼저 실행해두면 `test-results/` 결과물을 재사용합니다.

---

## 셋업

셋업이 아직 안 되어 있다면 두 가지 방법 중 하나를 선택하세요.

**방법 A — curl 설치 (일반 사용자)**
```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
# 설치 후 위자드가 자동 실행 → API 키 입력
# 추가 키: vibe setup --full
```

**방법 B — 개발자 모드 (저장소 클론)**
```bash
pnpm install && pnpm build
cp .env.example .env  # .env 열어서 키 입력
```

> 자세한 내용은 `QUICK_TEST.md` 상단 셋업 가이드 참고

---

## 필요한 API 키 한눈에 보기

| 스텝 | 기능 | 필요 API 키 |
|------|------|------------|
| F0 | TED Talk 다운로드 | 없음 (`yt-dlp` 설치 필요) |
| F1 | Agent Mode | `OPENAI_API_KEY` (기본값 GPT-4.5) |
| F2 | Auto Narrate | `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` |
| F3 | Auto Dub | `OPENAI_API_KEY` + `ELEVENLABS_API_KEY` |
| F4 | Reframe (세로 변환) | `ANTHROPIC_API_KEY` |
| F5 | Auto Highlights (기본) | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| F5 | Auto Highlights (--use-gemini) | `GOOGLE_API_KEY` |
| F6 | Auto Shorts | `OPENAI_API_KEY` (기본) 또는 `GOOGLE_API_KEY` (--use-gemini) |
| F7 | B-Roll Matcher | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| F8 | Viral Optimizer | `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| F9 | Image → Motion Graphic | `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY` |
| F10 | Video → Motion Graphic | `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY` |
| F11 | MCP 서버 | 없음 (키는 Claude Desktop/Cursor 측 설정) |

**추가 시스템 요구사항**: `ffmpeg` (로컬 설치), `node` 18+, `pnpm`

---

## F0. TED Talk 다운로드 — 긴 영상 소스 확보

> **참고**: F5 Auto Highlights / F6 Auto Shorts / F8 Viral Optimizer는 길이가 있는 영상이어야 의미있는 결과가 나옵니다.  
> `dog.mp4` 같은 짧은 클립은 전체가 하이라이트로 선택되거나 분석이 불충분합니다.  
> **필요 API 키**: 없음 — `yt-dlp` 설치만 필요 (`brew install yt-dlp`)

**사전 준비: `yt-dlp` 설치**
```bash
# macOS
brew install yt-dlp

# 또는 pip
pip install yt-dlp
```

**TED Talk 다운로드** (Robert Waldinger — "What makes a good life?", ~12분)
```bash
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4" \
  --merge-output-format mp4 \
  -o "test-results/ted-talk.mp4" \
  "https://www.youtube.com/watch?v=8KkKuTCFvzI"
```

✅ `test-results/ted-talk.mp4` — 약 12분짜리 강연 영상 (F5, F6, F8에서 재사용)

> **다른 영상 선택도 가능**: URL만 바꾸면 됨. 5분 이상이면 충분.

---

## F1. Agent Mode — 자연어로 멀티스텝 편집

> 랜딩페이지 히어로 섹션: *"Just type `vibe` and let the AI agent handle multi-step tasks autonomously. 58 tools at your command."*

> **모델**: OpenAI GPT-4.5 (기본값)  
> **메커니즘**: 자연어 입력 → LLM이 필요한 도구 순서 계획 → 도구 자동 호출 반복 → 완료  
> **다른 옵션**: `-p claude` (Claude Sonnet), `-p gemini` (Gemini 2.5 Flash), `-p xai` (Grok-4), `-p ollama` (로컬 모델)  
> **필요 API 키**: `OPENAI_API_KEY` — `-p claude` 시 `ANTHROPIC_API_KEY`, `-p gemini` 시 `GOOGLE_API_KEY`, `-p xai` 시 `XAI_API_KEY`, `-p ollama` 시 없음

```bash
pnpm vibe agent -i "create a project called beach-ad, add test-results/dog-final.mp4 to it, trim the clip to 3 seconds, and export to test-results/agent-output.mp4" -v
```

✅ 터미널에 도구 호출 로그가 순서대로 출력됨:
- `project_create` → `timeline_add_source` → `timeline_trim_clip` → `export_video`

✅ `test-results/agent-output.mp4` 생성 (3초짜리 영상)

---

## F2. Auto Narrate — 영상을 보고 내레이션 자동 생성

> 랜딩페이지 파이프라인: *"Video → Claude Vision → ElevenLabs TTS"*

> **모델**: Gemini Flash Preview (영상 이해 + 대본 작성) + ElevenLabs `eleven_multilingual_v2` (TTS)  
> **메커니즘**: 영상 → Gemini가 장면 분석 후 내레이션 스크립트 작성 → ElevenLabs로 음성 생성 → MP3 저장  
> **다른 옵션**: `-s energetic` / `calm` / `dramatic` (내레이션 스타일), `-v adam` (다른 목소리), `-l ko` (한국어 내레이션)  
> **필요 API 키**: `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY`

```bash
pnpm vibe ai narrate test-results/dog.mp4 -l ko -s energetic -o test-results/narrate-out/
```

✅ `test-results/narrate-out/narration.mp3` — 영상 내용을 설명하는 AI 생성 한국어 음성  
✅ `test-results/narrate-out/narration-script.txt` — AI가 쓴 내레이션 대본 확인 가능

---

## F3. Auto Dub — 음성을 다른 언어로 더빙

> 랜딩페이지 코드 예시: `vibe ai dub narrated/auto-narration.mp3 --language ko`

> **모델**: OpenAI Whisper (원본 언어 전사) → Claude / GPT (번역) → ElevenLabs (대상 언어 TTS)  
> **메커니즘**: 음성 파일 → 텍스트 전사 → 목표 언어로 번역 → 새 언어로 TTS 생성  
> **다른 옵션**: `--source ko` (원본 언어 명시), `-v <voice-id>` (대상 언어에 맞는 목소리)  
> **필요 API 키**: `OPENAI_API_KEY` (Whisper 전사) + `ELEVENLABS_API_KEY` (TTS) — 번역은 기본적으로 Claude 사용 시 `ANTHROPIC_API_KEY`도 필요

```bash
pnpm vibe ai dub test-results/dog-narration.mp3 -l en -o test-results/dog-dubbed-en.mp3
```

✅ `dog-narration.mp3`(한국어)와 `dog-dubbed-en.mp3`(영어) 재생하면 같은 내용을 다른 언어로 말함

---

## F4. Reframe — 가로 영상을 세로(9:16)로 변환

> 랜딩페이지 코드 예시: `vibe ai reframe video.mp4 --aspect 9:16`

> **모델**: Claude Vision (피사체 위치 분석 + 최적 크롭 좌표 결정) + FFmpeg (실제 크롭)  
> **메커니즘**: 프레임 샘플링 → Claude가 주요 피사체 위치 파악 → 크롭 영역 결정 → FFmpeg으로 적용  
> **다른 옵션**: `--focus face` / `center` / `action` / `auto`, `--analyze-only` (크롭 영역만 확인)  
> **필요 API 키**: `ANTHROPIC_API_KEY`

```bash
pnpm vibe ai reframe test-results/dog.mp4 --aspect 9:16 -o test-results/dog-vertical.mp4
```

✅ `dog-vertical.mp4` 재생하면 세로(9:16) 포맷으로 피사체(개)가 화면 중앙에 유지됨  
✅ 좌우가 잘렸지만 주요 피사체는 잘리지 않음

---

## F5. Auto Highlights — 긴 영상에서 하이라이트 추출

> 랜딩페이지 파이프라인: *"Long video → AI analysis → Best moments"*

> **모드 A — 기본값 (Whisper + Claude)**  
> **모델**: OpenAI `whisper-1` (대사 전사) + Claude (감정·정보 중요도 분석)  
> **메커니즘**: FFmpeg으로 오디오 추출 → Whisper로 타임스탬프별 대사 전사 → Claude가 구간별 중요도 점수화 → 기준치 이상 구간 선택 → JSON 출력  
> **적합한 경우**: TED 강연, 인터뷰, 팟캐스트 등 대사가 핵심인 영상  
> **필요 API 키**: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`

> **모드 B — `--use-gemini` (Gemini Video Understanding)**  
> **모델**: Gemini Flash Preview — 영상+음성을 동시에 직접 분석  
> **메커니즘**: 영상 파일 전체를 Gemini에 업로드 → 시각(표정·슬라이드·행동) + 음성을 함께 분석 → 하이라이트 선택  
> **적합한 경우**: 스포츠, 시각 데모, 오디오 없는 영상, 시각적 임팩트가 중요한 경우  
> **필요 API 키**: `GOOGLE_API_KEY` 1개만

> **참고**: 하이라이트 JSON만으로는 영상이 만들어지지 않음. `-p` 옵션으로 프로젝트 파일 생성 후 `vibe export`로 영상 추출 필요

**모드 A: Whisper + Claude (TED 강연 권장)**
```bash
# JSON 분석 + 프로젝트 파일 동시 생성
pnpm vibe ai highlights test-results/ted-talk.mp4 \
  -o test-results/highlights.json \
  -p test-results/highlights-project.vibe.json \
  -d 60

# 하이라이트 영상 추출
pnpm vibe export test-results/highlights-project.vibe.json \
  -o test-results/ted-highlights.mp4 -y
```

**모드 B: Gemini Video Understanding (시각 분석)**
```bash
# 영상+음성 동시 분석 (처리 시간 더 오래 걸림)
pnpm vibe ai highlights test-results/ted-talk.mp4 \
  --use-gemini \
  -o test-results/highlights-gemini.json \
  -p test-results/highlights-gemini-project.vibe.json \
  -d 60 --low-res

# 영상 추출
pnpm vibe export test-results/highlights-gemini-project.vibe.json \
  -o test-results/ted-highlights-gemini.mp4 -y
```

✅ `highlights.json` — 타임스탬프(`startTime`, `endTime`), 선택 이유(`reason`), 신뢰도(`confidence`) 목록  
✅ `ted-highlights.mp4` — 하이라이트 구간만 이어붙인 영상 (약 60초)

---

## F6. Auto Shorts — 긴 영상을 숏폼 클립으로 자동 편집

> **모델**: OpenAI Whisper / Gemini (내용 분석 + 최적 구간 선택) + FFmpeg (크롭 + 자르기)  
> **메커니즘**: 영상 분석 → 가장 흥미로운 구간 선택 → 9:16 크롭 + 길이 조정 → 자막 옵션 추가  
> **다른 옵션**: `--use-gemini` (Gemini 영상 이해 활용), `--add-captions` (자막 자동 추가), `-n 3` (여러 개 생성)  
> **필요 API 키**: `OPENAI_API_KEY` (기본) 또는 `GOOGLE_API_KEY` (`--use-gemini` 사용 시)

```bash
pnpm vibe ai auto-shorts test-results/ted-talk.mp4 -d 60 -a 9:16 -o test-results/ted-short.mp4 --add-captions
```

✅ `ted-short.mp4` — 세로(9:16) 60초 숏폼 영상 (강연에서 가장 임팩트 있는 구간 자동 선택)  
✅ 영상에 캡션 자막이 자동으로 삽입됨

---

## F7. B-Roll Matcher — 내레이션에 맞는 B-롤 자동 배치

> 랜딩페이지 파이프라인: *"Narration → Vision analysis → Auto-cut"*

> **모델**: OpenAI Whisper (내레이션 전사) + Claude (내용-영상 매칭 분석)  
> **메커니즘**: 내레이션 → 구간별 텍스트 추출 → 각 구간에 가장 어울리는 B-롤 클립 매칭 → `.vibe.json` 타임라인 생성  
> **참고**: B-롤 클립이 많을수록 매칭 품질 향상. 결과물은 프로젝트 파일로 내보내기(`vibe export`)로 영상화 가능  
> **필요 API 키**: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`

```bash
pnpm vibe ai b-roll test-results/dog-narration.mp3 \
  --broll test-results/dog.mp4,test-results/dog-cool.mp4 \
  -o test-results/broll-project.vibe.json
```

✅ `broll-project.vibe.json` 생성 — 내레이션 타이밍에 B-롤 클립이 배치된 타임라인  
✅ `vibe export test-results/broll-project.vibe.json -o test-results/broll-result.mp4 -y` 로 최종 영상 생성 가능

---

## F8. Viral Optimizer — 플랫폼별 영상 자동 최적화

> 랜딩페이지 코드 예시: `vibe ai viral project.vibe.json -p tiktok,youtube-shorts`  
> 랜딩페이지 파이프라인: *"One video → TikTok, Shorts, Reels"*

> **모델**: Whisper (전사) + Claude (바이럴 훅 분석 + 편집 계획) + FFmpeg (크롭 / 자르기 / 자막)  
> **메커니즘**: 프로젝트 분석 → 플랫폼별 최적 길이·비율·훅 구간 결정 → 각 플랫폼 포맷으로 영상 생성  
> **다른 옵션**: `-p youtube,instagram-reels,twitter`, `--skip-captions`, `--caption-style animated`, `--analyze-only`  
> **참고**: 짧은 영상(dog.mp4 등)은 플랫폼 목표 길이에 못 미쳐 빈 프레임이나 반복이 발생. 5분 이상 영상 권장. `ted-talk.mp4`(F5-prep에서 다운로드)를 재사용.  
> **필요 API 키**: `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`

```bash
# Step 0: TED Talk으로 프로젝트 생성 (F5-prep에서 ted-talk.mp4 준비 필요)
pnpm vibe project create ted-viral -o test-results/ted-viral-project.vibe.json
VID=$(pnpm vibe timeline add-source test-results/ted-viral-project.vibe.json test-results/ted-talk.mp4 2>&1 | grep "Source added:" | awk '{print $NF}')
pnpm vibe timeline add-clip test-results/ted-viral-project.vibe.json $VID

# Step 1: 플랫폼별 프로젝트 파일 생성 (분석 + 편집 계획)
pnpm vibe ai viral test-results/ted-viral-project.vibe.json \
  -p youtube-shorts,tiktok \
  -o test-results/viral-out/

# Step 2: 각 플랫폼 영상으로 내보내기
pnpm vibe export test-results/viral-out/youtube-shorts.vibe.json \
  -o test-results/viral-out/youtube-shorts.mp4 -y

pnpm vibe export test-results/viral-out/tiktok.vibe.json \
  -o test-results/viral-out/tiktok.mp4 -y
```

✅ `test-results/viral-out/analysis.json` — 바이럴 분석 결과 (훅 구간, 플랫폼별 편집 계획)  
✅ `test-results/viral-out/youtube-shorts.vibe.json` / `tiktok.vibe.json` — 플랫폼별 프로젝트 파일  
✅ `test-results/viral-out/youtube-shorts.mp4` — YouTube Shorts 최적화 영상 (9:16, 60초 이내)  
✅ `test-results/viral-out/tiktok.mp4` — TikTok 최적화 영상 (9:16, 60초 이내)

---

## F9. Image Understanding → Remotion 모션 그래픽 생성

> **모델**: Gemini Flash Preview (이미지 분석) → Claude Sonnet (Remotion TSX 코드 생성) → Remotion (렌더링)  
> **메커니즘**: 이미지 → Gemini가 색감·피사체 위치·분위기 분석 → Claude가 분석 컨텍스트 반영 Remotion 컴포넌트 생성 → Remotion으로 렌더링  
> **특이사항**: `--image`는 새로 추가된 옵션. `--video`와 달리 영상 합성은 없고 이미지 스타일을 반영한 독립 모션 그래픽을 생성함  
> **필요 API 키**: `GOOGLE_API_KEY` (이미지 분석) + `ANTHROPIC_API_KEY` (Remotion 코드 생성)

```bash
pnpm vibe ai motion "Animated title card with golden retriever theme, warm beach tones, slow fade-in text" \
  --image test-results/dog.png \
  -o test-results/dog-motion.mp4 -d 5 -s cinematic
```

✅ `test-results/dog-motion.tsx` — 이미지 색감·안전구역·분위기가 반영된 Remotion TSX 컴포넌트  
✅ `test-results/dog-motion.mp4` — `dog.png` 위에 모션 그래픽이 합성된 5초 MP4

### F9-edit. 이미지 모션 그래픽 수정 (--from-tsx)

> **메커니즘**: 기존 TSX 코드를 LLM에 전달 + 수정 지시사항 → 수정된 TSX 반환 → 재렌더링  
> **특이사항**: 처음부터 새로 생성하지 않고 기존 animation 로직을 보존한 채 필요한 부분만 변경  
> **필요 API 키**: `ANTHROPIC_API_KEY` (기본) 또는 `-m gemini` 사용 시 `GOOGLE_API_KEY`

```bash
# TSX만 수정 (재렌더링 없이)
pnpm vibe ai motion "텍스트 크기를 더 크게 하고 색상을 골드에서 화이트로 바꿔줘" \
  --from-tsx test-results/dog-motion.tsx

# 수정 후 이미지에 바로 재합성
pnpm vibe ai motion "텍스트 크기를 더 크게 하고 색상을 골드에서 화이트로 바꿔줘" \
  --from-tsx test-results/dog-motion.tsx \
  --image test-results/dog.png \
  -o test-results/dog-motion-v2.mp4
```

✅ `test-results/dog-motion.tsx` — 수정된 TSX (원본 덮어쓰기, 또는 `-o`로 별도 저장 가능)  
✅ `test-results/dog-motion-v2.mp4` — 수정된 모션 그래픽이 합성된 새 MP4

---

## F10. Video Understanding → Remotion 모션 그래픽 합성

> **모델**: Gemini Flash Preview (영상 분석) → Claude Sonnet (Remotion TSX 코드 생성) → Remotion (렌더링 + FFmpeg 합성)  
> **메커니즘**: 영상 → Gemini가 시각 스타일·레이아웃·페이싱 분석 → Claude가 컨텍스트 반영 Remotion 컴포넌트 생성 → 영상 위에 합성 → MP4 출력  
> **특이사항**: `--video` 시 Gemini가 색상·안전구역·페이싱을 분석 → Claude가 투명 오버레이 컴포넌트 생성 → Remotion으로 투명 WebM 렌더 → FFmpeg로 비디오 위에 합성 → MP4 출력 (원본 오디오 보존)  
> **필요 API 키**: `GOOGLE_API_KEY` + `ANTHROPIC_API_KEY`

```bash
pnpm vibe ai motion "Lower third with animated name tag: 'Golden Retriever — Sunny Beach', minimal white text" \
  --video test-results/dog-final.mp4 \
  -o test-results/dog-overlay.mp4 -d 5 -s minimal
```

✅ `test-results/dog-overlay.tsx` — 영상 컨텍스트(색감·레이아웃·페이싱)가 반영된 Remotion TSX  
✅ `test-results/dog-overlay.mp4` — `dog-final.mp4` 위에 모션 그래픽이 합성된 최종 영상

### F10-edit. 비디오 모션 그래픽 수정 (--from-tsx)

> **메커니즘**: 기존 TSX 코드를 LLM에 전달 + 수정 지시사항 → 수정된 TSX 반환 → 재렌더링  
> **특이사항**: 원본 animation 로직(spring 타이밍, interpolate 값 등) 보존, 요청된 부분만 변경  
> **필요 API 키**: `ANTHROPIC_API_KEY` (기본) 또는 `-m gemini` 사용 시 `GOOGLE_API_KEY`

```bash
# TSX만 수정 (재렌더링 없이)
pnpm vibe ai motion "배경 패널을 제거하고 텍스트에 골드 글로우 효과를 추가해줘" \
  --from-tsx test-results/dog-overlay.tsx

# 수정 후 비디오에 바로 재합성 (새 파일로 저장)
pnpm vibe ai motion "배경 패널을 제거하고 텍스트에 골드 글로우 효과를 추가해줘" \
  --from-tsx test-results/dog-overlay.tsx \
  --video test-results/dog-final.mp4 \
  -o test-results/dog-overlay-v2.mp4

# Gemini 모델로 수정 (다른 관점의 해석)
pnpm vibe ai motion "슬라이드 방향을 왼쪽에서 오른쪽으로 바꾸고 폰트를 얇게" \
  --from-tsx test-results/dog-overlay.tsx \
  --video test-results/dog-final.mp4 \
  -o test-results/dog-overlay-v3.mp4 \
  -m gemini
```

✅ `test-results/dog-overlay.tsx` — 수정된 TSX  
✅ `test-results/dog-overlay-v2.mp4` — 수정된 모션 그래픽이 합성된 새 MP4

---

## F11. MCP — Claude Desktop / Cursor에서 자연어로 제어

> 랜딩페이지: *"Works with Claude Desktop and Cursor. Let AI control your edits."*

> **메커니즘**: MCP 서버 → Claude Desktop / Cursor가 VibeFrame 도구(`project_create`, `timeline_add_source` 등)를 직접 호출  
> **특이사항**: CLI와 동일한 기능이지만 Claude/Cursor 채팅창에서 대화로 제어  
> **필요 API 키**: 없음 — VibeFrame MCP 서버 자체는 키 불필요. AI 기능(이미지 생성 등)을 Agent가 호출할 경우 해당 기능의 키가 `.env`에 있어야 함

**MCP 서버 로컬 실행 확인:**
```bash
pnpm mcp
```
✅ `VibeFrame MCP server running` 메시지 출력 (종료: Ctrl+C)

**Cursor 연동 설정 (`.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

**Claude Desktop 연동 설정 (`~/Library/Application Support/Claude/claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "vibeframe": {
      "command": "npx",
      "args": ["-y", "@vibeframe/mcp-server"]
    }
  }
}
```

✅ Cursor 채팅창에서 *"새 프로젝트 만들고 intro.mp4 추가해줘"* 입력 시 VibeFrame 도구가 자동 실행됨

---

## 결과

```
F1   Agent Mode (자연어 편집):        PASS / FAIL
F2   Auto Narrate (내레이션 생성):    PASS / FAIL
F3   Auto Dub (언어 더빙):            PASS / FAIL
F4   Reframe (세로 변환):             PASS / FAIL
F0   TED Talk 다운로드:               PASS / FAIL
F5   Auto Highlights (하이라이트):    PASS / FAIL
F6   Auto Shorts (숏폼 편집):         PASS / FAIL
F7   B-Roll Matcher (B-롤 매칭):      PASS / FAIL
F8   Viral Optimizer (플랫폼 최적):   PASS / FAIL
F9      Image → Motion Graphic:              PASS / FAIL
F9-edit Image Motion Graphic 수정:         PASS / FAIL
F10     Video → Motion Graphic 합성:       PASS / FAIL
F10-edit Video Motion Graphic 수정:        PASS / FAIL
F11     MCP 서버 실행:                     PASS / FAIL
```
