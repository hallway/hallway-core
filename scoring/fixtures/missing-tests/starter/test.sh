#!/bin/bash
# Test suite for utils.sh — currently empty
# TODO: add tests for reverse, word_count, to_upper, is_palindrome, repeat_string

source ./utils.sh

PASSED=0
FAILED=0

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "PASS: $name"
    PASSED=$((PASSED + 1))
  else
    echo "FAIL: $name (expected '$expected', got '$actual')"
    FAILED=$((FAILED + 1))
  fi
}

# ADD TESTS HERE

echo ""
echo "$PASSED passed, $FAILED failed"
