#!/bin/bash
# Cleanup Script: Remove all African country hostname references
# Removes generated output folders and backup files containing static hostnames

set -e

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  African Country Hostname Cleanup                            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Remove generated output folders (safe to delete - regenerated on demand)
echo "✓ Step 1: Removing generated output folders..."

if [ -d "IN-OUT-FOLDER" ]; then
    echo "   Removing IN-OUT-FOLDER/ (generated session data)"
    rm -rf IN-OUT-FOLDER/
fi

if [ -d "OUTPUT" ]; then
    echo "   Removing OUTPUT/ (generated topology data)"
    rm -rf OUTPUT/
fi

echo "   ✓ Generated folders removed"
echo ""

# Step 2: Remove backup CSV files with African hostnames
echo "✓ Step 2: Removing backup hostname files..."

find INPUT-FOLDER -name "*.csv" -o -name "*.txt" | while read file; do
    if grep -q "les-mar\|tan-mbz\|moz-adc\|ken-mob\|drc-moa\|djb-db\|zaf-cpt\|zaf-jnb" "$file" 2>/dev/null; then
        echo "   Removing: $file"
        rm -f "$file"
    fi
done

if [ -d "INPUT-FOLDER copy" ]; then
    echo "   Removing INPUT-FOLDER copy/ (backup folder)"
    rm -rf "INPUT-FOLDER copy"
fi

echo "   ✓ Backup files removed"
echo ""

# Step 3: Check for remaining references
echo "✓ Step 3: Checking for remaining African hostname references..."

REMAINING=$(grep -r "les-mar\|tan-mbz\|moz-adc\|ken-mob\|drc-moa\|djb-db\|zaf-cpt\|zaf-jnb" \
    --include="*.py" --include="*.js" --include="*.csv" --include="*.txt" \
    --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir="venv" \
    . 2>/dev/null | wc -l | tr -d ' ')

if [ "$REMAINING" -eq 0 ]; then
    echo "   ✓ No African hostname references found in source code"
else
    echo "   ⚠️  Found $REMAINING remaining references in source code"
    echo "   Listing files with references:"
    grep -rl "les-mar\|tan-mbz\|moz-adc\|ken-mob\|drc-moa\|djb-db\|zaf-cpt\|zaf-jnb" \
        --include="*.py" --include="*.js" --include="*.csv" --include="*.txt" \
        --exclude-dir=".git" --exclude-dir="node_modules" --exclude-dir="venv" \
        . 2>/dev/null | head -20
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Cleanup Summary                                             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ Generated output folders removed"
echo "✅ Backup hostname files removed"
echo "✅ Ready for git history cleanup"
echo ""
