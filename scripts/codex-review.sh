#!/usr/bin/env bash
set -euo pipefail

PROMPT_FILE=".codex/review-prompt.md"
OUTPUT_FILE="codex-review.md"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "Ошибка: Файл с промптом для ревью ($PROMPT_FILE) не найден." >&2
  exit 1
fi

echo "Запуск Codex code review в режиме read-only..."
codex exec -s read-only -o "$OUTPUT_FILE" - < "$PROMPT_FILE"
echo "Codex code review завершен. Отчет сохранен в $OUTPUT_FILE."
