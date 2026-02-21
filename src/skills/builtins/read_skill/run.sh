#!/bin/bash
SKILL_DIR="../$1"
if [ ! -d "$SKILL_DIR" ]; then
  echo "Skill $1 does not exist."
  exit 1
fi
echo "--- manifest.toml ---"
cat "$SKILL_DIR/manifest.toml"
echo "--- skill.md ---"
cat "$SKILL_DIR/skill.md"
echo "--- run.sh ---"
cat "$SKILL_DIR/run.sh"
