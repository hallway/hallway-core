#!/bin/bash

# String utilities — working code, zero tests

# Reverse a string
reverse() {
  echo "$1" | rev
}

# Count words in a string
word_count() {
  echo "$1" | wc -w | tr -d ' '
}

# Convert to uppercase
to_upper() {
  echo "$1" | tr '[:lower:]' '[:upper:]'
}

# Check if string is a palindrome (returns 0=true, 1=false)
is_palindrome() {
  local reversed
  reversed=$(echo "$1" | rev)
  [ "$1" = "$reversed" ]
}

# Repeat a string N times
repeat_string() {
  local str="$1" n="$2" result=""
  for ((i=0; i<n; i++)); do
    result="${result}${str}"
  done
  echo "$result"
}
