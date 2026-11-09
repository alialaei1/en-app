# mimivo

Dark-themed English learning app built with Django + Tailwind.

Hierarchy: **Course → Section → Lesson → Content items**

## Lesson media pipeline

1. Upload **audio or video** (video → mp3 via ffmpeg)
2. Upload **.txt / .pdf / .docx** or paste text (one line/sentence per chunk)
3. Backend creates editable content items
4. If `stable-ts` is installed, Whisper alignment splits the audio per chunk (same idea as `split_audio.py`)

## Setup

```bash
cd mimivo
source .venv/Scripts/activate
pip install -r requirements.txt
npm install
python manage.py migrate
npm run build:css
```

Requirements:
- ffmpeg in PATH
- optional but recommended: `stable-ts` for per-chunk audio cutting

## Run

```bash
# Terminal 1
source .venv/Scripts/activate
python manage.py runserver

# Terminal 2
npm run dev:css
```

Open http://127.0.0.1:8000/
