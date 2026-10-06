#!/bin/sh
# Keeps the disk from filling during long unattended runs. Recordings older
# than eight hours, trial logs older than three hours (gzipped, the audit
# reads .log.gz), and nothing else. Run every 20 minutes.
cd "$(dirname "$0")/../.." || exit 1
find .clean-run*/recordings -type f -mmin +480 -delete 2>/dev/null
find .clean-run*/recordings -mindepth 3 -type d -empty -delete 2>/dev/null
find artifacts -maxdepth 1 -name 'midgame-*.log' -mmin +180 -size +1M -exec gzip -f {} \; 2>/dev/null
# A live trial's log over 500 MB: its lines so far gzipped beside it and the
# log emptied in place (note 1338). The trial holds it open for appending, so
# its next line goes on at the start; nothing written is lost. 2026-10-06
# 01:15Z the disk was down to 1 GB free with 8 GB in live logs, 25589's
# growing 95 KB a second (a pass repeated fifteen times a second).
for f in $(find artifacts -maxdepth 1 -name 'midgame-*.log' -mmin -180 -size +500M 2>/dev/null); do
  part="${f%.log}.part-$(date -u +%Y%m%dT%H%M%SZ).log.gz"
  gzip -c "$f" > "$part" && : > "$f" && echo "$f gzipped to $part"
done
free=$(df -g /System/Volumes/Data | awk 'NR==2{print $4}')
echo "$(date -u +%FT%TZ) free ${free}G"
if [ "$free" -lt 12 ]; then
  find .clean-run*/recordings -type f -mmin +120 -delete 2>/dev/null
  echo "low disk: recordings older than 2h removed"
fi
