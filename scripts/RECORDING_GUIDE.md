# VibeFrame Demo Recording Guide

> 그대로 따라하면 되는 데모 영상 촬영 가이드

## 촬영 개요

| 항목 | 내용 |
|------|------|
| **완성 길이** | 전체 ~3분, GIF용 ~15초 (Act 4만) |
| **타겟** | README GIF, Twitter/X, Hacker News |
| **Act 수** | 4개 (각각 독립 촬영 가능) |
| **모드** | dry-run (API 키 불필요) 또는 live (실제 실행) |

---

## PART 1: 사전 준비

### 1-1. 터미널 세팅

```bash
# 터미널 앱: iTerm2 추천 (macOS)
# 프로파일 설정:
#   - 폰트: JetBrains Mono 또는 Fira Code, 15pt
#   - 테마: 다크 배경 (#141414), 포그라운드 (#e4e4e4)
#   - 창 크기: 102 x 29 (asciinema 기본)
#   - 스크롤바: 숨김
#   - 커서: Block, 깜빡임 켜기

# 터미널 창 크기 고정 (iTerm2 > Preferences > Profiles > Window)
# 또는 수동:
printf '\e[8;29;102t'
```

### 1-2. 화면 정리

```bash
# 알림 끄기 (macOS)
# System Settings > Focus > Do Not Disturb > 켜기

# 데스크톱 정리 (촬영 중 실수로 보일 수 있음)
# 불필요한 앱 종료

# 터미널 히스토리 정리 (위쪽 화살표로 다른 명령이 나오지 않게)
history -c 2>/dev/null || true
```

### 1-3. 녹화 도구 설치

```bash
# 방법 A: asciinema (터미널 전용, GIF 변환 가능) -- 추천
brew install asciinema
pip3 install asciinema-agg    # GIF/PNG 변환용

# 방법 B: 화면 녹화 (전체 화면)
# macOS: Cmd+Shift+5 → 영역 녹화
# OBS Studio: https://obsproject.com (무료)
```

### 1-4. 프로젝트 준비

```bash
cd ~/Projects/business/vibeframe

# 빌드 확인
pnpm build

# demo-output 디렉토리 생성
mkdir -p demo-output

# live 모드용: sample.mp4 준비 (Act 2, 3, 4에서 사용)
# 30~60초짜리 영상이면 충분. 없으면 dry-run으로 촬영.
ls demo-output/sample.mp4 2>/dev/null || echo "sample.mp4 없음 → dry-run 모드 사용"
```

---

## PART 2: 촬영 시나리오

### 촬영 전 체크리스트

- [ ] 터미널 깨끗한 상태 (`clear` 실행)
- [ ] 폰트 크기 15pt 이상 (영상에서 읽힘)
- [ ] 방해금지 모드 켜짐
- [ ] `pnpm build` 성공 확인
- [ ] 녹화 도구 준비 완료

---

### Scene 0: 오프닝 (10초)

**목적:** VibeFrame이 뭔지 한눈에 보여주기

```bash
# 녹화 시작
asciinema rec docs/demo.cast --cols 102 --rows 29 --overwrite

# ── 여기서부터 녹화 중 ──

# (2초 대기 후 타이핑)
clear
```

**타이핑 (천천히, 한 글자씩):**
```
vibe
```

**기대 출력:**
```
██╗   ██╗██╗██████╗ ███████╗███████╗██████╗  █████╗ ███╗   ███╗███████╗
██║   ██║██║██╔══██╗██╔════╝██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝
██║   ██║██║██████╔╝█████╗  █████╗  ██████╔╝███████║██╔████╔██║█████╗
╚██╗ ██╔╝██║██╔══██╗██╔══╝  ██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝
 ╚████╔╝ ██║██████╔╝███████╗██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗
  ╚═══╝  ╚═╝╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝

  v0.17.1 · openai · ~/Projects/business/vibeframe

  58 tools

  Commands: exit · reset · tools · context

you>
```

**액션:** 배너가 뜨면 3초 대기 → `exit` 타이핑 후 Enter로 종료 (Ctrl+C는 종료 안 됨)

---

### Scene 1: Script-to-Video (Act 1) — 45초

**목적:** 한 줄 명령으로 완성된 영상이 나오는 WOW 모먼트

**방법 A: dry-run 스크립트 (추천 — 안전하고 빠름)**

```bash
# 터미널에서 직접 타이핑
clear

# (1초 대기)
# 아래 명령을 천천히 타이핑. 백슬래시(\)로 줄바꿈하면 시각적으로 깔끔.
```

**타이핑 (한 줄씩, 각 줄 사이 0.5초):**
```bash
vibe ai script-to-video \
  "A developer types one command. AI generates visuals. A finished video plays back." \
  --voice rachel \
  --image-provider gemini \
  --generator kling
```

> **dry-run 촬영 시:** 위 명령 대신 `./scripts/demo.sh --act 1` 실행
> 시뮬레이션 출력이 자동으로 나옴

**기대 출력 (dry-run):**
```
  [1/5] Generating storyboard with Claude...
        3 scenes, 30s total duration
  [2/5] Generating narration with ElevenLabs (voice: rachel)...
        scene-1.mp3 (10.2s) scene-2.mp3 (9.8s) scene-3.mp3 (10.0s)
  [3/5] Generating images with Gemini...
        scene-1.png scene-2.png scene-3.png
  [4/5] Generating videos with Kling v2.5...
        scene-1.mp4 (10s) scene-2.mp4 (10s) scene-3.mp4 (10s)
  [5/5] Assembling project...

  Done! Project: my-project.vibe.json
  Output:  script-to-video-output/final.mp4 (30s, 1080p)
```

**포인트:** 5개 AI API가 순차적으로 체이닝되는 모습. 각 단계의 출력이 화면에 뜨는 걸 보여주기.

**타이밍:**
- 명령 타이핑: ~8초
- 출력 표시: ~15초 (dry-run) / ~4분 (live)
- 결과 감상: 3초

---

### Scene 2: Post-Production Combo (Act 2) — 40초

**목적:** 4개 후반작업 명령을 연타로 보여주기

```bash
clear

# (1초 대기)
```

**방법 A: 개별 명령 직접 타이핑**

명령 1 — 노이즈 제거:
```bash
vibe ai noise-reduce demo-output/sample.mp4 -o demo-output/clean.mp4
```

명령 2 — 무음 구간 자르기:
```bash
vibe ai silence-cut demo-output/clean.mp4 -o demo-output/cut.mp4 --noise -35
```

명령 3 — 자막 생성:
```bash
vibe ai caption demo-output/cut.mp4 -o demo-output/captioned.mp4 --style bold
```

명령 4 — 페이드 효과:
```bash
vibe ai fade demo-output/captioned.mp4 -o demo-output/final.mp4 --fade-in 1.0 --fade-out 1.5
```

**방법 B: 스크립트로 한번에 (추천)**
```bash
./scripts/demo.sh --act 2
```

**포인트:** 4개 명령이 물 흐르듯 이어지는 파이프라인. "62초 → 43.6초, 수작업 0초" 강조.

**타이밍:**
- 각 명령 타이핑 + 출력: ~8초 x 4 = 32초
- 마무리 코멘트: 5초

---

### Scene 3: Agent Mode (Act 3) — 35초

**목적:** 자연어 한 문장으로 AI가 알아서 복잡한 작업 수행

```bash
clear

# (1초 대기)
```

**타이핑:**
```bash
vibe agent -i "Analyze demo-output/sample.mp4, find the best frame for a thumbnail, extract it, and generate Korean captions for the video." -v
```

> **dry-run 촬영 시:** `./scripts/demo.sh --act 3` 실행

**기대 출력 (dry-run):**
```
  [Agent] Planning: 3 tasks identified

  [Agent] Step 1: Calling ai_analyze...
          Video: 43.6s, 1080p, 30fps
          Content: tech product demo, speaker with screen recording

  [Agent] Step 2: Calling ai_thumbnail --best-frame...
          Analyzed 15 candidate frames
          Best frame: 00:00:12.4 (score: 0.94)
          Saved: demo-output/thumbnail.png (1920x1080)

  [Agent] Step 3: Calling ai_caption --lang ko...
          Transcribed 34 segments
          Burned Korean captions with style: bold

  [Agent] Done! Completed 3 tool calls autonomously.
```

**포인트:** Agent가 자율적으로 3개 도구를 호출하는 과정. 사람이 개입하지 않음.

**타이밍:**
- 명령 타이핑: ~10초
- Agent 실행 출력: ~15초
- 결과 감상: 3초

---

### Scene 4: Motion Graphics (Act 4) — 40초 ★ GIF 최적

**목적:** 가장 새롭고 시각적인 기능. 자연어 → 코드 생성 → 렌더링

```bash
clear

# (1초 대기)
```

**Step 1 — 타이틀 카드 생성:**

타이핑:
```bash
vibe ai motion \
  "cinematic title card with 'VIBEFRAME' text, spring bounce animation, gold gradient" \
  --render -o demo-output/title.webm
```

> **dry-run 촬영 시:** `./scripts/demo.sh --act 4` 실행

**기대 출력 (dry-run):**
```
  [Claude] Generating Remotion TSX component...
          import { spring, useCurrentFrame } from 'remotion';
          // 47 lines of React motion graphics code
  [Render] Scaffolding temp project...
  [Render] npx remotion render → title.webm (1920x1080, 5s, 30fps)

  Motion graphic rendered: demo-output/title.webm
```

**(3초 대기)**

**Step 2 — 영상 위에 합성:**

타이핑:
```bash
vibe ai motion \
  "lower-third title: 'Kiyeon, CEO' with slide-in from left" \
  --video demo-output/sample.mp4 -o demo-output/with-title.mp4
```

**기대 출력 (dry-run):**
```
  [Claude] Generating Remotion TSX component...
          // Lower-third with slide-in animation
  [Render] Rendering transparent overlay (1920x1080, 3s)...
  [Composite] Overlaying on sample.mp4 via FFmpeg...

  Composited: demo-output/with-title.mp4
```

**포인트:** "자연어 → Claude가 React 코드 작성 → Remotion 렌더 → FFmpeg 합성" 이 파이프라인이 WOW.

**타이밍:**
- Step 1 타이핑 + 출력: ~15초
- Step 2 타이핑 + 출력: ~15초
- 마무리: 5초

---

### Scene 5: 엔딩 (5초)

녹화가 끝나기 전에 짧은 여운:

```bash
# (Act 4 출력 후 2초 대기)

# 터미널에 간단히 타이핑
echo "58 tools. 10 providers. One CLI."
```

```bash
# 녹화 종료
# asciinema: Ctrl+D 또는 exit
exit

# 녹화 파일 확인
ls -la docs/demo.cast
```

---

## PART 3: 촬영 실행 (복붙용)

### Option A: 전체 Demo (dry-run 스크립트)

API 키 없이 전체 데모를 한번에 촬영:

```bash
# 1. 녹화 시작
asciinema rec docs/demo-full.cast --cols 102 --rows 29 --overwrite

# 2. 녹화 중: 스크립트 실행
./scripts/demo.sh --dry-run

# 3. 끝나면 Ctrl+D로 녹화 종료
```

### Option B: Act 4만 (GIF용, 추천)

짧고 임팩트 있는 GIF:

```bash
# 1. 녹화 시작
asciinema rec docs/demo-motion.cast --cols 102 --rows 29 --overwrite

# 2. 녹화 중:
clear
./scripts/demo.sh --dry-run --act 4

# 3. 끝나면 Ctrl+D로 녹화 종료
```

### Option C: 직접 타이핑 (가장 자연스러움)

스크립트 대신 직접 타이핑하면 더 자연스럽습니다:

```bash
# 1. 녹화 시작
asciinema rec docs/demo.cast --cols 102 --rows 29 --overwrite

# 2. 녹화 중: Scene 0~5 순서대로 직접 타이핑
#    (위의 Scene별 "타이핑" 섹션 참고)

# 3. 끝나면 exit
exit
```

### Option D: Live 실행 (실제 API 호출)

API 키가 있고 실제 실행을 보여주고 싶을 때:

```bash
# 필수: .env에 API 키 설정
# ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, GOOGLE_API_KEY, KLING_API_KEY 등

# 개별 Act 라이브 실행 (Act 2가 가장 빠름, ~30초)
./scripts/demo.sh --live --act 2

# 전체 라이브 (시간 많이 걸림, 5분+)
./scripts/demo.sh --live
```

---

## PART 4: 후처리

### 4-1. asciinema → GIF 변환

```bash
# agg (asciinema GIF generator) 사용
# 설치: pip3 install asciinema-agg

# 전체 데모 GIF (README용)
agg docs/demo.cast docs/demo.gif \
  --cols 102 --rows 29 \
  --font-size 14 \
  --theme asciinema \
  --speed 1.5

# Act 4만 GIF (Twitter용, 작고 빠르게)
agg docs/demo-motion.cast docs/demo-motion.gif \
  --cols 102 --rows 29 \
  --font-size 14 \
  --speed 1.2
```

### 4-2. asciinema → MP4 변환 (Twitter/YouTube용)

```bash
# 방법 1: asciinema 웹에 업로드 후 다운로드
asciinema upload docs/demo.cast
# → 웹에서 MP4 다운로드

# 방법 2: ffmpeg로 GIF → MP4
ffmpeg -i docs/demo.gif \
  -movflags faststart \
  -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  docs/demo.mp4
```

### 4-3. GIF 최적화

```bash
# gifsicle로 용량 줄이기 (선택)
brew install gifsicle

gifsicle -O3 --lossy=80 docs/demo.gif -o docs/demo-optimized.gif

# 용량 확인 (5MB 이하 추천 - GitHub README 로딩 속도)
ls -lh docs/demo*.gif
```

### 4-4. README 업데이트

GIF가 준비되면:

```markdown
<!-- README.md 상단 -->
![VibeFrame Demo](docs/demo.gif)
```

---

## PART 5: 촬영 팁

### 자연스러운 타이핑

- 타이핑 속도를 일정하게 (너무 빠르면 읽기 어려움)
- 실수하면 백스페이스로 자연스럽게 수정 (오히려 인간미)
- 긴 명령은 `\`로 줄바꿈해서 가독성 확보

### GIF 최적화 (README용)

- **15초 이하** — GitHub에서 자동재생
- **800x450 이하** — 로딩 빠름
- **5MB 이하** — 모바일에서도 OK
- **Act 4만 촬영** — 짧고 임팩트 있음

### Twitter/X용

- **MP4 형식** — GIF보다 화질 좋음
- **자막 추가** — 음소거 자동재생이므로
- **30초 이하** — 피드에서 바로 재생
- **첫 3초에 임팩트** — 스크롤 멈추게

### Hacker News용

- 제목: "Show HN: VibeFrame – AI video editor in the terminal (58 tools, 10 providers)"
- 포스트에 asciinema 링크 또는 GIF 직접 링크
- 기술적 디테일 강조 (아키텍처, API 체이닝)

---

## 빠른 촬영 체크리스트

```
[ ] 터미널 세팅 (폰트 15pt, 다크 테마, 102x29)
[ ] 방해금지 모드
[ ] pnpm build 성공
[ ] demo-output/ 디렉토리 존재
[ ] asciinema 설치됨
[ ] 녹화 시작: asciinema rec docs/demo.cast --cols 102 --rows 29 --overwrite
[ ] 촬영 (Option A~D 중 선택)
[ ] 녹화 종료: exit 또는 Ctrl+D
[ ] GIF 변환: agg docs/demo.cast docs/demo.gif --speed 1.5
[ ] 용량 확인: ls -lh docs/demo.gif (5MB 이하)
[ ] README 확인: git diff README.md
```
