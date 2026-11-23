#!/usr/bin/env bash
# فحص قاعدة البيانات: بيشغّل supabase.sql مرتين (لازم يكون آمن للتكرار) وبعدين فحوصات الحماية
# الاستعمال: PGHOST=... PGPORT=... PGUSER=postgres bash tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=daftar_test_$$
psql -q -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
trap 'psql -q -c "drop database if exists $DB" >/dev/null' EXIT
P="psql -q -v ON_ERROR_STOP=1 -d $DB"
$P -f mock_auth.sql >/dev/null
$P -f ../../supabase.sql >/dev/null 2>&1 || { $P -f ../../supabase.sql; exit 1; }
$P -f ../../supabase.sql >/dev/null 2>&1 || { echo "supabase.sql مش آمن للتشغيل مرتين"; exit 1; }
if out=$($P -f policies.test.sql 2>&1); then
  echo "$out" | sed -n 's/.*NOTICE:  ok: /  ✓ /p'
  echo "✅ فحوصات قاعدة البيانات نجحت"
else
  echo "$out" | sed -n 's/.*NOTICE:  ok: /  ✓ /p'
  echo "$out" | grep -E "ERROR|FAIL" | sed 's/^/  ✗ /'
  exit 1
fi
