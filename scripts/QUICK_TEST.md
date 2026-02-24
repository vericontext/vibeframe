# VibeFrame 빠른 테스트

> 해변의 골든 리트리버를 주제로, 이미지 → 음성 → 영상 → 합치기 순으로 이어집니다.

---

## 셋업

VibeFrame은 두 가지 방법으로 셋업할 수 있습니다.

---

### 방법 A: curl 설치 (일반 사용자)

```bash
curl -fsSL https://vibeframe.ai/install.sh | bash
```

설치 후 위자드가 자동으로 실행됩니다:

```
VibeFrame Setup
────────────────────────────
1. Choose your AI provider
   → Claude / OpenAI / Gemini / xAI / Ollama (무료 로컬)

2. API Key 입력
   → 선택한 프로바이더의 키 1개 입력

✓ Setup complete!
```

추가 프로바이더 키는 나중에:
```bash
vibe setup --full      # 모든 프로바이더 키 대화형 설정
vibe setup --show      # 현재 설정 확인
```

> **키 저장 위치**: `~/.vibeframe/config.yaml`  
> 이후 `vibe` 명령을 실행하면 자동으로 이 파일을 읽습니다.

---

### 방법 B: 개발자 모드 (저장소 클론)

```bash
# 1. 의존성 설치 및 빌드
pnpm install && pnpm build

# 2. .env 파일 생성
cp .env.example .env
# .env 파일을 열어 필요한 API 키 입력
```

`.env` 파일 예시:
```bash
# 최소 셋업 — Q1~Q5 실행 가능
GOOGLE_API_KEY=...
ELEVENLABS_API_KEY=...
KLING_API_KEY=...

# 전체 실행 추가
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
RUNWAY_API_SECRET=...
```

> **키 저장 위치**: 프로젝트 루트 `.env`  
> `pnpm vibe` 명령 실행 시 자동으로 로드됩니다.

---

### 두 방법 비교

| | curl 설치 | 개발자 모드 |
|--|-----------|------------|
| **실행 명령** | `vibe` | `pnpm vibe` |
| **키 저장** | `~/.vibeframe/config.yaml` | 프로젝트 루트 `.env` |
| **키 추가/수정** | `vibe setup --full` | `.env` 직접 편집 |
| **키 우선순위** | config.yaml → .env → 프롬프트 순 |  |

> **참고**: 두 방법을 동시에 써도 됩니다. config.yaml에 없는 키는 .env에서 자동으로 보완합니다.

---

## 필요한 API 키 한눈에 보기

| 스텝 | 기능 | 필요 API 키 |
|------|------|------------|
| Q1 | 이미지 생성 | `GOOGLE_API_KEY` |
| Q2 | 이미지 편집 | `GOOGLE_API_KEY` |
| Q3 | 음성 생성 (TTS) | `ELEVENLABS_API_KEY` |
| Q4 | 영상 생성 (Kling) | `KLING_API_KEY` |
| Q5 | 음성+영상 합치기 | 없음 (FFmpeg만 사용) |
| Q6 | 색감 변환 | `ANTHROPIC_API_KEY` |
| Q7 | 음성 인식 | `OPENAI_API_KEY` |
| Q8 | 영상 분석 | `GOOGLE_API_KEY` |
| Q9 | 이미지→영상 (Runway) | `RUNWAY_API_SECRET` |
| Q10 | 전체 파이프라인 | `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `RUNWAY_API_SECRET` |

---

## 테스트 (순서대로)

### Q1. 이미지 만들기

> **모델**: Google Gemini Nano Banana (`gemini-2.5-flash-image`, 기본값)  
> **메커니즘**: 텍스트 프롬프트 → Gemini 이미지 생성 API (Nano Banana) → PNG 저장  
> **Gemini 모델 선택**: `-m flash` (기본, 빠름·1024px) / `-m pro` (Nano Banana Pro `gemini-3-pro-image-preview`, 고품질·최대 4K·Thinking 모드)  
> **다른 프로바이더**: `--provider openai` (GPT Image 1.5), `--provider stability` (Stability AI SDXL), `--provider runway` (Runway 이미지)  
> **필요 API 키**: `GOOGLE_API_KEY` — 다른 프로바이더 사용 시: openai→`OPENAI_API_KEY`, stability→`STABILITY_API_KEY`, runway→`RUNWAY_API_SECRET`

```bash
pnpm vibe ai image "a golden retriever on a beach" -o test-results/dog.png --provider gemini
```
✅ `dog.png` 열어보면 해변의 개가 보임

---

### Q2. 이미지 편집하기 (Q1 결과 사용)

> **모델**: Google Gemini Nano Banana (`gemini-2.5-flash-image`, 기본값)  
> **메커니즘**: 원본 이미지 + 편집 지시 텍스트 → Gemini 멀티모달 편집 API → 수정된 PNG 저장  
> **모델 선택**: `-m flash` (기본, 최대 3장 입력) / `-m pro` (Nano Banana Pro `gemini-3-pro-image-preview`, 최대 14장 입력·최대 4K·Thinking 모드, 더 정교한 편집)  
> **특이사항**: `gemini-edit`는 Gemini 전용 기능으로, 다른 프로바이더 대체 없음 (Stability AI의 `ai sd-replace`/`ai sd-img2img`가 유사한 역할)  
> **필요 API 키**: `GOOGLE_API_KEY`

```bash
pnpm vibe ai gemini-edit test-results/dog.png "put sunglasses on the dog" -o test-results/dog-cool.png
```
✅ `dog.png`와 `dog-cool.png` 나란히 열면 선글라스가 추가됨

---

### Q3. 이미지 설명 음성으로 만들기

> **모델**: ElevenLabs `eleven_multilingual_v2`  
> **메커니즘**: 텍스트 → ElevenLabs TTS API (Rachel 음성, 다국어 지원) → MP3 저장  
> **다른 옵션**: `-v <voice-id>` 로 다른 음성 선택 가능 (`pnpm vibe ai voices` 로 목록 확인). 음성만 바꾸며 모델은 고정.  
> **필요 API 키**: `ELEVENLABS_API_KEY`

```bash
pnpm vibe ai tts "햇살 가득한 해변에서 골든 리트리버가 뛰어놀고 있습니다." -o test-results/dog-narration.mp3
```
✅ `dog-narration.mp3` 재생하면 자연스러운 한국어 음성

---

### Q4. 같은 장면을 영상으로 만들기 (1~2분 소요, 무음)

> **모델**: Kling v2.5 Turbo (`kling-v2-5-turbo`, 기본값)  
> **메커니즘**: 텍스트 프롬프트 → Kling API 비동기 생성 (폴링) → MP4 다운로드  
> **다른 옵션**: `-m std` (Standard 모드, 더 빠름), Kling 대신 `vibe ai video` 로 Runway Gen-4.5 사용 가능. 고화질은 `kling-v2-6` 모델 자동 선택.  
> **참고**: Kling 생성 영상은 오디오 트랙 없음 → Q5에서 합침  
> **필요 API 키**: `KLING_API_KEY` — Runway 사용 시: `RUNWAY_API_SECRET`

```bash
pnpm vibe ai kling "a golden retriever running on a sunny beach, cinematic slow motion" -o test-results/dog.mp4 -d 5
```
✅ `dog.mp4` 재생하면 해변 영상이 나오지만 **소리 없음** — 다음 단계에서 음성 합침

---

### Q5. 음성을 영상에 합치기 (Q3 음성 + Q4 영상)

> **모델**: 없음 (AI 미사용)  
> **메커니즘**: VibeFrame 프로젝트 파일(`.vibe.json`)에 영상/오디오 소스를 등록 → 타임라인 구성 → FFmpeg으로 먹싱(muxing) 후 MP4 내보내기  
> **특이사항**: VibeFrame의 핵심 워크플로 — 여러 소스를 타임라인에 얹어서 하나의 영상으로 합치는 편집 파이프라인  
> **필요 API 키**: 없음 — FFmpeg만 사용 (로컬 설치 필요: `brew install ffmpeg`)

```bash
# 프로젝트 생성
pnpm vibe project create dog-video -o test-results/dog-project.vibe.json

# 소스 추가 (ID 자동 캡처)
VID=$(pnpm vibe timeline add-source test-results/dog-project.vibe.json test-results/dog.mp4 2>&1 | grep "Source added:" | awk '{print $NF}')
AUD=$(pnpm vibe timeline add-source test-results/dog-project.vibe.json test-results/dog-narration.mp3 2>&1 | grep "Source added:" | awk '{print $NF}')

# 타임라인에 클립 추가
pnpm vibe timeline add-clip test-results/dog-project.vibe.json $VID
pnpm vibe timeline add-clip test-results/dog-project.vibe.json $AUD

# 내보내기
pnpm vibe export test-results/dog-project.vibe.json -o test-results/dog-final.mp4 -y
```
✅ `dog-final.mp4` 재생하면 해변 영상 + 한국어 음성이 함께 나옴

---

### Q6. 영상 색감 바꾸기 (Q5 결과 사용)

> **모델**: Claude (Anthropic) + FFmpeg (로컬)  
> **메커니즘**: 프리셋/스타일 텍스트 → Claude API가 FFmpeg `vf` 필터 문자열 생성 → 로컬 FFmpeg이 실제 색보정 적용  
> **다른 옵션**: `-p` 프리셋 대신 `--style "film noir"` 처럼 자유 텍스트 입력 가능. 프리셋: `cinematic-warm`, `cinematic-cool`, `vintage`, `high-contrast`  
> **특이사항**: AI는 "어떤 필터를 쓸지" 결정만 하고 실제 처리는 로컬 FFmpeg이 담당 → API 비용 최소, 처리 빠름  
> **필요 API 키**: `ANTHROPIC_API_KEY`

```bash
pnpm vibe ai grade test-results/dog-final.mp4 -p cinematic-warm -o test-results/dog-warm.mp4
```
✅ `dog-final.mp4`와 `dog-warm.mp4` 나란히 재생하면 따뜻한 시네마틱 색감으로 바뀐 차이가 보임

---

### Q7. 합친 영상의 음성 인식으로 검증하기 (Q5 결과 사용)

> **모델**: OpenAI Whisper (`whisper-1`)  
> **메커니즘**: 영상/오디오 파일 → OpenAI Whisper API → 텍스트 전사(transcription) 출력  
> **다른 옵션**: `-l ko` 언어 명시 가능 (자동감지도 지원). 현재 Whisper 단일 모델.  
> **필요 API 키**: `OPENAI_API_KEY`

```bash
pnpm vibe ai transcribe test-results/dog-final.mp4
```
✅ 터미널에 "햇살 가득한 해변에서 골든 리트리버가..." 출력 → 음성이 영상에 정상적으로 들어간 것 확인

---

### Q8. 영상 분석하기 (Q5 결과 사용)

> **모델**: Google Gemini Flash Preview (`gemini-3-flash-preview`, 기본값)  
> **메커니즘**: 영상 파일 → Gemini 멀티모달 API (영상 이해) → 질문에 대한 텍스트 응답  
> **다른 옵션**: `--model gemini-2.5-flash` 또는 `--model gemini-2.5-pro` 로 모델 선택 가능  
> **필요 API 키**: `GOOGLE_API_KEY`

```bash
pnpm vibe ai gemini-video test-results/dog-final.mp4 "이 영상에서 무슨 일이 일어나고 있나요?"
```
✅ 터미널에 "골든 리트리버", "해변" 등 키워드가 포함된 설명 출력

---

### Q9. 이미지로 영상 만들기 (Q2 결과 사용, 1~2분 소요)

> **모델**: Runway Gen-4 Turbo (`gen4_turbo`)  
> **메커니즘**: 로컬 이미지 파일 → base64 변환 → Runway Image-to-Video API → MP4 다운로드  
> **Kling을 쓰지 않는 이유**: Kling v2.5/v2.6은 이미지 URL만 허용 (로컬 파일 불가). Runway는 로컬 파일을 직접 지원.  
> **Q4와의 차이**: Q4는 텍스트만으로 영상 생성(결과 예측 어려움), Q9는 이미지를 시작점으로 사용(캐릭터/구도가 원본 이미지 그대로 유지됨)  
> **필요 API 키**: `RUNWAY_API_SECRET`

```bash
pnpm vibe ai video "the dog starts running toward the ocean" -p runway -i test-results/dog-cool.png -o test-results/dog-cool.mp4 -d 5
```
✅ `dog-cool.mp4` 재생하면 선글라스 낀 개가 움직이는 영상 — Q4(텍스트→영상)과 비교하면 이미지가 그대로 살아있는 차이가 보임

---

### Q10. 전체 파이프라인 — 이 주제로 광고 만들기 (5~10분 소요)

> **모델**: Claude (스토리보드 생성) → Gemini Nano Banana (장면 이미지) → Kling v2.5 Turbo 또는 Runway Gen-4 Turbo (장면 영상) → ElevenLabs (내레이션)  
> **메커니즘**: 스크립트 → Claude가 장면 분할 + 스토리보드 JSON 생성 → 각 장면 이미지 생성 → 이미지→영상 변환 → TTS 내레이션 생성 → 전체 어셈블

> **영상 생성기 선택 (`-g`)**:
> - `-g kling` (기본값): 이미지→영상 변환 시 Kling이 URL만 허용하므로, 내부적으로 **ImgBB**에 이미지를 업로드해 URL을 얻음. `KLING_API_KEY` + `IMGBB_API_KEY` 2개 필요. `IMGBB_API_KEY` 없으면 텍스트→영상으로 fallback (이미지 참조 없음).
> - `-g runway` (권장): 로컬 이미지 파일을 직접 base64로 변환해 전송 — 외부 업로드 서비스 불필요. `RUNWAY_API_SECRET` 1개만 필요.

> **다른 옵션**: `-i openai` (GPT Image로 이미지 생성), `--images-only` (영상 생성 건너뜀)  
> **필요 API 키** (`-g runway` 기준): `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `RUNWAY_API_SECRET`  
> **필요 API 키** (`-g kling` 기준): `ANTHROPIC_API_KEY` + `GOOGLE_API_KEY` + `ELEVENLABS_API_KEY` + `KLING_API_KEY` (+ `IMGBB_API_KEY` 권장)

```bash
# Runway 사용 (추천: API 키 1개, 이미지 업로드 불필요)
pnpm vibe ai script-to-video "A 15-second ad featuring a golden retriever on a sunny beach" -g runway -o test-results/dog-ad/

# Kling 사용 (IMGBB_API_KEY도 필요)
# pnpm vibe ai script-to-video "..." -g kling -o test-results/dog-ad/

# 최종 영상으로 합치기 (위 명령 완료 후)
pnpm vibe export test-results/dog-ad/project.vibe.json -o test-results/dog-ad-final.mp4 -y
```
✅ `test-results/dog-ad/` 폴더에 `scene-1.mp4`, `narration-1.mp3`, `storyboard.json`, `project.vibe.json` 생성됨  
✅ `test-results/dog-ad-final.mp4` — 모든 장면 + 내레이션이 하나로 합쳐진 최종 광고 영상

---

## 결과

```
Q1  이미지 생성:         PASS / FAIL
Q2  이미지 편집:         PASS / FAIL
Q3  음성 생성:           PASS / FAIL
Q4  영상 생성(무음):     PASS / FAIL
Q5  음성+영상 합치기:    PASS / FAIL
Q6  색감 변환:           PASS / FAIL
Q7  음성 인식 검증:      PASS / FAIL
Q8  영상 분석:           PASS / FAIL
Q9  이미지→영상 변환:   PASS / FAIL
Q10 파이프라인:          PASS / FAIL
```
